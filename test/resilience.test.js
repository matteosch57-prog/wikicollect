import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { fixtureFetch } from '../server/fixture.js';

test('pack opening reports 503 when Wikipedia is down and nothing is cached', async () => {
  const srv = await startServer({ fetchImpl: async () => { throw new Error('network down'); } });
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

test('pack opening falls back to the existing catalog when Wikipedia goes down', async () => {
  let online = true;
  const srv = await startServer({
    fetchImpl: (url) => (online ? fixtureFetch(url) : Promise.reject(new Error('network down'))),
  });
  try {
    const c = await srv.client().signup('flaky');
    assert.equal((await c.post('/api/packs/open')).status, 200);
    online = false;
    srv.db.exec('DELETE FROM pool');
    const r = await c.post('/api/packs/open');
    assert.equal(r.status, 200);
    assert.equal(r.data.cards.length, 5);
  } finally {
    await srv.close();
  }
});

test('rarity is frozen once an article is discovered', async () => {
  const srv = await startServer();
  try {
    const first = srv.catalog.save({
      id: 777, title: 'Frozen', description: '', extract: '', image: null, url: null,
      views: 5, bytes: 1000, score: 10, rarity: 'common',
    });
    const again = srv.catalog.save({ ...first, description: 'updated', views: 99999, score: 99, rarity: 'mythic' });
    assert.equal(again.rarity, 'common');
    assert.equal(again.description, 'updated');
  } finally {
    await srv.close();
  }
});
