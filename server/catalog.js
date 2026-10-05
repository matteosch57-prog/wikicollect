// The catalog decides which article ends up on each card. Three sources:
//   random  - Wikipedia's random article generator (pre-fetched into a pool)
//   popular - a top-viewed article from a random month of the last five years
//   set     - a member of one of the themed albums
// Every source falls back to the next one, and ultimately to articles already
// in the catalog, so a Wikipedia hiccup never breaks pack opening.

import { config } from './config.js';
import { setsFor } from './sets.js';
import { GameError } from './errors.js';

const DAY = 24 * 60 * 60 * 1000;
const BACKOFF_MS = 30 * 1000;

export function createCatalog({ db, wiki, lang, now = Date.now, random = Math.random }) {
  const sets = setsFor(lang);
  let refilling = null;
  // Circuit breaker: after a network failure, skip Wikipedia for a while so
  // packs open instantly from the existing catalog instead of piling up timeouts.
  let downUntil = 0;
  const wikiDown = () => Date.now() < downUntil;
  const markDown = (err) => {
    downUntil = Date.now() + BACKOFF_MS;
    console.warn('[catalog] Wikipedia unavailable, using cached catalog for a while:', err.message);
  };

  const stmt = {
    upsert: db.prepare(`
      INSERT INTO articles (id, title, description, extract, image, url, views, bytes, score, rarity, discovered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title, description = excluded.description, extract = excluded.extract,
        image = excluded.image, url = excluded.url`),
    get: db.prepare('SELECT * FROM articles WHERE id = ?'),
    poolCount: db.prepare('SELECT COUNT(*) AS n FROM pool'),
    poolAdd: db.prepare('INSERT OR IGNORE INTO pool (article_id) VALUES (?)'),
    poolTake: db.prepare('DELETE FROM pool WHERE article_id = (SELECT article_id FROM pool ORDER BY random() LIMIT 1) RETURNING article_id'),
    anyArticle: db.prepare('SELECT * FROM articles ORDER BY random() LIMIT 1'),
    popularGet: db.prepare('SELECT titles, fetched_at FROM popular_cache WHERE month = ?'),
    popularPut: db.prepare('INSERT OR REPLACE INTO popular_cache (month, titles, fetched_at) VALUES (?, ?, ?)'),
    byTitle: db.prepare('SELECT * FROM articles WHERE title = ?'),
    memberGet: db.prepare('SELECT article_id FROM set_members WHERE set_id = ? AND title = ?'),
    memberPut: db.prepare('INSERT OR REPLACE INTO set_members (set_id, title, article_id) VALUES (?, ?, ?)'),
  };

  // Rarity/score are frozen at first discovery: the upsert never touches them.
  function save(article) {
    stmt.upsert.run(
      article.id, article.title, article.description, article.extract, article.image, article.url,
      article.views, article.bytes, article.score, article.rarity, now(),
    );
    return stmt.get.get(article.id);
  }

  async function refillPool() {
    if (refilling) return refilling;
    refilling = (async () => {
      try {
        let guard = 0;
        while (stmt.poolCount.get().n < config.pool.target && guard++ < 6) {
          const batch = await wiki.random(config.pool.batch);
          for (const a of batch) {
            save(a);
            stmt.poolAdd.run(a.id);
          }
        }
      } finally {
        refilling = null;
      }
    })();
    return refilling;
  }

  async function drawRandom() {
    const available = stmt.poolCount.get().n;
    if (available === 0) {
      if (wikiDown()) return null;
      await refillPool();
    } else if (available < config.pool.lowWater && !wikiDown()) {
      refillPool().catch(markDown);
    }
    const row = stmt.poolTake.get();
    return row ? stmt.get.get(row.article_id) : null;
  }

  async function popularTitles() {
    // Random month in the last 60 full months.
    const d = new Date(now());
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1 - Math.floor(random() * 60));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const cached = stmt.popularGet.get(key);
    if (cached) return JSON.parse(cached.titles);
    const titles = await wiki.topOfMonth(d.getUTCFullYear(), d.getUTCMonth() + 1);
    stmt.popularPut.run(key, JSON.stringify(titles), now());
    return titles;
  }

  async function fetchByTitle(title) {
    const known = stmt.byTitle.get(title);
    if (known && now() - known.discovered_at < 30 * DAY) return known;
    const found = await wiki.byTitles([title]);
    const article = found.get(title);
    if (article) return save(article);
    return known || null;
  }

  async function drawPopular() {
    const titles = await popularTitles();
    // Top lists contain non-articles and disambiguations; try a few picks.
    for (let i = 0; i < 4 && titles.length; i++) {
      const title = titles[Math.floor(random() * Math.min(titles.length, 500))];
      const article = await fetchByTitle(title);
      if (article) return article;
    }
    return null;
  }

  async function resolveSetMember(setId, title) {
    const row = stmt.memberGet.get(setId, title);
    if (row?.article_id) return stmt.get.get(row.article_id);
    const found = await wiki.byTitles([title]);
    const article = found.get(title);
    if (!article) return null;
    const saved = save(article);
    stmt.memberPut.run(setId, title, saved.id);
    return saved;
  }

  async function drawSet() {
    if (!sets.length) return null;
    const set = sets[Math.floor(random() * sets.length)];
    const title = set.titles[Math.floor(random() * set.titles.length)];
    return resolveSetMember(set.id, title);
  }

  const sources = { random: drawRandom, popular: drawPopular, set: drawSet };

  function pickSource(odds) {
    let r = random();
    for (const [name, p] of Object.entries(odds)) {
      if ((r -= p) < 0) return name;
    }
    return 'random';
  }

  async function drawCard(odds) {
    const first = pickSource(odds);
    const order = [first, ...['random', 'popular', 'set'].filter((s) => s !== first)];
    for (const source of order) {
      if (wikiDown() && source !== 'random') break;
      try {
        const article = await sources[source]();
        if (article) return { article, source };
      } catch (err) {
        markDown(err);
      }
    }
    const fallback = stmt.anyArticle.get();
    if (fallback) return { article: fallback, source: 'catalog' };
    throw new GameError('Wikipedia is unreachable and the catalog is empty. Try again shortly.', 503);
  }

  // Resolve all set members up-front (best effort) so album pages can show
  // what is missing. Unresolved titles are retried on the next call.
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

  return { drawCard, refillPool, resolveAllSets, sets, save };
}
