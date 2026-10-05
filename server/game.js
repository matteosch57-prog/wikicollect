import { config } from './config.js';
import { tx, addCoins, grantCard, takeCard, kvGet, kvSet } from './db.js';
import { RARITIES, RARITY_BY_ID, RARITY_RANK } from './rarity.js';
import { GameError } from './errors.js';
import { checkAchievements, unreadCount, achievementsFor } from './notify.js';

const CARD_COLS = 'a.id, a.title, a.description, a.extract, a.image, a.url, a.views, a.bytes, a.refs, a.images, a.sections, a.badge, a.rarity, a.atk, a.def, a.score';
const RANK_SQL = `CASE a.rarity ${RARITIES.map((r, i) => `WHEN '${r.id}' THEN ${i}`).join(' ')} END`;
const POINTS_SQL = `CASE a.rarity ${RARITIES.map((r) => `WHEN '${r.id}' THEN ${r.points}`).join(' ')} ELSE 0 END`;

export function cardView(row, { full = false } = {}) {
  if (!row) return null;
  const card = {
    id: row.id,
    title: row.title,
    description: row.description,
    image: row.image,
    url: row.url,
    rarity: row.rarity,
    atk: row.atk,
    def: row.def,
  };
  if (full) Object.assign(card, {
    extract: row.extract, views: row.views, bytes: row.bytes, refs: row.refs,
    images: row.images, sections: row.sections, badge: row.badge,
  });
  if (row.count !== undefined && row.count !== null) card.count = row.count;
  if (row.pinned) card.pinned = true;
  if (row.locked) card.locked = true;
  return card;
}

export function weekStart(t) {
  const d = new Date(t);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

export function rollRarity(odds, random = Math.random) {
  const entries = Object.entries(odds);
  const total = entries.reduce((s, [, p]) => s + p, 0);
  let r = random() * total;
  for (const [id, p] of entries) if ((r -= p) < 0) return id;
  return entries.at(-1)[0];
}

export function createGame({ db, catalog, now = Date.now, random = Math.random }) {
  const P = config.packs;
  const burn = (amount) => kvSet(db, 'coins_burned', kvGet(db, 'coins_burned', 0) + amount);

  // --- pack stock -----------------------------------------------------------

  // Applies free-pack regeneration lazily and returns the fresh user row.
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

  function collectionScore(userId) {
    return db.prepare(`SELECT COALESCE(SUM(${POINTS_SQL}), 0) AS s FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ?`).get(userId).s;
  }

  function profile(userId) {
    const u = syncPacks(userId);
    const stats = db.prepare(`SELECT COUNT(*) AS unique_cards, COALESCE(SUM(count), 0) AS total_cards
      FROM user_cards WHERE user_id = ?`).get(userId);
    const guild = db.prepare(`SELECT g.id, g.name, g.tag FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id
      WHERE gm.user_id = ?`).get(userId);
    return {
      id: u.id,
      username: u.username,
      isAdmin: !!u.is_admin || config.admins.includes(u.username.toLowerCase()),
      auth: { google: !!u.google_sub, password: !!u.pass_hash },
      coins: u.coins,
      packs: u.packs,
      maxStock: P.maxStock,
      nextPackAt: u.packs >= P.maxStock ? null : u.pack_clock + P.regenMs,
      regenMs: P.regenMs,
      packsOpened: u.packs_opened,
      uniqueCards: stats.unique_cards,
      totalCards: stats.total_cards,
      score: collectionScore(userId),
      guild: guild || null,
      unread: unreadCount(db, userId),
      pending: {
        trades: db.prepare("SELECT COUNT(*) AS n FROM trades WHERE to_user = ? AND status = 'pending'").get(userId).n,
        duels: db.prepare(`SELECT COUNT(*) AS n FROM duels WHERE (opponent_id = ? AND status = 'pending')
          OR (status = 'active' AND EXISTS (SELECT 1 FROM duel_rounds r WHERE r.duel_id = duels.id AND r.user_id = ? AND r.answered = 0))`)
          .get(userId, userId).n,
        friends: db.prepare("SELECT COUNT(*) AS n FROM friendships WHERE addressee_id = ? AND status = 'pending'").get(userId).n,
        messages: db.prepare('SELECT COUNT(*) AS n FROM messages WHERE to_user = ? AND read_at IS NULL').get(userId).n,
      },
      quiz: { correct: u.quiz_correct, answered: u.quiz_answered, streak: u.quiz_streak },
      duels: { wins: u.duel_wins, losses: u.duel_losses },
    };
  }

  // --- shop -----------------------------------------------------------------

  function activeThemes() {
    const { rotationMs, active } = config.themePack;
    const slot = Math.floor(now() / rotationMs);
    const ids = catalog.sets.map((s) => s.id);
    // Deterministic shuffle per rotation slot.
    let seed = slot * 2654435761 % 4294967296;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    return { ids: ids.slice(0, active), endsAt: (slot + 1) * rotationMs };
  }

  function shop() {
    const themes = activeThemes();
    return {
      packs: Object.entries(config.packTypes).map(([id, p]) => ({ id, name: p.name, price: p.price, slots: p.slots })),
      themes: themes.ids.map((id) => {
        const set = catalog.sets.find((s) => s.id === id);
        return { id, name: set.name, emoji: set.emoji, price: config.themePack.price, odds: catalog.setOdds(id), endsAt: themes.endsAt };
      }),
      jackpot: { ticket: config.jackpot.ticket, pot: kvGet(db, 'jackpot_pot', config.jackpot.seed), winChance: config.jackpot.winChance, burnRate: config.jackpot.burnRate },
      coinsBurned: kvGet(db, 'coins_burned', 0),
    };
  }

  // --- opening packs --------------------------------------------------------

  const opening = new Set(); // per-user lock against double clicks

  async function openPack(userId, { type = 'free', theme } = {}) {
    if (opening.has(userId)) throw new GameError('A pack is already being opened', 409);
    const packType = type === 'theme' ? null : config.packTypes[type];
    if (type !== 'theme' && !packType) throw new GameError('Unknown pack type');
    if (type === 'theme' && !activeThemes().ids.includes(theme)) throw new GameError('This theme is not in the shop right now');
    const price = type === 'theme' ? config.themePack.price : packType.price;

    opening.add(userId);
    try {
      const u = syncPacks(userId);
      if (type === 'free' && u.packs < 1) throw new GameError('No free packs left — a new one arrives every 10 minutes', 409);
      if (price > u.coins) throw new GameError(`This pack costs ${price} coins`, 409);

      // Draw first (may hit the network), then commit atomically.
      const drawn = [];
      const seen = new Set();
      for (let i = 0; i < P.cardsPerPack; i++) {
        let article;
        for (let attempt = 0; attempt < 3; attempt++) {
          article = type === 'theme'
            ? await catalog.drawFromSet(theme)
            : await catalog.drawOfRarity(rollRarity(packType.slots[i] || packType.slots.at(-1), random), seen);
          if (!seen.has(article.id)) break;
        }
        seen.add(article.id);
        drawn.push(article);
      }

      return tx(db, () => {
        const fresh = syncPacks(userId);
        if (type === 'free') {
          if (fresh.packs < 1) throw new GameError('No free packs left', 409);
          const wasFull = fresh.packs >= P.maxStock;
          db.prepare('UPDATE users SET packs = packs - 1, pack_clock = ? WHERE id = ?').run(wasFull ? now() : fresh.pack_clock, userId);
        }
        if (price) {
          addCoins(db, userId, -price, `shop:${type}${theme ? `:${theme}` : ''}`, now());
          burn(price);
        }
        db.prepare('UPDATE users SET packs_opened = packs_opened + 1 WHERE id = ?').run(userId);

        const t = now();
        const cards = drawn.map((article) => {
          const owned = db.prepare('SELECT count FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, article.id);
          grantCard(db, userId, article.id, 1, t);
          db.prepare('INSERT INTO pulls (user_id, article_id, pack_type, created_at) VALUES (?, ?, ?, ?)').run(userId, article.id, type, t);
          db.prepare('UPDATE articles SET discovered_by = COALESCE(discovered_by, ?) WHERE id = ?').run(userId, article.id);
          return { ...cardView(article, { full: true }), isNew: !owned, count: (owned?.count || 0) + 1 };
        });
        // Reveal from least to most rare, like a real booster.
        cards.sort((a, b) => RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]);
        const achievements = checkAchievements(db, userId, t);
        return { cards, achievements, profile: profile(userId) };
      });
    } finally {
      opening.delete(userId);
    }
  }

  function spinJackpot(userId) {
    const J = config.jackpot;
    return tx(db, () => {
      addCoins(db, userId, -J.ticket, 'jackpot:ticket', now());
      const burned = Math.round(J.ticket * J.burnRate);
      burn(burned);
      let pot = kvGet(db, 'jackpot_pot', J.seed) + (J.ticket - burned);
      const won = random() < J.winChance;
      let prize = 0;
      if (won) {
        prize = pot;
        addCoins(db, userId, prize, 'jackpot:win', now());
        pot = J.seed;
      }
      kvSet(db, 'jackpot_pot', pot);
      return { won, prize, pot, profile: profile(userId) };
    });
  }

  // --- album ----------------------------------------------------------------

  function collection(userId, { rarity, q, sort = 'rarity', dupes, tag, locked, limit = 60, offset = 0 } = {}) {
    const where = ['uc.user_id = ?'];
    const args = [userId];
    if (rarity && RARITY_BY_ID[rarity]) {
      where.push('a.rarity = ?');
      args.push(rarity);
    }
    if (q) {
      where.push('a.title LIKE ?');
      args.push(`%${String(q).slice(0, 80)}%`);
    }
    if (dupes) where.push('uc.count > 1');
    if (locked) where.push('uc.locked = 1');
    if (tag) {
      where.push('EXISTS (SELECT 1 FROM card_tags t WHERE t.user_id = uc.user_id AND t.article_id = uc.article_id AND t.tag = ?)');
      args.push(String(tag));
    }
    const order = {
      rarity: `${RANK_SQL} DESC, a.score DESC`,
      recent: 'uc.first_at DESC',
      title: 'a.title COLLATE NOCASE ASC',
      count: 'uc.count DESC, a.score DESC',
      atk: 'a.atk DESC',
      def: 'a.def DESC',
    }[sort] || `${RANK_SQL} DESC, a.score DESC`;
    const lim = Math.min(200, Math.max(1, Number(limit) || 60));
    const off = Math.max(0, Number(offset) || 0);
    const rows = db.prepare(`
      SELECT ${CARD_COLS}, uc.count, uc.pinned, uc.locked FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE ${where.join(' AND ')} ORDER BY uc.pinned DESC, ${order} LIMIT ? OFFSET ?`).all(...args, lim, off);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE ${where.join(' AND ')}`).get(...args).n;
    const byRarity = Object.fromEntries(RARITIES.map((r) => [r.id, 0]));
    for (const r of db.prepare(`SELECT a.rarity, COUNT(*) AS n FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? GROUP BY a.rarity`).all(userId)) byRarity[r.rarity] = r.n;
    const tagRows = db.prepare('SELECT t.article_id, t.tag FROM card_tags t WHERE t.user_id = ?').all(userId);
    const tagsOf = new Map();
    for (const r of tagRows) tagsOf.set(r.article_id, [...(tagsOf.get(r.article_id) || []), r.tag]);
    return {
      cards: rows.map((r) => ({ ...cardView(r), tags: tagsOf.get(r.id) || [] })),
      total,
      byRarity,
      tags: [...new Set(tagRows.map((r) => r.tag))].sort(),
    };
  }

  function card(articleId, viewerId) {
    const row = db.prepare(`SELECT ${CARD_COLS}, a.discovered_at, u.username AS discovered_by
      FROM articles a LEFT JOIN users u ON u.id = a.discovered_by WHERE a.id = ?`).get(articleId);
    if (!row) throw new GameError('Card not found', 404);
    const owners = db.prepare('SELECT COUNT(*) AS n FROM user_cards WHERE article_id = ?').get(articleId).n;
    const mine = viewerId
      ? db.prepare('SELECT count, pinned, locked, relist_after FROM user_cards WHERE user_id = ? AND article_id = ?').get(viewerId, articleId)
      : null;
    const tags = viewerId
      ? db.prepare('SELECT tag FROM card_tags WHERE user_id = ? AND article_id = ?').all(viewerId, articleId).map((r) => r.tag)
      : [];
    const wished = viewerId ? !!db.prepare('SELECT 1 FROM wishlist WHERE user_id = ? AND article_id = ?').get(viewerId, articleId) : false;
    return {
      ...cardView(row, { full: true }),
      owners,
      mine: mine?.count || 0,
      pinned: !!mine?.pinned,
      locked: !!mine?.locked,
      relistAfter: mine?.relist_after > now() ? mine.relist_after : null,
      tags,
      wished,
      discoveredBy: row.discovered_by,
      discoveredAt: row.discovered_at,
    };
  }

  function setCardFlags(userId, articleId, { pinned, locked, tags }) {
    return tx(db, () => {
      const own = db.prepare('SELECT 1 FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, articleId);
      if (!own) throw new GameError('You do not own this card', 404);
      if (pinned !== undefined) db.prepare('UPDATE user_cards SET pinned = ? WHERE user_id = ? AND article_id = ?').run(pinned ? 1 : 0, userId, articleId);
      if (locked !== undefined) db.prepare('UPDATE user_cards SET locked = ? WHERE user_id = ? AND article_id = ?').run(locked ? 1 : 0, userId, articleId);
      if (tags !== undefined) {
        if (!Array.isArray(tags)) throw new GameError('Tags must be a list');
        const clean = [...new Set(tags.map((t) => String(t).trim().slice(0, 24)).filter(Boolean))].slice(0, 8);
        db.prepare('DELETE FROM card_tags WHERE user_id = ? AND article_id = ?').run(userId, articleId);
        for (const t of clean) db.prepare('INSERT INTO card_tags (user_id, article_id, tag) VALUES (?, ?, ?)').run(userId, articleId, t);
      }
      return card(articleId, userId);
    });
  }

  function exportCollection(userId) {
    const rows = db.prepare(`SELECT ${CARD_COLS}, uc.count, uc.pinned, uc.locked, uc.first_at FROM user_cards uc
      JOIN articles a ON a.id = uc.article_id WHERE uc.user_id = ? ORDER BY ${RANK_SQL} DESC, a.title`).all(userId);
    const tags = new Map();
    for (const r of db.prepare('SELECT article_id, tag FROM card_tags WHERE user_id = ?').all(userId)) {
      tags.set(r.article_id, [...(tags.get(r.article_id) || []), r.tag]);
    }
    return rows.map((r) => ({
      pageid: r.id, title: r.title, url: r.url, rarity: r.rarity, atk: r.atk, def: r.def, count: r.count,
      pinned: !!r.pinned, locked: !!r.locked, tags: tags.get(r.id) || [], obtainedAt: new Date(r.first_at).toISOString(),
    }));
  }

  // --- wishlist -------------------------------------------------------------

  function wishlist(userId) {
    return db.prepare(`SELECT ${CARD_COLS} FROM wishlist w JOIN articles a ON a.id = w.article_id
      WHERE w.user_id = ? ORDER BY w.created_at DESC`).all(userId).map((r) => cardView(r));
  }

  function setWish(userId, articleId, wished) {
    if (!db.prepare('SELECT 1 FROM articles WHERE id = ?').get(articleId)) throw new GameError('Card not found', 404);
    if (wished) {
      if (db.prepare('SELECT 1 FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, articleId)) {
        throw new GameError('You already own this card');
      }
      const n = db.prepare('SELECT COUNT(*) AS n FROM wishlist WHERE user_id = ?').get(userId).n;
      if (n >= 100) throw new GameError('Your wishlist is full (100 cards)');
      db.prepare('INSERT OR IGNORE INTO wishlist (user_id, article_id, created_at) VALUES (?, ?, ?)').run(userId, articleId, now());
    } else {
      db.prepare('DELETE FROM wishlist WHERE user_id = ? AND article_id = ?').run(userId, articleId);
    }
    return { wished: !!wished };
  }

  // --- recycling ------------------------------------------------------------

  function recycle(userId, articleId, qty = 1) {
    qty = Math.floor(Number(qty));
    if (!(qty >= 1)) throw new GameError('Invalid quantity');
    return tx(db, () => {
      const row = db.prepare(`SELECT uc.count, a.rarity FROM user_cards uc JOIN articles a ON a.id = uc.article_id
        WHERE uc.user_id = ? AND uc.article_id = ?`).get(userId, articleId);
      if (!row) throw new GameError('You do not own this card', 404);
      if (row.count - qty < 1) throw new GameError('You can only recycle duplicates (one copy always stays in your album)');
      takeCard(db, userId, articleId, qty);
      const coins = RARITY_BY_ID[row.rarity].recycle * qty;
      addCoins(db, userId, coins, 'recycle', now());
      return { coins, profile: profile(userId) };
    });
  }

  function recycleAllDuplicates(userId, maxRarity = 'R') {
    const cap = RARITY_RANK[maxRarity] ?? RARITY_RANK.R;
    return tx(db, () => {
      const rows = db.prepare(`SELECT uc.article_id, uc.count, a.rarity FROM user_cards uc JOIN articles a ON a.id = uc.article_id
        WHERE uc.user_id = ? AND uc.count > 1 AND uc.locked = 0`).all(userId).filter((r) => RARITY_RANK[r.rarity] <= cap);
      let coins = 0;
      let cards = 0;
      for (const r of rows) {
        const extra = r.count - 1;
        coins += RARITY_BY_ID[r.rarity].recycle * extra;
        cards += extra;
        takeCard(db, userId, r.article_id, extra);
      }
      addCoins(db, userId, coins, 'recycle', now());
      return { coins, cards, profile: profile(userId) };
    });
  }

  // --- themed sets ----------------------------------------------------------

  function setsProgress(userId) {
    const claimed = new Set(db.prepare('SELECT set_id FROM set_claims WHERE user_id = ?').all(userId).map((r) => r.set_id));
    return catalog.sets.map((set) => {
      const members = set.titles.map((title) => {
        const row = db.prepare(`SELECT ${CARD_COLS}, uc.count FROM set_members sm
          JOIN articles a ON a.id = sm.article_id
          LEFT JOIN user_cards uc ON uc.article_id = a.id AND uc.user_id = ?
          WHERE sm.set_id = ? AND sm.title = ?`).get(userId, set.id, title);
        return { title, owned: !!row?.count, card: row ? cardView(row) : null };
      });
      const owned = members.filter((m) => m.owned).length;
      return {
        id: set.id, name: set.name, emoji: set.emoji, owned, size: set.titles.length,
        complete: owned === set.titles.length, claimed: claimed.has(set.id), reward: config.setRewardPacks, members,
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
      checkAchievements(db, userId, now());
      return { packs: config.setRewardPacks, profile: profile(userId) };
    });
  }

  // --- public pages ---------------------------------------------------------

  function leaderboard() {
    const notBanned = 'u.banned_at IS NULL';
    const score = db.prepare(`
      SELECT u.username, COUNT(a.id) AS cards, COALESCE(SUM(${POINTS_SQL}), 0) AS score, MAX(${RANK_SQL}) AS best,
        (SELECT g.tag FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id WHERE gm.user_id = u.id) AS guild
      FROM users u LEFT JOIN user_cards uc ON uc.user_id = u.id LEFT JOIN articles a ON a.id = uc.article_id
      WHERE ${notBanned} GROUP BY u.id ORDER BY score DESC, cards DESC LIMIT 50`).all();
    const week = db.prepare(`
      SELECT u.username, COUNT(a.id) AS cards, COALESCE(SUM(${POINTS_SQL}), 0) AS score
      FROM users u JOIN user_cards uc ON uc.user_id = u.id AND uc.first_at >= ? JOIN articles a ON a.id = uc.article_id
      WHERE ${notBanned} GROUP BY u.id ORDER BY score DESC LIMIT 50`).all(weekStart(now()));
    const quiz = db.prepare(`SELECT username, quiz_correct AS correct FROM users u WHERE ${notBanned} AND quiz_correct > 0
      ORDER BY quiz_correct DESC LIMIT 50`).all();
    const duels = db.prepare(`SELECT username, duel_wins AS wins, duel_losses AS losses FROM users u
      WHERE ${notBanned} AND duel_wins + duel_losses > 0 ORDER BY duel_wins DESC, duel_losses ASC LIMIT 50`).all();
    const guilds = db.prepare(`
      SELECT g.name, g.tag, COUNT(DISTINCT gm.user_id) AS members,
        COALESCE((SELECT SUM(${POINTS_SQL}) FROM guild_members m JOIN user_cards uc ON uc.user_id = m.user_id
          JOIN articles a ON a.id = uc.article_id WHERE m.guild_id = g.id), 0) AS score
      FROM guilds g JOIN guild_members gm ON gm.guild_id = g.id GROUP BY g.id ORDER BY score DESC LIMIT 50`).all();
    return {
      score: score.map((r) => ({ ...r, best: r.best === null ? null : RARITIES[r.best].id })),
      week: { since: weekStart(now()), rows: week },
      quiz, duels, guilds,
    };
  }

  function recentPulls(minRarity = 'SR', limit = 24) {
    const rarities = RARITIES.filter((r) => RARITY_RANK[r.id] >= (RARITY_RANK[minRarity] ?? 0)).map((r) => r.id);
    const rows = db.prepare(`
      SELECT ${CARD_COLS}, p.created_at, u.username FROM pulls p
      JOIN articles a ON a.id = p.article_id JOIN users u ON u.id = p.user_id
      WHERE a.rarity IN (${rarities.map(() => '?').join(',')}) AND u.banned_at IS NULL
      ORDER BY p.id DESC LIMIT ?`).all(...rarities, Math.min(100, limit));
    return rows.map((r) => ({ ...cardView(r), username: r.username, at: r.created_at }));
  }

  function publicProfile(username, viewerId) {
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username));
    if (!u || u.banned_at) throw new GameError('Player not found', 404);
    const showcase = db.prepare(`SELECT ${CARD_COLS} FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? AND uc.pinned = 1 ORDER BY ${RANK_SQL} DESC LIMIT 8`).all(u.id).map((r) => cardView(r));
    const guild = db.prepare(`SELECT g.name, g.tag FROM guild_members gm JOIN guilds g ON g.id = gm.guild_id WHERE gm.user_id = ?`).get(u.id);
    const stats = db.prepare('SELECT COUNT(*) AS n FROM user_cards WHERE user_id = ?').get(u.id);
    let friendship = null;
    if (viewerId && viewerId !== u.id) {
      const f = db.prepare(`SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`)
        .get(viewerId, u.id, u.id, viewerId);
      friendship = f ? (f.status === 'accepted' ? 'friends' : f.requester_id === viewerId ? 'requested' : 'incoming') : 'none';
    }
    return {
      username: u.username,
      joinedAt: u.created_at,
      uniqueCards: stats.n,
      score: collectionScore(u.id),
      duels: { wins: u.duel_wins, losses: u.duel_losses },
      quizCorrect: u.quiz_correct,
      guild: guild || null,
      showcase,
      achievements: achievementsFor(db, u.id).filter((a) => a.unlockedAt),
      friendship,
      isMe: viewerId === u.id,
    };
  }

  function userCards(username, viewerId, { dupesOnly = false } = {}) {
    const u = db.prepare('SELECT id, username FROM users WHERE username = ? AND banned_at IS NULL').get(String(username));
    if (!u) throw new GameError('Player not found', 404);
    const rows = db.prepare(`SELECT ${CARD_COLS}, uc.count, uc.locked FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? ${dupesOnly ? 'AND uc.count > 1' : ''} ORDER BY ${RANK_SQL} DESC, a.score DESC LIMIT 500`).all(u.id);
    return { username: u.username, cards: rows.map((r) => cardView(r)) };
  }

  // Cards other players hold unlocked spare copies of and that the viewer is missing.
  function tradeFinder(userId, { q } = {}) {
    const rows = db.prepare(`
      SELECT ${CARD_COLS}, uc.count, u.username,
        EXISTS (SELECT 1 FROM wishlist w WHERE w.user_id = ? AND w.article_id = a.id) AS wished
      FROM user_cards uc JOIN articles a ON a.id = uc.article_id JOIN users u ON u.id = uc.user_id
      WHERE uc.user_id != ? AND uc.count > 1 AND uc.locked = 0 AND u.banned_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM user_cards m WHERE m.user_id = ? AND m.article_id = uc.article_id)
        ${q ? 'AND a.title LIKE ?' : ''}
      ORDER BY wished DESC, ${RANK_SQL} DESC, a.score DESC LIMIT 120`).all(userId, userId, userId, ...(q ? [`%${q}%`] : []));
    return rows.map((r) => ({ ...cardView(r), owner: r.username, spare: r.count - 1, wished: !!r.wished }));
  }

  return {
    syncPacks, profile, shop, openPack, spinJackpot, collection, card, setCardFlags, exportCollection,
    wishlist, setWish, recycle, recycleAllDuplicates, setsProgress, claimSet, leaderboard, recentPulls,
    publicProfile, userCards, tradeFinder, collectionScore, burn,
  };
}
