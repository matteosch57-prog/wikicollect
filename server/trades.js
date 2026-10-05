// Player-to-player exchanges. An offer lists cards the sender gives and cards
// they want from the recipient. Ownership is checked when the offer is made
// and again, atomically, when it is accepted.

import { config } from './config.js';
import { tx } from './db.js';
import { cardView } from './game.js';
import { GameError } from './errors.js';

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

  function assertOwns(userId, items, who) {
    for (const [articleId, qty] of items) {
      const row = db.prepare('SELECT count FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, articleId);
      if (!row || row.count < qty) {
        const title = db.prepare('SELECT title FROM articles WHERE id = ?').get(articleId)?.title || `#${articleId}`;
        throw new GameError(`${who} no longer own${who === 'You' ? '' : 's'} enough copies of “${title}”`, 409);
      }
    }
  }

  function create(fromId, { to, give, want, message = '' }) {
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(String(to || ''));
    if (!target) throw new GameError('Player not found', 404);
    if (target.id === fromId) throw new GameError("You can't trade with yourself");
    const giveItems = normalizeItems(give);
    const wantItems = normalizeItems(want);
    const size = (m) => [...m.values()].reduce((s, n) => s + n, 0);
    if (!size(giveItems) && !size(wantItems)) throw new GameError('An offer needs at least one card');
    if (size(giveItems) > config.trade.maxItemsPerSide || size(wantItems) > config.trade.maxItemsPerSide) {
      throw new GameError(`At most ${config.trade.maxItemsPerSide} cards per side`);
    }
    const pending = db.prepare("SELECT COUNT(*) AS n FROM trades WHERE from_user = ? AND status = 'pending'").get(fromId).n;
    if (pending >= config.trade.maxPendingPerUser) throw new GameError('Too many pending offers — cancel some first', 429);

    return tx(db, () => {
      assertOwns(fromId, giveItems, 'You');
      assertOwns(target.id, wantItems, target.username);
      const { lastInsertRowid } = db.prepare(
        'INSERT INTO trades (from_user, to_user, message, created_at) VALUES (?, ?, ?, ?)',
      ).run(fromId, target.id, String(message).slice(0, 200), now());
      const id = Number(lastInsertRowid);
      const add = db.prepare('INSERT INTO trade_items (trade_id, side, article_id, qty) VALUES (?, ?, ?, ?)');
      for (const [a, q] of giveItems) add.run(id, 'give', a, q);
      for (const [a, q] of wantItems) add.run(id, 'want', a, q);
      return get(id, fromId);
    });
  }

  function get(id, viewerId) {
    const t = db.prepare(`
      SELECT t.*, f.username AS from_name, r.username AS to_name FROM trades t
      JOIN users f ON f.id = t.from_user JOIN users r ON r.id = t.to_user WHERE t.id = ?`).get(id);
    if (!t || (t.from_user !== viewerId && t.to_user !== viewerId)) throw new GameError('Offer not found', 404);
    const items = db.prepare(`
      SELECT ti.side, ti.qty, a.* FROM trade_items ti JOIN articles a ON a.id = ti.article_id WHERE ti.trade_id = ?`).all(id);
    const side = (s) => items.filter((i) => i.side === s).map((i) => ({ ...cardView(i), extract: undefined, qty: i.qty }));
    return {
      id: t.id,
      from: t.from_name,
      to: t.to_name,
      direction: t.from_user === viewerId ? 'outgoing' : 'incoming',
      status: t.status,
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

  function moveCard(fromId, toId, articleId, qty) {
    const left = db.prepare('UPDATE user_cards SET count = count - ? WHERE user_id = ? AND article_id = ? RETURNING count')
      .get(qty, fromId, articleId).count;
    if (left === 0) db.prepare('DELETE FROM user_cards WHERE user_id = ? AND article_id = ?').run(fromId, articleId);
    db.prepare(`INSERT INTO user_cards (user_id, article_id, count, first_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user_id, article_id) DO UPDATE SET count = count + excluded.count`).run(toId, articleId, qty, now());
  }

  function resolve(userId, id, action) {
    return tx(db, () => {
      const t = db.prepare('SELECT * FROM trades WHERE id = ?').get(id);
      if (!t || (t.from_user !== userId && t.to_user !== userId)) throw new GameError('Offer not found', 404);
      if (t.status !== 'pending') throw new GameError(`This offer is already ${t.status}`, 409);

      if (action === 'cancel' && t.from_user !== userId) throw new GameError('Only the sender can cancel', 403);
      if ((action === 'accept' || action === 'decline') && t.to_user !== userId) {
        throw new GameError('Only the recipient can answer this offer', 403);
      }
      const finish = (status) =>
        db.prepare('UPDATE trades SET status = ?, resolved_at = ? WHERE id = ?').run(status, now(), id);

      if (action === 'accept') {
        const items = db.prepare('SELECT side, article_id, qty FROM trade_items WHERE trade_id = ?').all(id);
        const give = new Map(items.filter((i) => i.side === 'give').map((i) => [i.article_id, i.qty]));
        const want = new Map(items.filter((i) => i.side === 'want').map((i) => [i.article_id, i.qty]));
        const fromName = db.prepare('SELECT username FROM users WHERE id = ?').get(t.from_user).username;
        assertOwns(t.from_user, give, fromName);
        assertOwns(t.to_user, want, 'You');
        for (const [a, q] of give) moveCard(t.from_user, t.to_user, a, q);
        for (const [a, q] of want) moveCard(t.to_user, t.from_user, a, q);
        finish('accepted');
      } else if (action === 'decline') {
        finish('declined');
      } else if (action === 'cancel') {
        finish('cancelled');
      } else {
        throw new GameError('Unknown action');
      }
      return get(id, userId);
    });
  }

  return { create, list, get, resolve };
}
