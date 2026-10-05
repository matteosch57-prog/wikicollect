import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { config } from '../server/config.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(() => srv.close());

test('register, login, profile', async () => {
  const c = srv.client();
  assert.equal((await c.get('/api/me')).data, null);
  await c.signup('ada');
  const me = (await c.get('/api/me')).data;
  assert.equal(me.username, 'ada');
  assert.equal(me.packs, config.packs.starterPacks);

  assert.equal((await srv.client().post('/api/register', { username: 'ADA', password: 'secret123' })).status, 409);
  assert.equal((await srv.client().post('/api/login', { username: 'ada', password: 'wrong-pass' })).status, 401);
  const again = srv.client();
  assert.equal((await again.post('/api/login', { username: 'ada', password: 'secret123' })).status, 200);
  assert.equal((await again.get('/api/me')).data.username, 'ada');
  assert.equal((await srv.client().post('/api/packs/open')).status, 401);
});

test('opening packs consumes stock, fills the album and regenerates over time', async () => {
  const c = await srv.client().signup('opener');
  const r = await c.post('/api/packs/open');
  assert.equal(r.status, 200);
  assert.equal(r.data.cards.length, config.packs.cardsPerPack);
  assert.equal(new Set(r.data.cards.map((x) => x.id)).size, r.data.cards.length, 'no duplicates within a pack');
  assert.ok(r.data.cards.every((x) => x.isNew));
  assert.equal(r.data.profile.packs, config.packs.starterPacks - 1);
  assert.equal(r.data.profile.nextPackAt, srv.clock.t + config.packs.regenMs);

  for (let i = 1; i < config.packs.starterPacks; i++) assert.equal((await c.post('/api/packs/open')).status, 200);
  const empty = await c.post('/api/packs/open');
  assert.equal(empty.status, 409);

  srv.clock.t += config.packs.regenMs * 2 + 1000;
  assert.equal((await c.get('/api/me')).data.packs, 2);
  srv.clock.t += config.packs.regenMs * 100;
  assert.equal((await c.get('/api/me')).data.packs, config.packs.maxStock, 'regen caps at max stock');

  const album = (await c.get('/api/collection?limit=200')).data;
  const total = album.cards.reduce((s, x) => s + x.count, 0);
  assert.equal(total, config.packs.cardsPerPack * config.packs.starterPacks);
});

test('recycling only touches duplicates and pays coins', async () => {
  const c = await srv.client().signup('recycler');
  for (let i = 0; i < 10; i++) await c.post('/api/packs/open');
  const album = (await c.get('/api/collection?limit=200&dupes=1')).data;
  assert.ok(album.cards.length > 0, 'fixture catalog is small, duplicates expected');
  const single = (await c.get('/api/collection?limit=200')).data.cards.find((x) => x.count === 1);
  if (single) assert.equal((await c.post('/api/recycle', { articleId: single.id })).status, 400);

  const dupe = album.cards[0];
  const r = await c.post('/api/recycle', { articleId: dupe.id, qty: dupe.count - 1 });
  assert.equal(r.status, 200);
  assert.ok(r.data.coins > 0);
  assert.equal((await c.get(`/api/cards/${dupe.id}`)).data.mine, 1);

  const all = await c.post('/api/recycle/duplicates', { maxRarity: 'mythic' });
  assert.equal(all.status, 200);
  assert.equal((await c.get('/api/collection?dupes=1')).data.cards.length, 0);
});

test('shop sells packs for coins', async () => {
  const c = await srv.client().signup('shopper');
  assert.equal((await c.post('/api/shop/pack')).status, 400);
  srv.db.prepare("UPDATE users SET coins = 250 WHERE username = 'shopper'").run();
  const r = await c.post('/api/shop/pack');
  assert.equal(r.status, 200);
  assert.equal(r.data.profile.coins, 250 - config.packs.shopPrice);
  assert.equal(r.data.profile.packs, config.packs.starterPacks + 1);
});

test('trades swap cards atomically and re-check ownership', async () => {
  const a = await srv.client().signup('trader_a');
  const b = await srv.client().signup('trader_b');
  await a.post('/api/packs/open');
  await b.post('/api/packs/open');
  const aCard = (await a.get('/api/collection')).data.cards[0];
  const bCards = (await b.get('/api/collection')).data.cards;
  const bCard = bCards.find((x) => x.id !== aCard.id);

  assert.equal((await a.post('/api/trades', { to: 'trader_a', give: [aCard.id] })).status, 400);
  assert.equal((await a.post('/api/trades', { to: 'trader_b', give: [999999] })).status, 409);

  const offer = await a.post('/api/trades', { to: 'trader_b', give: [aCard.id], want: [bCard.id], message: 'hi' });
  assert.equal(offer.status, 200, JSON.stringify(offer.data));
  const id = offer.data.id;
  assert.equal((await b.get('/api/me')).data.incomingTrades, 1);
  assert.equal((await a.post(`/api/trades/${id}/accept`)).status, 403, 'sender cannot accept');

  const before = (await a.get(`/api/cards/${bCard.id}`)).data.mine;
  const ok = await b.post(`/api/trades/${id}/accept`);
  assert.equal(ok.status, 200);
  assert.equal(ok.data.status, 'accepted');
  assert.equal((await a.get(`/api/cards/${bCard.id}`)).data.mine, before + 1);
  assert.equal((await b.get(`/api/cards/${aCard.id}`)).data.mine >= 1, true);
  assert.equal((await b.post(`/api/trades/${id}/accept`)).status, 409, 'cannot accept twice');

  // Offer becomes invalid if the sender no longer owns the card.
  const give = (await a.get('/api/collection')).data.cards.find((x) => x.count === 1);
  const stale = await a.post('/api/trades', { to: 'trader_b', give: [give.id] });
  srv.db.prepare('DELETE FROM user_cards WHERE article_id = ? AND user_id = (SELECT id FROM users WHERE username = ?)').run(give.id, 'trader_a');
  assert.equal((await b.post(`/api/trades/${stale.data.id}/accept`)).status, 409);
  assert.equal((await b.post(`/api/trades/${stale.data.id}/decline`)).status, 200);
});

test('quiz rewards correct answers once', async () => {
  const c = await srv.client().signup('quizzer');
  await c.post('/api/packs/open');
  const q = (await c.get('/api/quiz/next')).data;
  assert.equal(q.choices.length, 4);
  const answerId = srv.db.prepare('SELECT article_id FROM quiz_questions WHERE id = ?').get(q.id).article_id;
  const title = q.choices.find((x) => x.id === answerId).title.replace(/\s*\(.*\)$/, '');
  assert.ok(!q.clue.includes(title), 'clue must not reveal the answer');

  const r = await c.post(`/api/quiz/${q.id}/answer`, { choice: answerId });
  assert.equal(r.data.correct, true);
  assert.equal(r.data.coins, config.quiz.rewardCoins);
  assert.equal((await c.post(`/api/quiz/${q.id}/answer`, { choice: answerId })).status, 409);

  const q2 = (await c.get('/api/quiz/next')).data;
  const wrong = q2.choices.find((x) => x.id !== srv.db.prepare('SELECT article_id FROM quiz_questions WHERE id = ?').get(q2.id).article_id);
  const r2 = await c.post(`/api/quiz/${q2.id}/answer`, { choice: wrong.id });
  assert.equal(r2.data.correct, false);
  assert.equal(r2.data.streak, 0);
});

test('completing a set grants bonus packs once', async () => {
  const c = await srv.client().signup('setter');
  const sets = (await c.get('/api/sets')).data;
  const beatles = sets.find((s) => s.id === 'beatles');
  assert.equal(beatles.size, 4);
  assert.equal((await c.post('/api/sets/beatles/claim')).status, 400);

  const uid = srv.db.prepare("SELECT id FROM users WHERE username = 'setter'").get().id;
  for (const m of beatles.members) {
    srv.db.prepare('INSERT INTO user_cards (user_id, article_id, count, first_at) VALUES (?, ?, 1, 0)').run(uid, m.card.id);
  }
  const done = (await c.get('/api/sets')).data.find((s) => s.id === 'beatles');
  assert.equal(done.complete, true);
  const r = await c.post('/api/sets/beatles/claim');
  assert.equal(r.status, 200);
  assert.equal(r.data.profile.packs, config.packs.starterPacks + config.setRewardPacks);
  assert.equal((await c.post('/api/sets/beatles/claim')).status, 400);
});

test('leaderboard and recent pulls are public', async () => {
  const lb = await srv.client().get('/api/leaderboard');
  assert.equal(lb.status, 200);
  assert.ok(lb.data.score.length > 0);
  assert.ok(lb.data.score[0].score >= lb.data.score.at(-1).score);
  const feed = await srv.client().get('/api/pulls/recent?min=common');
  assert.ok(feed.data.length > 0);
  assert.ok(feed.data[0].username);
});

test('non-JSON bodies are rejected', async () => {
  const res = await fetch(`${srv.base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'username=a&password=b',
  });
  assert.equal(res.status, 415);
});
