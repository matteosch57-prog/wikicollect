// Player-to-player exchanges. An offer lists cards the sender gives and cards
// they want from the recipient. The recipient can accept, decline or counter.
// Locked cards can be neither offered nor requested. Ownership is checked when
// the offer is made and again, atomically, when it is accepted.

import { config } from './config.js';
import { tx, grantCard, takeCard } from './db.js';
import { GameError } from './errors.js';
import { cardView } from './game.js';
import { notify, checkAchievements } from './notify.js';

export function createTrades({ db, now = Date.now }) {
  function normalizeItems(list) {
    const counts = new Map();
    for (const raw of Array.isArray(list) ? list : []) {
      const id = Number(raw);
      if (!Number.isInteger(id) || id <= 0) throw new GameError('Invalid card in offer');
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return counts;
  }

  function assertTradeable(userId, items, who) {
    for (const [articleId, qty] of items) {
      const row = db.prepare('SELECT count, locked FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, articleId);
      const title = db.prepare('SELECT title FROM articles WHERE id = ?').get(articleId)?.title || `#${articleId}`;
      if (!row || row.count < qty) {
        throw new GameError(`${who === 'You' ? "You don't" : `${who} doesn't`} have enough copies of “${title}”`, 409);
      }
      if (row.locked) throw new GameError(`“${title}” is locked by ${who === 'You' ? 'you' : who} and can't be traded`, 409);
    }
  }

  function insertOffer(fromId, toId, give, want, message, parentId = null) {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO trades (from_user, to_user, message, parent_id, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(fromId, toId, String(message || '').slice(0, 200), parentId, now());
    const id = Number(lastInsertRowid);
    const add = db.prepare('INSERT INTO trade_items (trade_id, side, article_id, qty) VALUES (?, ?, ?, ?)');
    for (const [a, q] of give) add.run(id, 'give', a, q);
    for (const [a, q] of want) add.run(id, 'want', a, q);
    return id;
  }

  function validateOffer(fromId, target, give, want) {
    const size = (m) => [...m.values()].reduce((s, n) => s + n, 0);
    if (!size(give) && !size(want)) throw new GameError('An offer needs at least one card');
    if (size(give) > config.trade.maxItemsPerSide || size(want) > config.trade.maxItemsPerSide) {
      throw new GameError(`At most ${config.trade.maxItemsPerSide} cards per side`);
    }
    const pending = db.prepare("SELECT COUNT(*) AS n FROM trades WHERE from_user = ? AND status = 'pending'").get(fromId).n;
    if (pending >= config.trade.maxPendingPerUser) throw new GameError('Too many pending offers — cancel some first', 429);
    assertTradeable(fromId, give, 'You');
    assertTradeable(target.id, want, target.username);
  }

  function create(fromId, { to, give, want, message = '' }) {
    const target = db.prepare('SELECT id, username FROM users WHERE username = ? AND banned_at IS NULL').get(String(to || ''));
    if (!target) throw new GameError('Player not found', 404);
    if (target.id === fromId) throw new GameError("You can't trade with yourself");
    const giveItems = normalizeItems(give);
    const wantItems = normalizeItems(want);
    return tx(db, () => {
      validateOffer(fromId, target, giveItems, wantItems);
      const id = insertOffer(fromId, target.id, giveItems, wantItems, message);
      notify(db, target.id, 'trade_offer', { tradeId: id, from: username(fromId) }, now());
      return get(id, fromId);
    });
  }

  const username = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username;

  function get(id, viewerId) {
    const t = db.prepare(`
      SELECT t.*, f.username AS from_name, r.username AS to_name FROM trades t
      JOIN users f ON f.id = t.from_user JOIN users r ON r.id = t.to_user WHERE t.id = ?`).get(id);
    if (!t || (t.from_user !== viewerId && t.to_user !== viewerId)) throw new GameError('Offer not found', 404);
    const items = db.prepare(`
      SELECT ti.side, ti.qty, a.* FROM trade_items ti JOIN articles a ON a.id = ti.article_id WHERE ti.trade_id = ?`).all(id);
    const side = (s) => items.filter((i) => i.side === s).map((i) => ({ ...cardView(i), qty: i.qty }));
    return {
      id: t.id,
      from: t.from_name,
      to: t.to_name,
      direction: t.from_user === viewerId ? 'outgoing' : 'incoming',
      status: t.status,
      parentId: t.parent_id,
      message: t.message,
      createdAt: t.created_at,
      resolvedAt: t.resolved_at,
      give: side('give'),
      want: side('want'),
    };
  }

  function list(userId) {
    const rows = db.prepare(`
      SELECT id FROM trades WHERE (from_user = ? OR to_user = ?)
        AND (status = 'pending' OR resolved_at > ?)
      ORDER BY id DESC LIMIT 100`).all(userId, userId, now() - 7 * 24 * 3600 * 1000);
    return rows.map((r) => get(r.id, userId));
  }

  function loadPending(userId, id) {
    const t = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
    if (!t || (t.from_user !== userId && t.to_user !== userId)) throw new GameError('Offer not found', 404);
    if (t.status !== 'pending') throw new GameError(`This offer is already ${t.status}`, 409);
    return t;
  }

  const finish = (id, status) =>
    db.prepare('UPDATE trades SET status = ?, resolved_at = ? WHERE id = ?').run(status, now(), id);

  function resolve(userId, id, action) {
    return tx(db, () => {
      const t = loadPending(userId, id);
      if (action === 'cancel' && t.from_user !== userId) throw new GameError('Only the sender can cancel', 403);
      if ((action === 'accept' || action === 'decline') && t.to_user !== userId) {
        throw new GameError('Only the recipient can answer this offer', 403);
      }

      if (action === 'accept') {
        const items = db.prepare('SELECT side, article_id, qty FROM trade_items WHERE trade_id = ?').all(id);
        const give = new Map(items.filter((i) => i.side === 'give').map((i) => [i.article_id, i.qty]));
        const want = new Map(items.filter((i) => i.side === 'want').map((i) => [i.article_id, i.qty]));
        assertTradeable(t.from_user, give, username(t.from_user));
        assertTradeable(t.to_user, want, 'You');
        for (const [a, q] of give) {
          takeCard(db, t.from_user, a, q);
          grantCard(db, t.to_user, a, q, now());
        }
        for (const [a, q] of want) {
          takeCard(db, t.to_user, a, q);
          grantCard(db, t.from_user, a, q, now());
        }
        finish(id, 'accepted');
        notify(db, t.from_user, 'trade_accepted', { tradeId: id, by: username(t.to_user) }, now());
        checkAchievements(db, t.from_user, now());
        checkAchievements(db, t.to_user, now());
      } else if (action === 'decline') {
        finish(id, 'declined');
        notify(db, t.from_user, 'trade_declined', { tradeId: id, by: username(t.to_user) }, now());
      } else if (action === 'cancel') {
        finish(id, 'cancelled');
      } else {
        throw new GameError('Unknown action');
      }
      return get(id, userId);
    });
  }

  // The recipient answers with different terms: the original offer closes and
  // a new one goes back to the sender.
  function counter(userId, id, { give, want, message = '' }) {
    return tx(db, () => {
      const t = loadPending(userId, id);
      if (t.to_user !== userId) throw new GameError('Only the recipient can counter this offer', 403);
      const target = { id: t.from_user, username: username(t.from_user) };
      const giveItems = normalizeItems(give);
      const wantItems = normalizeItems(want);
      validateOffer(userId, target, giveItems, wantItems);
      finish(id, 'countered');
      const newId = insertOffer(userId, t.from_user, giveItems, wantItems, message, id);
      notify(db, t.from_user, 'trade_countered', { tradeId: newId, by: username(userId) }, now());
      return get(newId, userId);
    });
  }

  return { create, list, get, resolve, counter };
}
