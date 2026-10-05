import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { config } from '../server/config.js';
import { damage } from '../server/duels.js';

let srv;
before(async () => {
  srv = await startServer();
});
after(() => srv.close());

test('friends and direct messages', async () => {
  const a = await srv.client().signup('alice');
  const b = await srv.client().signup('bob');
  assert.equal((await a.post('/api/dms/bob', { body: 'hi' })).status, 403, 'friends only');
  assert.equal((await a.post('/api/friends', { username: 'bob' })).data.status, 'requested');
  assert.equal((await b.get('/api/me')).data.pending.friends, 1);
  assert.equal((await b.post('/api/friends/alice/accept')).status, 200);
  assert.equal((await a.get('/api/friends')).data.friends[0].username, 'bob');

  assert.equal((await a.post('/api/dms/bob', { body: 'Tu as Cléopâtre VII en double ?' })).status, 200);
  assert.equal((await a.post('/api/dms/bob', { body: 'n1gg3r' })).status, 400, 'filtered');
  assert.equal((await b.get('/api/me')).data.pending.messages, 1);
  const convo = (await b.get('/api/dms/alice')).data;
  assert.equal(convo.messages.length, 1);
  assert.equal(convo.messages[0].mine, false);
  assert.equal((await b.get('/api/me')).data.pending.messages, 0, 'read on open');
  assert.ok((await a.get('/api/achievements')).data.find((x) => x.id === 'friend_1').unlockedAt);
});

test('guilds: create costs coins, join, chat, ranking, ownership hand-over', async () => {
  const owner = await srv.client().signup('founder');
  const m = await srv.client().signup('member');
  assert.equal((await owner.post('/api/guilds', { name: 'Les Encyclopédistes', tag: 'ENC' })).status, 400, 'needs coins');
  srv.setCoins('founder', 1000);
  const g = await owner.post('/api/guilds', { name: 'Les Encyclopédistes', tag: 'ENC', description: 'Savoir' });
  assert.equal(g.status, 200, JSON.stringify(g.data));
  assert.equal((await owner.get('/api/me')).data.coins, 1000 - config.guild.createCost + 30, 'Fellowship achievement pays 30');
  assert.equal((await m.post(`/api/guilds/${g.data.id}/join`)).data.members.length, 2);
  assert.equal((await m.post('/api/guilds', { name: 'Other', tag: 'OTH' })).status, 400, 'one guild at a time');
  await m.post('/api/guild/chat', { body: 'Salut !' });
  assert.equal((await owner.get('/api/guild/chat')).data[0].body, 'Salut !');
  assert.equal((await srv.client().get('/api/leaderboard')).data.guilds[0].tag, 'ENC');
  assert.equal((await m.post('/api/guild/kick', { username: 'founder' })).status, 403);
  await owner.post('/api/guild/leave');
  assert.equal((await m.get('/api/guild')).data.owner, 'member', 'ownership passes on');
});

test('reports, bans and admin tools', async () => {
  const mod = await srv.client().signup('moderator');
  srv.db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'moderator'").run();
  const troll = await srv.client().signup('troll');
  const victim = await srv.client().signup('victim');
  assert.equal((await victim.post('/api/reports', { username: 'troll', reason: 'insults in chat' })).status, 200);
  assert.equal((await victim.get('/api/admin')).status, 403);
  const overview = (await mod.get('/api/admin')).data;
  assert.equal(overview.reports[0].target, 'troll');
  assert.equal((await mod.post('/api/admin/rename', { username: 'troll', newName: 'renamed_1' })).status, 200);
  assert.equal((await mod.post('/api/admin/ban', { username: 'renamed_1', reason: 'abuse' })).status, 200);
  assert.equal((await troll.get('/api/me')).data, null, 'sessions revoked');
  const relog = await srv.client().post('/api/login', { username: 'renamed_1', password: 'secret123' });
  assert.equal(relog.status, 403);
  assert.match(relog.data.error, /banned/);
});

test('duels: decks, timed questions, ATK vs DEF scoring, rewards', async () => {
  const a = await srv.client().signup('duelist_a');
  const b = await srv.client().signup('duelist_b');
  const deckA = [1030, 1031, 1032, 1033, 1034];
  const deckB = [1035, 1036, 1037, 1038, 1039];
  for (const id of deckA) srv.give('duelist_a', id);
  for (const id of deckB) srv.give('duelist_b', id);

  assert.equal((await a.post('/api/duels', { opponent: 'duelist_b', deck: deckA.slice(0, 3) })).status, 400);
  assert.equal((await a.post('/api/duels', { opponent: 'duelist_b', deck: deckB })).status, 409, 'must own deck');
  const duel = await a.post('/api/duels', { opponent: 'duelist_b', deck: deckA });
  assert.equal(duel.status, 200, JSON.stringify(duel.data));
  const id = duel.data.id;
  assert.ok((await b.get('/api/notifications')).data.some((n) => n.type === 'battle_invite'));
  assert.equal((await a.get(`/api/duels/${id}/question`)).status, 409, 'not started yet');
  assert.equal((await b.post(`/api/duels/${id}/accept`, { deck: deckB })).status, 200);

  const article = (aid) => srv.db.prepare('SELECT atk, def FROM articles WHERE id = ?').get(aid);
  // A answers everything right except round 2, which times out.
  let expectedA = 0;
  for (let slot = 0; slot < 5; slot++) {
    const q = (await a.get(`/api/duels/${id}/question`)).data;
    assert.equal(q.slot, slot);
    assert.equal(q.choices.length, 4);
    assert.ok(q.choices.every((c) => deckA.includes(c.id)), 'choices come from your own deck');
    assert.equal(q.myCard.id, undefined, 'the answer is never leaked');
    assert.equal(q.myCard.title, undefined);
    if (slot === 2) {
      srv.clock.t += config.duel.answerWindowMs + 1;
      const late = await a.post(`/api/duels/${id}/answer`, { choice: deckA[slot] });
      assert.equal(late.data.late, true);
      assert.equal(late.data.points, 0);
    } else {
      const r = await a.post(`/api/duels/${id}/answer`, { choice: deckA[slot] });
      assert.equal(r.data.correct, true);
      const expected = damage(article(deckA[slot]).atk, article(deckB[slot]).def);
      assert.equal(r.data.points, expected);
      expectedA += expected;
    }
  }
  const mid = (await a.get(`/api/duels/${id}`)).data;
  assert.equal(mid.status, 'active');
  assert.equal(mid.theirScore, null, 'opponent score hidden until the end');

  // B answers everything wrong.
  for (let slot = 0; slot < 5; slot++) {
    const q = (await b.get(`/api/duels/${id}/question`)).data;
    const wrong = q.choices.find((c) => c.id !== deckB[slot]).id;
    await b.post(`/api/duels/${id}/answer`, { choice: wrong });
  }
  const end = (await a.get(`/api/duels/${id}`)).data;
  assert.equal(end.status, 'finished');
  assert.equal(end.result, 'won');
  assert.equal(end.myScore, expectedA);
  assert.equal(end.theirScore, 0);
  assert.equal((await a.get('/api/me')).data.duels.wins, 1);
  assert.equal((await b.get('/api/me')).data.duels.losses, 1);
  const reward = (name) => srv.db.prepare('SELECT delta FROM coin_ledger WHERE user_id = ? AND reason = ?').get(srv.userId(name), `duel:${id}`).delta;
  assert.equal(reward('duelist_a'), config.duel.winCoins);
  assert.equal(reward('duelist_b'), config.duel.loseCoins);
  assert.ok((await a.get('/api/achievements')).data.find((x) => x.id === 'duel_1').unlockedAt);
});
