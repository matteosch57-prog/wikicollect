// Wikipedia client. Fetches article metadata in batches and turns it into
// catalog entries. All network access goes through `fetchImpl` so tests and
// the offline fixture mode can replace it.

import { computeScore, rarityForScore } from './rarity.js';

const EXCLUDED_TITLES = new Set(['Main Page', 'Wikipédia:Accueil principal', '-']);

export function createWikiClient({ lang, userAgent, fetchImpl = fetch }) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;

  async function getJson(url) {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, 'Api-User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Wikipedia request failed (${res.status}) for ${url}`);
    return res.json();
  }

  function queryUrl(extra) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      origin: '*',
      redirects: '1',
      prop: 'info|pageimages|extracts|description|pageviews|pageprops',
      inprop: 'url',
      piprop: 'thumbnail',
      pithumbsize: '480',
      exintro: '1',
      explaintext: '1',
      exsentences: '4',
      exlimit: '20',
      pvipdays: '60',
      ppprop: 'disambiguation',
      ...extra,
    });
    return `${api}?${params}`;
  }

  // Returns { articles, redirects } where redirects maps requested title -> final title.
  async function query(extra) {
    const data = await getJson(queryUrl(extra));
    const pages = data?.query?.pages || [];
    const aliases = new Map();
    for (const n of data?.query?.normalized || []) aliases.set(n.from, n.to);
    for (const r of data?.query?.redirects || []) aliases.set(r.from, r.to);
    const articles = pages.map(pageToArticle).filter(Boolean);
    return { articles, aliases };
  }

  return {
    async random(count) {
      const { articles } = await query({ generator: 'random', grnnamespace: '0', grnlimit: String(count) });
      return articles;
    },

    // Fetch specific titles. Returns a Map(requestedTitle -> article).
    async byTitles(titles) {
      const result = new Map();
      for (let i = 0; i < titles.length; i += 20) {
        const chunk = titles.slice(i, i + 20);
        const { articles, aliases } = await query({ titles: chunk.join('|') });
        const byTitle = new Map(articles.map((a) => [a.title, a]));
        for (const t of chunk) {
          let final = t;
          for (let hops = 0; aliases.has(final) && hops < 3; hops++) final = aliases.get(final);
          if (byTitle.has(final)) result.set(t, byTitle.get(final));
        }
      }
      return result;
    },

    // Top viewed articles for a given month (YYYY, MM) from the Wikimedia metrics API.
    async topOfMonth(year, month) {
      const mm = String(month).padStart(2, '0');
      const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/top/${lang}.wikipedia.org/all-access/${year}/${mm}/all-days`;
      const data = await getJson(url);
      const items = data?.items?.[0]?.articles || [];
      return items
        .map((a) => a.article.replaceAll('_', ' '))
        .filter((t) => !EXCLUDED_TITLES.has(t) && !/^(Special|Spécial|Wikipedia|Wikipédia|File|Fichier|Portal|Portail|Help|Aide|Category|Catégorie|Template|Modèle|User|Utilisateur):/.test(t));
    },
  };
}

export function pageToArticle(page) {
  if (!page || page.missing || page.invalid || page.ns !== 0) return null;
  if (page.pageprops && 'disambiguation' in page.pageprops) return null;
  if (EXCLUDED_TITLES.has(page.title)) return null;

  const pv = page.pageviews ? Object.values(page.pageviews).filter((v) => v !== null) : [];
  const views = pv.length ? Math.round(pv.reduce((s, v) => s + v, 0) / pv.length) : 0;
  const bytes = page.length || 0;
  const score = computeScore({ views, bytes });

  return {
    id: page.pageid,
    title: page.title,
    description: page.description || '',
    extract: (page.extract || '').trim(),
    image: page.thumbnail?.source || null,
    url: page.fullurl || null,
    views,
    bytes,
    score,
    rarity: rarityForScore(score),
  };
}
