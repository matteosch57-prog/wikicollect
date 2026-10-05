import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats, rarityForViews, wikitextMetrics, qualityScore } from '../server/rarity.js';
import { pageToArticle, createWikiClient } from '../server/wiki.js';
import { redact } from '../server/quiz.js';
import { rollRarity, weekStart } from '../server/game.js';
import { damage } from '../server/duels.js';
import { isOffensive } from '../server/moderation.js';

test('rarity follows readership; ATK follows length x rarity; DEF follows quality', () => {
  assert.equal(rarityForViews(0), 'C');
  assert.equal(rarityForViews(30), 'R');
  assert.equal(rarityForViews(30, 3), 'PC');
  assert.equal(rarityForViews(5000), 'L');
  const stub = computeStats({ views: 1, bytes: 2000, refs: 0, images: 0, sections: 0 });
  const famous = computeStats({ views: 9000, bytes: 250000, refs: 400, images: 40, sections: 50, badge: 'featured' });
  assert.equal(stub.rarity, 'C');
  assert.equal(famous.rarity, 'L');
  assert.ok(famous.atk > 9000 && famous.atk <= 10000, `atk ${famous.atk}`);
  assert.ok(stub.atk < 1000);
  assert.equal(famous.def, 10000);
  assert.ok(stub.def < 3000);
  assert.equal(famous.atk % 10, 0);
  // Same article length, higher rarity => more attack.
  const a = computeStats({ views: 1, bytes: 50000 });
  const b = computeStats({ views: 3000, bytes: 50000 });
  assert.ok(b.atk > a.atk * 3);
  assert.ok(qualityScore({ bytes: 50000, refs: 100, images: 10, sections: 20 }) > qualityScore({ bytes: 50000 }));
});

test('wikitext metrics count references, images, sections and badges', () => {
  const text = `{{Article de qualité|date=2020}}
{{Infobox|image = Earth.jpg}}
Intro<ref>a</ref> text<ref name="b">b</ref> again<ref name="b"/>.
== History ==
[[Fichier:Map.png|thumb]] [[File:Map.png]]
=== Early ===
<references />`;
  const m = wikitextMetrics(text);
  assert.equal(m.refs, 3);
  assert.equal(m.images, 2);
  assert.equal(m.sections, 2);
  assert.equal(m.badge, 'featured');
  assert.equal(wikitextMetrics(null), null);
});

test('pageToArticle counts days without views as zero', () => {
  const page = {
    pageid: 42, ns: 0, title: 'Axolotl', length: 46000, description: 'Salamander', extract: ' The axolotl… ',
    pageviews: { d1: 100, d2: 200, d3: null, d4: null },
  };
  const a = pageToArticle(page);
  assert.equal(a.views, 75);
  assert.equal(a.extract, 'The axolotl…');
  assert.equal(pageToArticle({ ...page, pageprops: { disambiguation: '' } }), null);
  assert.equal(pageToArticle({ ...page, ns: 4 }), null);
});

test('wiki client follows prop continuation until pageviews are complete', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const p = new URL(url).searchParams;
    calls.push(p.get('pvipcontinue'));
    const body = p.get('pvipcontinue')
      ? { query: { pages: [{ pageid: 1, ns: 0, title: 'A', length: 100 }, { pageid: 2, ns: 0, title: 'B', length: 100, pageviews: { d1: 40, d2: 60 } }] } }
      : {
        continue: { pvipcontinue: 'B', grncontinue: 'x', continue: 'grncontinue||' },
        query: { pages: [{ pageid: 1, ns: 0, title: 'A', length: 100, pageviews: { d1: 10, d2: 20 } }, { pageid: 2, ns: 0, title: 'B', length: 100 }] },
      };
    return new Response(JSON.stringify(body));
  };
  const wiki = createWikiClient({ lang: 'fr', userAgent: 'test', fetchImpl, spacingMs: 0 });
  const articles = await wiki.random(2);
  assert.deepEqual(calls, [null, 'B']);
  assert.deepEqual(articles.map((a) => a.views).sort(), [15, 50]);
});

test('wiki client retries a short rate limit once, and surfaces long ones', async () => {
  let calls = 0;
  const flaky = createWikiClient({
    lang: 'en', userAgent: 'test', spacingMs: 0, retryDelayMs: 1,
    fetchImpl: async () => (++calls === 1
      ? new Response('slow down', { status: 429 })
      : new Response(JSON.stringify({ query: { pages: [{ pageid: 1, ns: 0, title: 'A', length: 10 }] } }))),
  });
  assert.equal((await flaky.random(1)).length, 1);
  assert.equal(calls, 2);

  const wiki = createWikiClient({
    lang: 'en', userAgent: 'test', spacingMs: 0,
    fetchImpl: async () => new Response('slow down', { status: 429, headers: { 'retry-after': '30' } }),
  });
  await assert.rejects(wiki.random(5), (err) => err.status === 429 && err.retryAfterMs === 30000);
});

test('wiki client resolves redirects and normalized titles', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    query: {
      normalized: [{ from: 'mars', to: 'Mars' }],
      redirects: [{ from: 'Lennon', to: 'John Lennon' }],
      pages: [{ pageid: 1, ns: 0, title: 'Mars', length: 100000 }, { pageid: 2, ns: 0, title: 'John Lennon', length: 100000 }],
    },
  }));
  const wiki = createWikiClient({ lang: 'en', userAgent: 'test', fetchImpl, spacingMs: 0 });
  const found = await wiki.byTitles(['mars', 'Lennon']);
  assert.equal(found.get('mars').id, 1);
  assert.equal(found.get('Lennon').id, 2);
});

test('rollRarity respects the published odds', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const odds = { C: 0.6, PC: 0.25, R: 0.1, SR: 0.04, UR: 0.009, L: 0.001 };
  const counts = {};
  const n = 100000;
  for (let i = 0; i < n; i++) {
    const r = rollRarity(odds, rnd);
    counts[r] = (counts[r] || 0) + 1;
  }
  for (const [id, p] of Object.entries(odds)) {
    assert.ok(Math.abs(counts[id] / n - p) < Math.max(0.005, p * 0.25), `${id}: ${counts[id] / n} vs ${p}`);
  }
});

test('duel damage: attack scores, defence absorbs, a hit always counts', () => {
  assert.equal(damage(8000, 4000), 6000);
  assert.equal(damage(2000, 9000), 400);
});

test('weekStart is Monday 00:00 UTC', () => {
  assert.equal(new Date(weekStart(Date.UTC(2026, 0, 15, 12))).toISOString(), '2026-01-12T00:00:00.000Z');
});

test('redact hides the subject of a quiz clue', () => {
  const clue = redact('Albert Einstein was a physicist. Einstein developed relativity.', 'Albert Einstein');
  assert.ok(!/Einstein|Albert/.test(clue), clue);
  assert.ok(clue.includes('physicist'));
});

test('offensive text filter blocks slurs without hitting innocent words', () => {
  for (const bad of ['n1gg3r', 'xX_Nazi_Xx', 'Hitl3rFan', 'RapeKing']) assert.ok(isOffensive(bad), bad);
  for (const ok of ['grapefruit', 'violet', 'computer', 'Raton laveur', 'pedestrian', 'Scunthorpe']) assert.ok(!isOffensive(ok), ok);
});
