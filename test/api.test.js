import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { config } from '../server/config.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(() => srv.close());

test('registration validates input and blocks offensive names', async () => {
  const c = srv.client();
  const base = { email: 'x@example.test', password: 'secret123', adult: true, terms: true };
  assert.equal((await c.post('/api/register', { ...base, username: 'xX_Nazi_Xx' })).status, 400);
  assert.equal((await c.post('/api/register', { ...base, username: 'okname', adult: false })).status, 400);
  assert.equal((await c.post('/api/register', { ...base, username: 'okname', email: 'nope' })).status, 400);
  assert.equal((await c.post('/api/register', { ...base, username: 'okname', password: 'short' })).status, 400);
  await srv.client().signup('ada');
  assert.equal((await c.post('/api/register', { ...base, username: 'ADA', email: 'other@example.test' })).status, 409);
  assert.equal((await c.post('/api/register', { ...base, username: 'ada2', email: 'ADA@example.test' })).status, 409);
});

test('login by username or email; profile', async () => {
  const c = srv.client();
  assert.equal((await c.get('/api/me')).data, null);
  await c.signup('grace');
  const me = (await c.get('/api/me')).data;
  assert.equal(me.username, 'grace');
  assert.equal(me.packs, config.packs.starterPacks);
  assert.equal((await srv.client().post('/api/login', { username: 'grace', password: 'wrong-pass' })).status, 401);
  const viaEmail = srv.client();
  assert.equal((await viaEmail.post('/api/login', { username: 'GRACE@example.test', password: 'secret123' })).status, 200);
  assert.equal((await viaEmail.get('/api/me')).data.username, 'grace');
  assert.equal((await srv.client().post('/api/packs/open')).status, 401);
});

test('responses carry security headers', async () => {
  const r = await srv.client().get('/api/config');
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.ok(r.headers.get('referrer-policy'));
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('free packs consume stock, fill the album and regenerate', async () => {
  const c = await srv.client().signup('opener');
  const r = await c.post('/api/packs/open', { type: 'free' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.cards.length, config.packs.cardsPerPack);
  assert.equal(new Set(r.data.cards.map((x) => x.id)).size, r.data.cards.length, 'no duplicates within a pack');
  for (const card of r.data.cards) {
    assert.ok(['C', 'PC', 'R', 'SR', 'UR', 'L'].includes(card.rarity));
    assert.ok(card.atk >= 0 && card.atk <= 10000 && card.def >= 0 && card.def <= 10000);
  }
  assert.equal(r.data.profile.packs, config.packs.starterPacks - 1);
  assert.ok(r.data.achievements.some((a) => a.id === 'first_pack'));

  for (let i = 1; i < config.packs.starterPacks; i++) assert.equal((await c.post('/api/packs/open')).status, 200);
  assert.equal((await c.post('/api/packs/open')).status, 409);
  srv.clock.t += config.packs.regenMs * 2 + 1000;
  assert.equal((await c.get('/api/me')).data.packs, 2);
  srv.clock.t += config.packs.regenMs * 100;
  assert.equal((await c.get('/api/me')).data.packs, config.packs.maxStock);
});

test('album: tags, pins, locks and export', async () => {
  const c = await srv.client().signup('curator');
  await c.post('/api/packs/open');
  const [first, second] = (await c.get('/api/collection')).data.cards;
  const flagged = await c.post(`/api/cards/${second.id}/flags`, { pinned: true, locked: true, tags: ['Science', 'Science', 'fav'] });
  assert.equal(flagged.status, 200);
  assert.deepEqual(flagged.data.tags.sort(), ['Science', 'fav']);
  const album = (await c.get('/api/collection')).data;
  assert.equal(album.cards[0].id, second.id, 'pinned cards come first');
  assert.ok(album.cards[0].locked);
  assert.deepEqual(album.tags, ['Science', 'fav']);
  assert.equal((await c.get('/api/collection?tag=fav')).data.cards.length, 1);
  assert.equal((await c.get('/api/collection?locked=1')).data.cards[0].id, second.id);

  const json = await c.get('/api/export');
  assert.equal(json.data.cards.length, album.total);
  assert.ok(json.data.cards.find((x) => x.pageid === second.id).locked);
  const csv = await c.get('/api/export?format=csv');
  assert.match(csv.headers.get('content-type'), /text\/csv/);
  assert.ok(String(csv.data).startsWith('pageid,title'));
  assert.ok(first);
});

test('recycling only touches unlocked duplicates and pays coins', async () => {
  const c = await srv.client().signup('recycler');
  srv.give('recycler', 1000, 3);
  srv.give('recycler', 1001, 3);
  assert.equal((await c.post('/api/recycle', { articleId: 1000, qty: 3 })).status, 400, 'keeps one copy');
  const r = await c.post('/api/recycle', { articleId: 1000, qty: 2 });
  assert.equal(r.status, 200);
  assert.ok(r.data.coins > 0);
  await c.post('/api/cards/1001/flags', { locked: true });
  assert.equal((await c.post('/api/recycle', { articleId: 1001, qty: 1 })).status, 409, 'locked');
  const all = await c.post('/api/recycle/duplicates', { maxRarity: 'L' });
  assert.equal(all.data.cards, 0, 'locked duplicates are skipped');
});

test('wishlist entries disappear when the card is obtained', async () => {
  const a = await srv.client().signup('wisher');
  const b = await srv.client().signup('giver');
  srv.give('giver', 1005, 2);
  assert.equal((await a.post('/api/cards/1005/wish', { wished: true })).status, 200);
  assert.equal((await a.get('/api/wishlist')).data.length, 1);
  const offer = await b.post('/api/trades', { to: 'wisher', give: [1005] });
  await a.post(`/api/trades/${offer.data.id}/accept`);
  assert.equal((await a.get('/api/wishlist')).data.length, 0);
  assert.equal((await a.post('/api/cards/1005/wish', { wished: true })).status, 400, 'already owned');
});

test('trades: offers, counter-offers, locks and ownership re-checks', async () => {
  const a = await srv.client().signup('trader_a');
  const b = await srv.client().signup('trader_b');
  srv.give('trader_a', 1010, 1);
  srv.give('trader_a', 1011, 1);
  srv.give('trader_b', 1012, 1);
  srv.give('trader_b', 1013, 1);

  assert.equal((await a.post('/api/trades', { to: 'trader_a', give: [1010] })).status, 400);
  assert.equal((await a.post('/api/trades', { to: 'trader_b', give: [1013] })).status, 409, 'not owned');
  await b.post('/api/cards/1013/flags', { locked: true });
  assert.equal((await a.post('/api/trades', { to: 'trader_b', want: [1013] })).status, 409, 'locked cards cannot be requested');

  const offer = await a.post('/api/trades', { to: 'trader_b', give: [1010], want: [1012], message: 'hi' });
  assert.equal(offer.status, 200, JSON.stringify(offer.data));
  assert.equal((await b.get('/api/me')).data.pending.trades, 1);
  assert.ok((await b.get('/api/notifications')).data.some((n) => n.type === 'trade_offer'));
  assert.equal((await a.post(`/api/trades/${offer.data.id}/accept`)).status, 403, 'sender cannot accept');

  // B counters: wants both of A's cards.
  const counter = await b.post(`/api/trades/${offer.data.id}/counter`, { give: [1012], want: [1010, 1011] });
  assert.equal(counter.status, 200, JSON.stringify(counter.data));
  assert.equal(counter.data.parentId, offer.data.id);
  assert.equal((await b.post(`/api/trades/${offer.data.id}/accept`)).status, 409, 'original is closed');
  assert.ok((await a.get('/api/notifications')).data.some((n) => n.type === 'trade_countered'));

  const ok = await a.post(`/api/trades/${counter.data.id}/accept`);
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await a.get('/api/cards/1012')).data.mine, 1);
  assert.equal((await b.get('/api/cards/1010')).data.mine, 1);
  assert.equal((await b.get('/api/cards/1011')).data.mine, 1);
  assert.equal((await a.get('/api/cards/1010')).data.mine, 0);

  // Offer becomes invalid when the card gets locked after the offer was made.
  srv.give('trader_a', 1014, 1);
  const stale = await a.post('/api/trades', { to: 'trader_b', give: [1014] });
  await a.post('/api/cards/1014/flags', { locked: true });
  assert.equal((await b.post(`/api/trades/${stale.data.id}/accept`)).status, 409);
});

test('quiz rewards correct answers once', async () => {
  const c = await srv.client().signup('quizzer');
  await c.post('/api/packs/open');
  const q = (await c.get('/api/quiz/next')).data;
  assert.equal(q.choices.length, 4);
  const answerId = srv.db.prepare('SELECT article_id FROM quiz_questions WHERE id = ?').get(q.id).article_id;
  const r = await c.post(`/api/quiz/${q.id}/answer`, { choice: answerId });
  assert.equal(r.data.correct, true);
  assert.equal(r.data.coins, config.quiz.rewardCoins);
  assert.equal((await c.post(`/api/quiz/${q.id}/answer`, { choice: answerId })).status, 409);
});

test('sets complete into bonus packs once', async () => {
  const c = await srv.client().signup('setter');
  const beatles = (await c.get('/api/sets')).data.find((s) => s.id === 'beatles');
  assert.equal(beatles.size, 4);
  assert.equal((await c.post('/api/sets/beatles/claim')).status, 400);
  for (const m of beatles.members) srv.give('setter', m.card.id);
  const r = await c.post('/api/sets/beatles/claim');
  assert.equal(r.status, 200);
  assert.equal(r.data.profile.packs, config.packs.starterPacks + config.setRewardPacks);
  assert.equal((await c.post('/api/sets/beatles/claim')).status, 400);
  assert.ok((await c.get('/api/achievements')).data.find((a) => a.id === 'set_1').unlockedAt);
});

test('leaderboards, public profiles and recent pulls', async () => {
  const lb = (await srv.client().get('/api/leaderboard')).data;
  assert.ok(lb.score.length > 0);
  assert.ok(lb.score[0].score >= lb.score.at(-1).score);
  assert.ok(Array.isArray(lb.week.rows) && Array.isArray(lb.guilds) && Array.isArray(lb.duels));
  const p = (await srv.client().get('/api/users/curator')).data;
  assert.equal(p.username, 'curator');
  assert.equal(p.showcase.length, 1, 'pinned cards form the showcase');
  assert.ok(Array.isArray((await srv.client().get('/api/pulls/recent?min=C')).data));
});

test('non-JSON bodies are rejected', async () => {
  const res = await fetch(`${srv.base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=a&password=b',
  });
  assert.equal(res.status, 415);
});
