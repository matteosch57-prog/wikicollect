// The catalog turns a rolled rarity into an actual Wikipedia article.
//
// Packs roll each card's rarity first (with the published odds from config),
// then ask the catalog for an article of that rarity:
//   1. a fresh article from the pre-fetched pool (never dealt before), else
//   2. any known article of that rarity (cards are shared, duplicates exist).
// The pool is fed in the background by Wikipedia's random generator (mostly
// low tiers) and by top-viewed lists (high tiers). If Wikipedia is slow or
// down, a circuit breaker keeps everything running from the local catalog.

import { config } from './config.js';
import { setsFor } from './sets.js';
import { GameError } from './errors.js';
import { RARITIES, RARITY_RANK } from './rarity.js';

const DAY = 24 * 60 * 60 * 1000;
const BACKOFF_MS = 60 * 1000;
const MIN_PER_TIER = 12; // keep at least this many known articles per rarity

export function createCatalog({ db, wiki, lang, now = Date.now, random = Math.random, log = console }) {
  const sets = setsFor(lang);
  let refilling = null;
  let enriching = null;
  let downUntil = 0;

  const wikiDown = () => Date.now() < downUntil;
  const markDown = (err) => {
    downUntil = Date.now() + Math.max(BACKOFF_MS, err?.retryAfterMs || 0);
    log.warn?.(`[catalog] Wikipedia unavailable (${err?.message}); serving from the local catalog for a while`);
  };

  const stmt = {
    upsert: db.prepare(`
      INSERT INTO articles (id, title, description, extract, image, url, views, bytes, refs, images, sections, badge,
                            rarity, atk, def, score, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, description = excluded.description, extract = excluded.extract,
        image = excluded.image, url = excluded.url`),
    get: db.prepare('SELECT * FROM articles WHERE id = ?'),
    poolCount: db.prepare('SELECT COUNT(*) AS n FROM pool'),
    poolAdd: db.prepare('INSERT OR IGNORE INTO pool (article_id, rarity) VALUES (?, ?)'),
    poolTake: db.prepare(`DELETE FROM pool WHERE article_id = (
      SELECT article_id FROM pool WHERE rarity = ? ORDER BY random() LIMIT 1) RETURNING article_id`),
    anyOfRarity: db.prepare('SELECT * FROM articles WHERE rarity = ? ORDER BY random() LIMIT 1'),
    tierCounts: db.prepare('SELECT rarity, COUNT(*) AS n FROM articles GROUP BY rarity'),
    popularGet: db.prepare('SELECT titles FROM popular_cache WHERE month = ?'),
    popularPut: db.prepare('INSERT OR REPLACE INTO popular_cache (month, titles, fetched_at) VALUES (?, ?, ?)'),
    byTitle: db.prepare('SELECT * FROM articles WHERE title = ?'),
    memberGet: db.prepare('SELECT article_id FROM set_members WHERE set_id = ? AND title = ?'),
    memberPut: db.prepare('INSERT OR REPLACE INTO set_members (set_id, title, article_id) VALUES (?, ?, ?)'),
  };

  // Stats are frozen at first discovery: the upsert never touches them.
  function save(a) {
    stmt.upsert.run(
      a.id, a.title, a.description, a.extract, a.image, a.url, a.views, a.bytes,
      a.refs ?? 0, a.images ?? 0, a.sections ?? 0, a.badge ?? null,
      a.rarity, a.atk, a.def, a.score, now(),
    );
    return stmt.get.get(a.id);
  }

  function addToPool(article) {
    const saved = save(article);
    stmt.poolAdd.run(saved.id, saved.rarity);
    return saved;
  }

  // --- background feeding ---------------------------------------------------

  async function refillPool() {
    if (refilling) return refilling;
    if (wikiDown()) return;
    refilling = (async () => {
      try {
        let guard = 0;
        while (stmt.poolCount.get().n < config.pool.target && guard++ < 5) {
          for (const a of await wiki.random(config.pool.batch)) addToPool(a);
        }
      } catch (err) {
        markDown(err);
      } finally {
        refilling = null;
      }
    })();
    return refilling;
  }

  async function popularTitles() {
    const d = new Date(now());
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1 - Math.floor(random() * 60));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const cached = stmt.popularGet.get(key);
    if (cached) return JSON.parse(cached.titles);
    let titles;
    try {
      titles = await wiki.topOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
    } catch {
      titles = await wiki.mostViewed();
    }
    stmt.popularPut.run(key, JSON.stringify(titles), now());
    return titles;
  }

  // Pull popular articles into the catalog until every high tier has enough
  // cards. Background calls are throttled; `force` is used when a draw found
  // nothing at all for a tier.
  let lastEnrich = 0;
  async function enrich({ force = false } = {}) {
    if (enriching) return enriching;
    if (wikiDown() || (!force && Date.now() - lastEnrich < 5 * 60_000)) return;
    lastEnrich = Date.now();
    enriching = (async () => {
      try {
        for (let round = 0; round < 3 && thinTiers().length; round++) {
          const titles = await popularTitles();
          const pick = [];
          for (let i = 0; i < 10 && titles.length; i++) pick.push(titles[Math.floor(random() * Math.min(titles.length, 1000))]);
          const found = await wiki.byTitles([...new Set(pick)]);
          for (const a of found.values()) addToPool(a);
        }
      } catch (err) {
        markDown(err);
      } finally {
        enriching = null;
      }
    })();
    return enriching;
  }

  function thinTiers() {
    const counts = Object.fromEntries(stmt.tierCounts.all().map((r) => [r.rarity, r.n]));
    return RARITIES.filter((r) => (counts[r.id] || 0) < MIN_PER_TIER).map((r) => r.id);
  }

  async function warmUp() {
    await refillPool();
    await resolveAllSets().catch(markDown);
    await enrich({ force: true });
  }

  // --- dealing --------------------------------------------------------------

  function takeFresh(rarity) {
    const row = stmt.poolTake.get(rarity);
    return row ? stmt.get.get(row.article_id) : null;
  }

  // Returns an article of exactly `rarity` when possible; walks down (then up)
  // the tiers only if the catalog has nothing at all for that rarity.
  async function drawOfRarity(rarity) {
    let article = takeFresh(rarity) || stmt.anyOfRarity.get(rarity);
    if (!article && !wikiDown()) {
      await (RARITY_RANK[rarity] >= RARITY_RANK.SR ? enrich({ force: true }) : refillPool());
      article = takeFresh(rarity) || stmt.anyOfRarity.get(rarity);
    }
    if (stmt.poolCount.get().n < config.pool.lowWater) refillPool();
    if (thinTiers().length) enrich();
    if (article) return article;

    const rank = RARITY_RANK[rarity];
    const order = RARITIES.map((r, i) => ({ id: r.id, d: Math.abs(i - rank) + (i > rank ? 0.5 : 0) }))
      .sort((a, b) => a.d - b.d)
      .slice(1);
    for (const { id } of order) {
      const alt = takeFresh(id) || stmt.anyOfRarity.get(id);
      if (alt) {
        log.warn?.(`[catalog] no ${rarity} card available, dealt ${id} instead`);
        return alt;
      }
    }
    throw new GameError('Wikipedia is unreachable and the catalog is empty. Try again shortly.', 503);
  }

  // --- sets -----------------------------------------------------------------

  async function resolveSetMember(setId, title) {
    const row = stmt.memberGet.get(setId, title);
    if (row?.article_id) return stmt.get.get(row.article_id);
    if (wikiDown()) return null;
    const found = await wiki.byTitles([title]);
    const article = found.get(title);
    if (!article) return null;
    const saved = save(article);
    stmt.memberPut.run(setId, title, saved.id);
    return saved;
  }

  async function drawFromSet(setId) {
    const set = sets.find((s) => s.id === setId);
    if (!set) throw new GameError('Unknown theme', 404);
    for (let i = 0; i < 4; i++) {
      const title = set.titles[Math.floor(random() * set.titles.length)];
      try {
        const article = await resolveSetMember(set.id, title);
        if (article) return article;
      } catch (err) {
        markDown(err);
      }
    }
    // Fall back to any resolved member.
    const row = db.prepare('SELECT article_id FROM set_members WHERE set_id = ? AND article_id IS NOT NULL ORDER BY random() LIMIT 1').get(setId);
    if (row) return stmt.get.get(row.article_id);
    throw new GameError('This theme is not available right now. Try again shortly.', 503);
  }

  let lastSetResolve = 0;
  async function resolveAllSets() {
    if (wikiDown() || Date.now() - lastSetResolve < 10 * 60 * 1000) return;
    const missing = [];
    for (const set of sets) {
      for (const title of set.titles) {
        if (!stmt.memberGet.get(set.id, title)?.article_id) missing.push([set.id, title]);
      }
    }
    if (!missing.length) return;
    lastSetResolve = Date.now();
    const found = await wiki.byTitles([...new Set(missing.map(([, t]) => t))]);
    for (const [setId, title] of missing) {
      const article = found.get(title);
      if (article) stmt.memberPut.run(setId, title, save(article).id);
    }
  }

  // Rarity mix of a set, used to publish theme pack odds.
  function setOdds(setId) {
    const rows = db.prepare(`SELECT a.rarity, COUNT(*) AS n FROM set_members sm JOIN articles a ON a.id = sm.article_id
      WHERE sm.set_id = ? GROUP BY a.rarity`).all(setId);
    const total = rows.reduce((s, r) => s + r.n, 0);
    return Object.fromEntries(rows.map((r) => [r.rarity, total ? r.n / total : 0]));
  }

  return {
    drawOfRarity, drawFromSet, refillPool, enrich, warmUp, resolveAllSets, setOdds, save, sets,
    isDown: wikiDown,
  };
}
