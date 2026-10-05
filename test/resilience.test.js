import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { fixtureFetch } from '../server/fixture.js';

test('pack opening reports 503 when Wikipedia is down and nothing is cached', async () => {
  const srv = await startServer({ seed: false, fetchImpl: async () => { throw new Error('network down'); } });
  try {
    const c = await srv.client().signup('offline');
    const r = await c.post('/api/packs/open');
    assert.equal(r.status, 503);
    assert.match(r.data.error, /unreachable/);
    assert.equal((await c.get('/api/me')).data.packs, 10, 'a failed open must not consume a pack');
  } finally {
    await srv.close();
  }
});

test('pack opening keeps working from the catalog when Wikipedia goes down', async () => {
  let online = true;
  let calls = 0;
  const srv = await startServer({
    seed: false,
    fetchImpl: (url) => {
      calls++;
      return online ? fixtureFetch(url) : Promise.reject(new Error('network down'));
    },
  });
  try {
    const c = await srv.client().signup('flaky');
    assert.equal((await c.post('/api/packs/open')).status, 200);
    online = false;
    srv.db.exec('DELETE FROM pool');
    const r = await c.post('/api/packs/open');
    assert.equal(r.status, 200);
    assert.equal(r.data.cards.length, 5);
    // The circuit breaker stops hammering Wikipedia after the first failure.
    const before = calls;
    await c.post('/api/packs/open');
    await c.post('/api/packs/open');
    assert.ok(calls - before <= 1, `made ${calls - before} calls while down`);
  } finally {
    await srv.close();
  }
});

test('stats are frozen once an article is discovered', async () => {
  const srv = await startServer();
  try {
    const base = { id: 777, title: 'Frozen', description: '', extract: '', image: null, url: null, views: 5, bytes: 1000, score: 10 };
    srv.catalog.save({ ...base, rarity: 'C', atk: 100, def: 200 });
    const again = srv.catalog.save({ ...base, description: 'updated', rarity: 'L', atk: 9000, def: 9000 });
    assert.equal(again.rarity, 'C');
    assert.equal(again.atk, 100);
    assert.equal(again.description, 'updated');
  } finally {
    await srv.close();
  }
});
