// In-app notifications and achievements. Both are written from inside other
// features' transactions, so they never get out of sync with the game state.

import { addCoins } from './db.js';

export function notify(db, userId, type, data = {}, now = Date.now()) {
  db.prepare('INSERT INTO notifications (user_id, type, data, created_at) VALUES (?, ?, ?, ?)')
    .run(userId, type, JSON.stringify(data), now);
}

export function listNotifications(db, userId, { limit = 40 } = {}) {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, Math.min(100, limit));
  return rows.map((r) => ({ id: r.id, type: r.type, data: JSON.parse(r.data), createdAt: r.created_at, read: !!r.read_at }));
}

export function unreadCount(db, userId) {
  return db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

export function markRead(db, userId, ids, now = Date.now()) {
  if (ids === 'all') db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, userId);
  else for (const id of ids) db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?').run(now, Number(id), userId);
}

// --- achievements ------------------------------------------------------------

const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;

export const ACHIEVEMENTS = [
  { id: 'first_pack', name: 'First pull', desc: 'Open your first pack', reward: 20,
    test: (db, u) => u.packs_opened >= 1 },
  { id: 'packs_50', name: 'Pack addict', desc: 'Open 50 packs', reward: 100,
    test: (db, u) => u.packs_opened >= 50 },
  { id: 'packs_500', name: 'Booster baron', desc: 'Open 500 packs', reward: 400,
    test: (db, u) => u.packs_opened >= 500 },
  { id: 'album_100', name: 'Librarian', desc: 'Own 100 different cards', reward: 100,
    test: (db, u) => count(db, 'SELECT COUNT(*) AS n FROM user_cards WHERE user_id = ?', u.id) >= 100 },
  { id: 'album_1000', name: 'Encyclopedist', desc: 'Own 1,000 different cards', reward: 500,
    test: (db, u) => count(db, 'SELECT COUNT(*) AS n FROM user_cards WHERE user_id = ?', u.id) >= 1000 },
  { id: 'first_ur', name: 'Ultra find', desc: 'Own an Ultra Rare card', reward: 50,
    test: (db, u) => count(db, `SELECT COUNT(*) AS n FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? AND a.rarity IN ('UR', 'L')`, u.id) >= 1 },
  { id: 'first_l', name: 'Legend', desc: 'Own a Legendary card', reward: 150,
    test: (db, u) => count(db, `SELECT COUNT(*) AS n FROM user_cards uc JOIN articles a ON a.id = uc.article_id
      WHERE uc.user_id = ? AND a.rarity = 'L'`, u.id) >= 1 },
  { id: 'set_1', name: 'Completionist', desc: 'Complete a themed set', reward: 100,
    test: (db, u) => count(db, 'SELECT COUNT(*) AS n FROM set_claims WHERE user_id = ?', u.id) >= 1 },
  { id: 'trade_1', name: 'Fair deal', desc: 'Complete a trade', reward: 40,
    test: (db, u) => count(db, `SELECT COUNT(*) AS n FROM trades WHERE status = 'accepted' AND (from_user = ? OR to_user = ?)`, u.id, u.id) >= 1 },
  { id: 'trade_25', name: 'Merchant', desc: 'Complete 25 trades', reward: 200,
    test: (db, u) => count(db, `SELECT COUNT(*) AS n FROM trades WHERE status = 'accepted' AND (from_user = ? OR to_user = ?)`, u.id, u.id) >= 25 },
  { id: 'duel_1', name: 'Duelist', desc: 'Win a duel', reward: 50,
    test: (db, u) => u.duel_wins >= 1 },
  { id: 'duel_25', name: 'Champion', desc: 'Win 25 duels', reward: 300,
    test: (db, u) => u.duel_wins >= 25 },
  { id: 'quiz_50', name: 'Know-it-all', desc: 'Answer 50 quiz questions correctly', reward: 100,
    test: (db, u) => u.quiz_correct >= 50 },
  { id: 'auction_1', name: 'Auctioneer', desc: 'Sell a card at auction', reward: 40,
    test: (db, u) => count(db, `SELECT COUNT(*) AS n FROM auctions WHERE seller_id = ? AND status = 'sold'`, u.id) >= 1 },
  { id: 'friend_1', name: 'Pen pal', desc: 'Make a friend', reward: 20,
    test: (db, u) => count(db, `SELECT COUNT(*) AS n FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`, u.id, u.id) >= 1 },
  { id: 'guild_1', name: 'Fellowship', desc: 'Join a guild', reward: 30,
    test: (db, u) => count(db, 'SELECT COUNT(*) AS n FROM guild_members WHERE user_id = ?', u.id) >= 1 },
];

// Unlocks whatever the player now qualifies for. Cheap enough to call after
// any game event; returns the newly unlocked achievements.
export function checkAchievements(db, userId, now = Date.now()) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!u) return [];
  const have = new Set(db.prepare('SELECT achievement_id FROM achievements WHERE user_id = ?').all(userId).map((r) => r.achievement_id));
  const unlocked = [];
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id) || !a.test(db, u)) continue;
    db.prepare('INSERT INTO achievements (user_id, achievement_id, unlocked_at) VALUES (?, ?, ?)').run(userId, a.id, now);
    addCoins(db, userId, a.reward, `achievement:${a.id}`, now);
    notify(db, userId, 'achievement', { id: a.id, name: a.name, reward: a.reward }, now);
    unlocked.push({ id: a.id, name: a.name, reward: a.reward });
  }
  return unlocked;
}

export function achievementsFor(db, userId) {
  const have = new Map(db.prepare('SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?').all(userId)
    .map((r) => [r.achievement_id, r.unlocked_at]));
  return ACHIEVEMENTS.map(({ id, name, desc, reward }) => ({ id, name, desc, reward, unlockedAt: have.get(id) || null }));
}

