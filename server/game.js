import { config } from './config.js';
import { tx } from './db.js';
import { RARITIES, RARITY_BY_ID, RARITY_RANK } from './rarity.js';
import { GameError } from './errors.js';

const PUBLIC_CARD = 'a.id, a.title, a.description, a.extract, a.image, a.url, a.views, a.bytes, a.score, a.rarity';

export function cardView(row) {
  if (!row) return null;
  const card = {
    id: row.id,
    title: row.title,
    description: row.description,
    extract: row.extract,
    image: row.image,
    url: row.url,
    views: row.views,
    bytes: row.bytes,
    score: row.score,
    rarity: row.rarity,
  };
  if (row.count !== undefined) card.count = row.count;
  return card;
}

export function createGame({ db, catalog, now = Date.now, random = Math.random }) {
  const { packs: P } = config;

  // --- pack stock -----------------------------------------------------------

  // Applies pack regeneration lazily and returns the fresh user row.
  function syncPacks(userId) {
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!u) throw new GameError('User not found', 404);
    const t = now();
    if (u.packs >= P.maxStock) {
      if (u.pack_clock !== t) db.prepare('UPDATE users SET pack_clock = ? WHERE id = ?').run(t, userId);
      u.pack_clock = t;
      return u;
    }
    const gained = Math.floor((t - u.pack_clock) / P.regenMs);
    if (gained > 0) {
      const packs = Math.min(P.maxStock, u.packs + gained);
      const clock = packs >= P.maxStock ? t : u.pack_clock + gained * P.regenMs;
      db.prepare('UPDATE users SET packs = ?, pack_clock = ? WHERE id = ?').run(packs, clock, userId);
      u.packs = packs;
      u.pack_clock = clock;
    }
    return u;
  }

  function profile(userId) {
    const u = syncPacks(userId);
    const stats = db.prepare(`
      SELECT COUNT(*) AS unique_cards, COALESCE(SUM(uc.count), 0) AS total_cards
      FROM user_cards uc WHERE uc.user_id = ?`).get(userId);
    const incoming = db.prepare("SELECT COUNT(*) AS n FROM trades WHERE to_user = ? AND status = 'pending'").get(userId).n;
    return {
      id: u.id,
      username: u.username,
      coins: u.coins,
      packs: u.packs,
      maxStock: P.maxStock,
      nextPackAt: u.packs >= P.maxStock ? null : u.pack_clock + P.regenMs,
      regenMs: P.regenMs,
      packsOpened: u.packs_opened,
      uniqueCards: stats.unique_cards,
      totalCards: stats.total_cards,
      score: collectionScore(userId),
      incomingTrades: incoming,
      quiz: { correct: u.quiz_correct, answered: u.quiz_answered, streak: u.quiz_streak },
    };
  }

  function collectionScore(userId) {
    const rows = db.prepare(`
      SELECT a.rarity, COUNT(*) AS n FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? GROUP BY a.rarity`).all(userId);
    return rows.reduce((s, r) => s + (RARITY_BY_ID[r.rarity]?.points || 0) * r.n, 0);
  }

  // --- opening packs --------------------------------------------------------

  const opening = new Set(); // per-user lock against double clicks

  async function openPack(userId) {
    if (opening.has(userId)) throw new GameError('A pack is already being opened', 409);
    opening.add(userId);
    try {
      const u = syncPacks(userId);
      if (u.packs < 1) throw new GameError('No packs left — a new one arrives every few minutes', 409);

      // Draw first (network), then commit atomically.
      const drawn = [];
      const seen = new Set();
      for (let i = 0; i < P.cardsPerPack; i++) {
        const odds = i === P.cardsPerPack - 1 ? config.slotOdds.hit : config.slotOdds.normal;
        let pick;
        for (let attempt = 0; attempt < 3; attempt++) {
          pick = await catalog.drawCard(odds);
          if (!seen.has(pick.article.id)) break;
        }
        seen.add(pick.article.id);
        drawn.push(pick);
      }

      return tx(db, () => {
        const fresh = syncPacks(userId);
        if (fresh.packs < 1) throw new GameError('No packs left', 409);
        const wasFull = fresh.packs >= P.maxStock;
        db.prepare('UPDATE users SET packs = packs - 1, packs_opened = packs_opened + 1, pack_clock = ? WHERE id = ?')
          .run(wasFull ? now() : fresh.pack_clock, userId);

        const t = now();
        const cards = drawn.map(({ article, source }) => {
          const owned = db.prepare('SELECT count FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, article.id);
          db.prepare(`
            INSERT INTO user_cards (user_id, article_id, count, first_at) VALUES (?, ?, 1, ?)
            ON CONFLICT(user_id, article_id) DO UPDATE SET count = count + 1`).run(userId, article.id, t);
          db.prepare('INSERT INTO pulls (user_id, article_id, created_at) VALUES (?, ?, ?)').run(userId, article.id, t);
          db.prepare('UPDATE articles SET discovered_by = COALESCE(discovered_by, ?) WHERE id = ?').run(userId, article.id);
          return { ...cardView(article), isNew: !owned, count: (owned?.count || 0) + 1, source };
        });
        // Reveal from least to most rare, like a real booster.
        cards.sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
        return { cards, profile: profile(userId) };
      });
    } finally {
      opening.delete(userId);
    }
  }

  // --- album ----------------------------------------------------------------

  function collection(userId, { rarity, q, sort = 'rarity', dupesOnly = false, limit = 60, offset = 0 } = {}) {
    const where = ['uc.user_id = ?'];
    const args = [userId];
    if (rarity && RARITY_BY_ID[rarity]) {
      where.push('a.rarity = ?');
      args.push(rarity);
    }
    if (q) {
      where.push('a.title LIKE ?');
      args.push(`%${q}%`);
    }
    if (dupesOnly) where.push('uc.count > 1');
    const order = {
      rarity: 'a.score DESC',
      recent: 'uc.first_at DESC, a.score DESC',
      title: 'a.title COLLATE NOCASE ASC',
      count: 'uc.count DESC, a.score DESC',
    }[sort] || 'a.score DESC';
    const lim = Math.min(200, Math.max(1, Number(limit) || 60));
    const off = Math.max(0, Number(offset) || 0);
    const rows = db.prepare(`
      SELECT ${PUBLIC_CARD}, uc.count FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...args, lim, off);
    const total = db.prepare(`
      SELECT COUNT(*) AS n FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE ${where.join(' AND ')}`).get(...args).n;
    const byRarity = Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
    for (const r of db.prepare(`
      SELECT a.rarity, COUNT(*) AS n FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? GROUP BY a.rarity`).all(userId)) byRarity[r.rarity] = r.n;
    return { cards: rows.map(cardView), total, byRarity };
  }

  function card(articleId, viewerId) {
    const row = db.prepare(`SELECT ${PUBLIC_CARD}, a.discovered_at, u.username AS discovered_by
      FROM articles a LEFT JOIN users u ON u.id = a.discovered_by WHERE a.id = ?`).get(articleId);
    if (!row) throw new GameError('Card not found', 404);
    const owners = db.prepare('SELECT COUNT(*) AS n FROM user_cards WHERE article_id = ?').get(articleId).n;
    const mine = viewerId
      ? db.prepare('SELECT count FROM user_cards WHERE user_id = ? AND article_id = ?').get(viewerId, articleId)?.count || 0
      : 0;
    return { ...cardView(row), owners, mine, discoveredBy: row.discovered_by, discoveredAt: row.discovered_at };
  }

  // --- recycling & shop -----------------------------------------------------

  function recycle(userId, articleId, qty = 1) {
    qty = Math.floor(Number(qty));
    if (!(qty >= 1)) throw new GameError('Invalid quantity');
    return tx(db, () => {
      const row = db.prepare(`SELECT uc.count, a.rarity FROM user_cards uc JOIN articles a ON a.id = uc.article_id
        WHERE uc.user_id = ? AND uc.article_id = ?`).get(userId, articleId);
      if (!row) throw new GameError('You do not own this card', 404);
      if (row.count - qty < 1) throw new GameError('You can only recycle duplicates (one copy always stays in your album)');
      const coins = RARITY_BY_ID[row.rarity].recycle * qty;
      db.prepare('UPDATE user_cards SET count = count - ? WHERE user_id = ? AND article_id = ?').run(qty, userId, articleId);
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coins, userId);
      return { coins, profile: profile(userId) };
    });
  }

  function recycleAllDuplicates(userId, maxRarity = 'rare') {
    const cap = RARITY_RANK[maxRarity] ?? RARITY_RANK.rare;
    return tx(db, () => {
      const rows = db.prepare(`SELECT uc.article_id, uc.count, a.rarity FROM user_cards uc JOIN articles a ON a.id = uc.article_id
        WHERE uc.user_id = ? AND uc.count > 1`).all(userId).filter((r) => RARITY_RANK[r.rarity] <= cap);
      let coins = 0;
      let cards = 0;
      for (const r of rows) {
        const extra = r.count - 1;
        coins += RARITY_BY_ID[r.rarity].recycle * extra;
        cards += extra;
        db.prepare('UPDATE user_cards SET count = 1 WHERE user_id = ? AND article_id = ?').run(userId, r.article_id);
      }
      db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(coins, userId);
      return { coins, cards, profile: profile(userId) };
    });
  }

  function buyPack(userId) {
    return tx(db, () => {
      const u = syncPacks(userId);
      if (u.coins < P.shopPrice) throw new GameError(`A pack costs ${P.shopPrice} coins`);
      db.prepare('UPDATE users SET coins = coins - ?, packs = packs + 1 WHERE id = ?').run(P.shopPrice, userId);
      return { profile: profile(userId) };
    });
  }

  // --- themed sets ----------------------------------------------------------

  function setsProgress(userId) {
    const claimed = new Set(db.prepare('SELECT set_id FROM set_claims WHERE user_id = ?').all(userId).map((r) => r.set_id));
    return catalog.sets.map((set) => {
      const members = set.titles.map((title) => {
        const row = db.prepare(`SELECT ${PUBLIC_CARD}, uc.count FROM set_members sm
          JOIN articles a ON a.id = sm.article_id
          LEFT JOIN user_cards uc ON uc.article_id = a.id AND uc.user_id = ?
          WHERE sm.set_id = ? AND sm.title = ?`).get(userId, set.id, title);
        if (!row) return { title, owned: false, card: null };
        return { title, owned: !!row.count, card: row.count ? cardView(row) : { ...cardView(row), extract: '', count: 0 } };
      });
      const owned = members.filter((m) => m.owned).length;
      return {
        id: set.id,
        name: set.name,
        emoji: set.emoji,
        owned,
        size: set.titles.length,
        complete: owned === set.titles.length,
        claimed: claimed.has(set.id),
        reward: config.setRewardPacks,
        members,
      };
    });
  }

  function claimSet(userId, setId) {
    return tx(db, () => {
      const set = setsProgress(userId).find((s) => s.id === setId);
      if (!set) throw new GameError('Unknown set', 404);
      if (set.claimed) throw new GameError('Reward already claimed');
      if (!set.complete) throw new GameError('Set is not complete yet');
      db.prepare('INSERT INTO set_claims (user_id, set_id, claimed_at) VALUES (?, ?, ?)').run(userId, setId, now());
      db.prepare('UPDATE users SET packs = packs + ? WHERE id = ?').run(config.setRewardPacks, userId);
      return { packs: config.setRewardPacks, profile: profile(userId) };
    });
  }

  // --- social ---------------------------------------------------------------

  function leaderboard() {
    const rows = db.prepare(`
      SELECT u.id, u.username, u.quiz_correct, u.packs_opened, a.rarity, COUNT(a.id) AS n
      FROM users u LEFT JOIN user_cards uc ON uc.user_id = u.id LEFT JOIN articles a ON a.id = uc.article_id
      GROUP BY u.id, a.rarity`).all();
    const users = new Map();
    for (const r of rows) {
      const u = users.get(r.id) || { username: r.username, quizCorrect: r.quiz_correct, packsOpened: r.packs_opened, uniqueCards: 0, score: 0, best: null };
      if (r.rarity) {
        u.uniqueCards += r.n;
        u.score += RARITY_BY_ID[r.rarity].points * r.n;
        if (!u.best || RARITY_RANK[r.rarity] > RARITY_RANK[u.best]) u.best = r.rarity;
      }
      users.set(r.id, u);
    }
    const list = [...users.values()];
    return {
      score: [...list].sort((a, b) => b.score - a.score).slice(0, 50),
      quiz: [...list].sort((a, b) => b.quizCorrect - a.quizCorrect).slice(0, 50),
    };
  }

  function recentPulls(minRarity = 'rare', limit = 24) {
    const rarities = RARITIES.filter((r) => RARITY_RANK[r.id] >= (RARITY_RANK[minRarity] ?? 0)).map((r) => r.id);
    const rows = db.prepare(`
      SELECT ${PUBLIC_CARD}, p.created_at, u.username FROM pulls p
      JOIN articles a ON a.id = p.article_id JOIN users u ON u.id = p.user_id
      WHERE a.rarity IN (${rarities.map(() => '?').join(',')})
      ORDER BY p.id DESC LIMIT ?`).all(...rarities, Math.min(100, limit));
    return rows.map((r) => ({ ...cardView(r), extract: undefined, username: r.username, at: r.created_at }));
  }

  function userCards(username, { dupesOnly = false } = {}) {
    const u = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
    if (!u) throw new GameError('User not found', 404);
    const rows = db.prepare(`SELECT ${PUBLIC_CARD}, uc.count FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? ${dupesOnly ? 'AND uc.count > 1' : ''} ORDER BY a.score DESC LIMIT 500`).all(u.id);
    return { username: u.username, cards: rows.map((r) => ({ ...cardView(r), extract: undefined })) };
  }

  // Cards other players hold duplicates of and that the viewer is missing.
  function market(userId, { q } = {}) {
    const rows = db.prepare(`
      SELECT ${PUBLIC_CARD}, uc.count, u.username FROM user_cards uc
      JOIN articles a ON a.id = uc.article_id JOIN users u ON u.id = uc.user_id
      WHERE uc.user_id != ? AND uc.count > 1
        AND NOT EXISTS (SELECT 1 FROM user_cards m WHERE m.user_id = ? AND m.article_id = uc.article_id)
        ${q ? 'AND a.title LIKE ?' : ''}
      ORDER BY a.score DESC LIMIT 120`).all(userId, userId, ...(q ? [`%${q}%`] : []));
    return rows.map((r) => ({ ...cardView(r), extract: undefined, owner: r.username, spare: r.count - 1 }));
  }

  return {
    syncPacks, profile, openPack, collection, card, recycle, recycleAllDuplicates, buyPack,
    setsProgress, claimSet, leaderboard, recentPulls, userCards, market,
  };
}
