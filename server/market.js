// Auction house. Cards and coins are held in escrow, so nothing can "jump":
//   - listing removes the card from the seller's album (a small fee is burned)
//   - bidding takes the coins from the bidder; being outbid refunds them
//   - settlement moves card and coins in one transaction, minus a sales tax
//     that is destroyed (coin sink against inflation)
// Late bids extend the countdown (anti-sniping), and a card bought at auction
// can't be relisted for 48h (anti-flipping).

import { config } from './config.js';
import { tx, addCoins, grantCard, takeCard } from './db.js';
import { GameError } from './errors.js';
import { cardView } from './game.js';
import { notify, checkAchievements } from './notify.js';

const M = config.market;

export function createMarket({ db, game, now = Date.now }) {
  const nameOf = (id) => (id ? db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username : null);

  function view(row, viewerId) {
    const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(row.article_id);
    return {
      id: row.id,
      card: cardView(article),
      seller: nameOf(row.seller_id),
      startPrice: row.start_price,
      currentBid: row.current_bid,
      leader: nameOf(row.current_bidder),
      bids: row.bids_count,
      minBid: minBid(row),
      status: row.status,
      createdAt: row.created_at,
      endsAt: row.ends_at,
      mine: row.seller_id === viewerId,
      leading: !!viewerId && row.current_bidder === viewerId,
    };
  }

  function minBid(row) {
    return row.current_bid ? row.current_bid + Math.max(1, Math.ceil(row.current_bid * 0.05)) : row.start_price;
  }

  function listingFee(startPrice) {
    return Math.max(M.minListingFee, Math.round(startPrice * M.listingFeeRate));
  }

  function settleDue() {
    const due = db.prepare("SELECT id FROM auctions WHERE status = 'open' AND ends_at <= ?").all(now());
    for (const { id } of due) {
      tx(db, () => {
        const a = db.prepare("SELECT * FROM auctions WHERE id = ? AND status = 'open'").get(id);
        if (!a) return;
        const t = now();
        const title = db.prepare('SELECT title FROM articles WHERE id = ?').get(a.article_id).title;
        if (a.current_bidder) {
          const tax = Math.round(a.current_bid * M.salesTaxRate);
          addCoins(db, a.seller_id, a.current_bid - tax, `auction:sold:${a.id}`, t);
          game.burn(tax);
          grantCard(db, a.current_bidder, a.article_id, 1, t, { relistAfter: t + M.relistCooldownMs });
          db.prepare("UPDATE auctions SET status = 'sold', settled_at = ? WHERE id = ?").run(t, a.id);
          notify(db, a.seller_id, 'marketplace_auction_sold', { auctionId: a.id, title, price: a.current_bid, net: a.current_bid - tax }, t);
          notify(db, a.current_bidder, 'marketplace_auction_won', { auctionId: a.id, title, price: a.current_bid }, t);
          checkAchievements(db, a.seller_id, t);
          checkAchievements(db, a.current_bidder, t);
        } else {
          grantCard(db, a.seller_id, a.article_id, 1, t);
          db.prepare("UPDATE auctions SET status = 'unsold', settled_at = ? WHERE id = ?").run(t, a.id);
          notify(db, a.seller_id, 'marketplace_auction_unsold', { auctionId: a.id, title }, t);
        }
      });
    }
    return due.length;
  }

  function list(viewerId, { q, rarity, scope = 'all', sort = 'ending' } = {}) {
    settleDue();
    const where = [];
    const args = [];
    if (scope === 'mine') {
      where.push('au.seller_id = ?');
      args.push(viewerId);
    } else if (scope === 'bidding') {
      where.push("au.status = 'open' AND EXISTS (SELECT 1 FROM bids b WHERE b.auction_id = au.id AND b.user_id = ?)");
      args.push(viewerId);
    } else if (scope === 'wishlist') {
      where.push("au.status = 'open' AND EXISTS (SELECT 1 FROM wishlist w WHERE w.user_id = ? AND w.article_id = au.article_id)");
      args.push(viewerId);
    } else {
      where.push("au.status = 'open'");
    }
    if (q) {
      where.push('a.title LIKE ?');
      args.push(`%${String(q).slice(0, 80)}%`);
    }
    if (rarity) {
      where.push('a.rarity = ?');
      args.push(rarity);
    }
    const order = {
      ending: "au.status = 'open' DESC, au.ends_at ASC",
      newest: 'au.id DESC',
      price: 'COALESCE(au.current_bid, au.start_price) ASC',
    }[sort] || 'au.ends_at ASC';
    const rows = db.prepare(`SELECT au.* FROM auctions au JOIN articles a ON a.id = au.article_id
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 120`).all(...args);
    return rows.map((r) => view(r, viewerId));
  }

  function get(id, viewerId) {
    settleDue();
    const row = db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);
    if (!row) throw new GameError('Auction not found', 404);
    const bids = db.prepare(`SELECT b.amount, b.created_at, u.username FROM bids b JOIN users u ON u.id = b.user_id
      WHERE b.auction_id = ? ORDER BY b.id DESC LIMIT 30`).all(id).map((b) => ({ amount: b.amount, at: b.created_at, by: b.username }));
    return { ...view(row, viewerId), history: bids, fee: listingFee(row.start_price), taxRate: M.salesTaxRate };
  }

  function create(userId, { articleId, startPrice, durationH }) {
    startPrice = Math.floor(Number(startPrice));
    durationH = Number(durationH);
    if (!(startPrice >= 1 && startPrice <= 10_000_000)) throw new GameError('Starting price must be between 1 and 10,000,000');
    if (!M.durationsH.includes(durationH)) throw new GameError(`Duration must be one of ${M.durationsH.join(', ')} hours`);
    return tx(db, () => {
      const active = db.prepare("SELECT COUNT(*) AS n FROM auctions WHERE seller_id = ? AND status = 'open'").get(userId).n;
      if (active >= M.maxActivePerUser) throw new GameError(`At most ${M.maxActivePerUser} active auctions`);
      const own = db.prepare('SELECT relist_after FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, Number(articleId));
      if (own && own.relist_after > now()) {
        throw new GameError('Cards bought at auction can be relisted 48h after purchase', 409);
      }
      const fee = listingFee(startPrice);
      addCoins(db, userId, -fee, 'auction:fee', now());
      game.burn(fee);
      takeCard(db, userId, Number(articleId), 1);
      const t = now();
      const { lastInsertRowid } = db.prepare(`INSERT INTO auctions (seller_id, article_id, start_price, created_at, ends_at)
        VALUES (?, ?, ?, ?, ?)`).run(userId, Number(articleId), startPrice, t, t + durationH * 3600_000);
      const id = Number(lastInsertRowid);
      const title = db.prepare('SELECT title FROM articles WHERE id = ?').get(Number(articleId)).title;
      for (const w of db.prepare('SELECT user_id FROM wishlist WHERE article_id = ? AND user_id != ?').all(Number(articleId), userId)) {
        notify(db, w.user_id, 'marketplace_wishlist_listed', { auctionId: id, title }, t);
      }
      return get(id, userId);
    });
  }

  function bid(userId, id, amount) {
    settleDue();
    amount = Math.floor(Number(amount));
    return tx(db, () => {
      const a = db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);
      if (!a) throw new GameError('Auction not found', 404);
      if (a.status !== 'open' || a.ends_at <= now()) throw new GameError('This auction has ended', 409);
      if (a.seller_id === userId) throw new GameError("You can't bid on your own auction");
      if (!(amount >= minBid(a))) throw new GameError(`Minimum bid is ${minBid(a)} coins`, 409);
      const t = now();
      if (a.current_bidder) {
        addCoins(db, a.current_bidder, a.current_bid, `auction:refund:${a.id}`, t);
        if (a.current_bidder !== userId) {
          const title = db.prepare('SELECT title FROM articles WHERE id = ?').get(a.article_id).title;
          notify(db, a.current_bidder, 'marketplace_outbid', { auctionId: a.id, title, amount }, t);
        }
      }
      addCoins(db, userId, -amount, `auction:bid:${a.id}`, t);
      const endsAt = a.ends_at - t < M.antiSnipeMs ? t + M.antiSnipeMs : a.ends_at;
      db.prepare(`UPDATE auctions SET current_bid = ?, current_bidder = ?, bids_count = bids_count + 1, ends_at = ?
        WHERE id = ?`).run(amount, userId, endsAt, a.id);
      db.prepare('INSERT INTO bids (auction_id, user_id, amount, created_at) VALUES (?, ?, ?, ?)').run(a.id, userId, amount, t);
      return { auction: get(a.id, userId), profile: game.profile(userId) };
    });
  }

  function cancel(userId, id) {
    return tx(db, () => {
      const a = db.prepare('SELECT * FROM auctions WHERE id = ?').get(id);
      if (!a || a.seller_id !== userId) throw new GameError('Auction not found', 404);
      if (a.status !== 'open') throw new GameError('This auction is closed', 409);
      if (a.bids_count > 0) throw new GameError('Auctions with bids cannot be cancelled', 409);
      grantCard(db, userId, a.article_id, 1, now());
      db.prepare("UPDATE auctions SET status = 'cancelled', settled_at = ? WHERE id = ?").run(now(), id);
      return get(id, userId);
    });
  }

  return { list, get, create, bid, cancel, settleDue, listingFee };
}
