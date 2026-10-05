import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { config } from '../server/config.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(() => srv.close());

const coins = async (c) => (await c.get('/api/me')).data.coins;

test('shop: paid packs cost coins, which are burned; odds are published', async () => {
  const c = await srv.client().signup('buyer');
  const shop = (await c.get('/api/shop')).data;
  const premium = shop.packs.find((p) => p.id === 'premium');
  assert.ok(premium.slots.every((s) => !('C' in s) && !('PC' in s)), 'premium never drops C/PC');
  assert.equal(shop.themes.length, config.themePack.active);

  assert.equal((await c.post('/api/packs/open', { type: 'premium' })).status, 409, 'cannot afford');
  srv.setCoins('buyer', 1000);
  const r = await c.post('/api/packs/open', { type: 'premium' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.cards.every((x) => !['C', 'PC'].includes(x.rarity)), JSON.stringify(r.data.cards.map((x) => x.rarity)));
  const bonus = r.data.achievements.reduce((sum, a) => sum + a.reward, 0);
  assert.equal(r.data.profile.coins, 1000 - premium.price + bonus);
  assert.equal(r.data.profile.packs, config.packs.starterPacks, 'paid packs do not use free stock');
  assert.ok((await c.get('/api/shop')).data.coinsBurned >= premium.price);

  const theme = shop.themes[0];
  srv.setCoins('buyer', 1000);
  const t = await c.post('/api/packs/open', { type: 'theme', theme: theme.id });
  assert.equal(t.status, 200, JSON.stringify(t.data));
  const sets = (await c.get('/api/sets')).data;
  const memberIds = new Set(sets.find((s) => s.id === theme.id).members.map((m) => m.card?.id));
  assert.ok(t.data.cards.every((x) => memberIds.has(x.id)), 'theme packs only contain set cards');
  const inactive = sets.map((s) => s.id).find((id) => !shop.themes.some((th) => th.id === id));
  assert.equal((await c.post('/api/packs/open', { type: 'theme', theme: inactive })).status, 400);
});

test('jackpot burns half of each ticket and grows the pot', async () => {
  const c = await srv.client().signup('gambler');
  srv.setCoins('gambler', 5000);
  const before = (await c.get('/api/shop')).data;
  const r = await c.post('/api/jackpot/spin');
  assert.equal(r.status, 200);
  const after = (await c.get('/api/shop')).data;
  const J = config.jackpot;
  if (!r.data.won) {
    assert.equal(after.jackpot.pot, before.jackpot.pot + J.ticket * (1 - J.burnRate));
    assert.equal(await coins(c), 5000 - J.ticket);
  }
  assert.equal(after.coinsBurned - before.coinsBurned, J.ticket * J.burnRate);
});

test('auctions escrow cards and coins, tax the sale and block quick flips', async () => {
  const seller = await srv.client().signup('seller');
  const b1 = await srv.client().signup('bidder1');
  const b2 = await srv.client().signup('bidder2');
  const fan = await srv.client().signup('fan');
  srv.give('seller', 1020, 1);
  srv.setCoins('seller', 100);
  srv.setCoins('bidder1', 1000);
  srv.setCoins('bidder2', 1000);
  await fan.post('/api/cards/1020/wish', { wished: true });

  assert.equal((await seller.post('/api/auctions', { articleId: 1020, startPrice: 200, durationH: 5 })).status, 400, 'bad duration');
  const created = await seller.post('/api/auctions', { articleId: 1020, startPrice: 200, durationH: 1 });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.id;
  assert.equal(await coins(seller), 100 - config.market.minListingFee, 'listing fee');
  assert.equal((await seller.get('/api/cards/1020')).data.mine, 0, 'card held in escrow');
  assert.ok((await fan.get('/api/notifications')).data.some((n) => n.type === 'marketplace_wishlist_listed'));

  assert.equal((await seller.post(`/api/auctions/${id}/bid`, { amount: 300 })).status, 400, 'no self-bids');
  assert.equal((await b1.post(`/api/auctions/${id}/bid`, { amount: 150 })).status, 409, 'below start');
  assert.equal((await b1.post(`/api/auctions/${id}/bid`, { amount: 200 })).status, 200);
  assert.equal(await coins(b1), 800);
  assert.equal((await b2.post(`/api/auctions/${id}/bid`, { amount: 205 })).status, 409, 'min increment 5%');
  assert.equal((await b2.post(`/api/auctions/${id}/bid`, { amount: 300 })).status, 200);
  assert.equal(await coins(b1), 1000, 'outbid bidder refunded');
  assert.ok((await b1.get('/api/notifications')).data.some((n) => n.type === 'marketplace_outbid'));
  assert.equal((await seller.post(`/api/auctions/${id}/cancel`)).status, 409, 'cannot cancel with bids');

  // Late bid extends the countdown.
  srv.clock.t = created.data.endsAt - 30_000;
  const late = await b1.post(`/api/auctions/${id}/bid`, { amount: 400 });
  assert.equal(late.status, 200);
  assert.equal(late.data.auction.endsAt, srv.clock.t + config.market.antiSnipeMs);

  srv.clock.t = late.data.auction.endsAt + 1;
  srv.market.settleDue();
  const tax = Math.round(400 * config.market.salesTaxRate);
  const sale = srv.db.prepare('SELECT delta FROM coin_ledger WHERE reason = ?').get(`auction:sold:${id}`);
  assert.equal(sale.delta, 400 - tax, 'seller receives the price minus the burned tax');
  const auctionFlow = (name) => srv.db.prepare("SELECT COALESCE(SUM(delta), 0) AS s FROM coin_ledger WHERE user_id = ? AND reason LIKE 'auction:%'").get(srv.userId(name)).s;
  assert.equal(auctionFlow('bidder1'), -400, 'winner paid the final bid');
  assert.equal(auctionFlow('bidder2'), 0, 'loser fully refunded');
  assert.equal((await b1.get('/api/cards/1020')).data.mine, 1);
  assert.equal((await b1.get(`/api/auctions/${id}`)).data.status, 'sold');

  // Anti-flipping: can't relist for 48h.
  srv.setCoins('bidder1', 1000);
  assert.equal((await b1.post('/api/auctions', { articleId: 1020, startPrice: 900, durationH: 1 })).status, 409);
  srv.clock.t += config.market.relistCooldownMs + 1;
  assert.equal((await b1.post('/api/auctions', { articleId: 1020, startPrice: 900, durationH: 1 })).status, 200);
});

test('unsold auctions return the card; locked cards cannot be listed', async () => {
  const s = await srv.client().signup('seller2');
  srv.give('seller2', 1021, 1);
  srv.give('seller2', 1022, 1);
  srv.setCoins('seller2', 100);
  await s.post('/api/cards/1022/flags', { locked: true });
  assert.equal((await s.post('/api/auctions', { articleId: 1022, startPrice: 10, durationH: 1 })).status, 409);
  const a = await s.post('/api/auctions', { articleId: 1021, startPrice: 10, durationH: 1 });
  srv.clock.t = a.data.endsAt + 1;
  srv.market.settleDue();
  assert.equal((await s.get(`/api/auctions/${a.data.id}`)).data.status, 'unsold');
  assert.equal((await s.get('/api/cards/1021')).data.mine, 1);
});
