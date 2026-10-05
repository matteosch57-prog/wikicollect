import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScore, rarityForScore } from '../server/rarity.js';
import { pageToArticle, createWikiClient } from '../server/wiki.js';
import { redact } from '../server/quiz.js';

test('rarity grows with views and article depth', () => {
  const stub = computeScore({ views: 3, bytes: 2000 });
  const famous = computeScore({ views: 20000, bytes: 220000 });
  assert.equal(rarityForScore(stub), 'common');
  assert.equal(rarityForScore(famous), 'mythic');
  assert.ok(computeScore({ views: 500, bytes: 40000 }) > computeScore({ views: 50, bytes: 40000 }));
  assert.ok(computeScore({ views: 500, bytes: 90000 }) > computeScore({ views: 500, bytes: 9000 }));
  assert.ok(famous <= 100);
});

test('pageToArticle averages page views and skips non-articles', () => {
  const page = {
    pageid: 42, ns: 0, title: 'Axolotl', length: 46000, description: 'Salamander',
    extract: ' The axolotl… ', fullurl: 'https://en.wikipedia.org/wiki/Axolotl',
    thumbnail: { source: 'https://upload.wikimedia.org/a.jpg' },
    pageviews: { '2026-01-01': 100, '2026-01-02': 300, '2026-01-03': null },
  };
  const a = pageToArticle(page);
  assert.equal(a.id, 42);
  assert.equal(a.views, 200);
  assert.equal(a.extract, 'The axolotl…');
  assert.equal(a.image, 'https://upload.wikimedia.org/a.jpg');
  assert.equal(pageToArticle({ ...page, pageprops: { disambiguation: '' } }), null);
  assert.equal(pageToArticle({ ...page, ns: 4 }), null);
  assert.equal(pageToArticle({ title: 'Nope', missing: true, ns: 0 }), null);
});

test('wiki client resolves redirects and normalized titles', async () => {
  const fetchImpl = async (url) => {
    const u = new URL(url);
    assert.equal(u.searchParams.get('titles'), 'mars|Lennon');
    return new Response(JSON.stringify({
      query: {
        normalized: [{ from: 'mars', to: 'Mars' }],
        redirects: [{ from: 'Lennon', to: 'John Lennon' }],
        pages: [
          { pageid: 1, ns: 0, title: 'Mars', length: 100000 },
          { pageid: 2, ns: 0, title: 'John Lennon', length: 100000 },
        ],
      },
    }));
  };
  const wiki = createWikiClient({ lang: 'en', userAgent: 'test', fetchImpl });
  const found = await wiki.byTitles(['mars', 'Lennon']);
  assert.equal(found.get('mars').id, 1);
  assert.equal(found.get('Lennon').id, 2);
});

test('top-of-month list drops special pages', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    items: [{ articles: [{ article: 'Main_Page' }, { article: 'Special:Search' }, { article: 'Star_Wars:_Episode_IV' }] }],
  }));
  const wiki = createWikiClient({ lang: 'en', userAgent: 'test', fetchImpl });
  assert.deepEqual(await wiki.topOfMonth(2025, 3), ['Star Wars: Episode IV']);
});

test('redact hides the subject of a quiz clue', () => {
  const clue = redact('Albert Einstein was a physicist. Einstein developed relativity.', 'Albert Einstein');
  assert.ok(!/Einstein|Albert/.test(clue), clue);
  assert.ok(clue.includes('physicist'));
  assert.ok(!redact('Mercury is the first planet.', 'Mercury (planet)').includes('Mercury'));
});
