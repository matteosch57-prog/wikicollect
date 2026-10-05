// Wikipedia client. Fetches article metadata in batches and turns it into
// catalog entries. All network access goes through `fetchImpl` so tests and
// the offline fixture mode can replace it.

import { computeStats, wikitextMetrics, estimateMetrics } from './rarity.js';

const EXCLUDED_TITLES = new Set(['Main Page', 'Wikipédia:Accueil principal', '-']);
const NAMESPACE_PREFIX =
  /^(Special|Spécial|Wikipedia|Wikipédia|File|Fichier|Portal|Portail|Help|Aide|Category|Catégorie|Template|Modèle|User|Utilisateur|Discussion|Talk|Projet|Draft|Module):/;

export class WikiError extends Error {
  constructor(message, { status, retryAfterMs } = {}) {
    super(message);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function createWikiClient({ lang, userAgent, viewScale = 1, fetchImpl = fetch }) {
  const api = `https://${lang}.wikipedia.org/w/api.php`;

  async function getJson(url) {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': userAgent, 'Api-User-Agent': userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      const retry = Number(res.headers?.get?.('retry-after'));
      throw new WikiError(`Wikipedia request failed (${res.status})`, {
        status: res.status,
        retryAfterMs: Number.isFinite(retry) && retry > 0 ? retry * 1000 : undefined,
      });
    }
    const data = await res.json();
    if (data?.error) {
      // maxlag and ratelimited come back as HTTP 200 with an error object.
      throw new WikiError(`Wikipedia API error: ${data.error.code}`, {
        status: data.error.code === 'maxlag' || data.error.code === 'ratelimited' ? 429 : 502,
        retryAfterMs: data.error.code === 'maxlag' ? 5000 : undefined,
      });
    }
    return data;
  }

  const BASE = {
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    maxlag: '5',
    prop: 'info|pageimages|extracts|description|pageviews|pageprops|revisions',
    inprop: 'url',
    piprop: 'thumbnail',
    pithumbsize: '480',
    exintro: '1',
    explaintext: '1',
    exsentences: '4',
    exlimit: '20',
    pvipdays: '60',
    ppprop: 'disambiguation',
    rvprop: 'content',
    rvslots: 'main',
  };

  // Runs a query and follows prop continuations (pageviews, extracts and
  // revisions are paged separately) until every page in the batch is complete.
  async function query(extra) {
    const pages = new Map();
    const aliases = new Map();
    let cont = {};
    for (let round = 0; round < 8; round++) {
      const data = await getJson(`${api}?${new URLSearchParams({ ...BASE, ...extra, ...cont })}`);
      for (const n of data?.query?.normalized || []) aliases.set(n.from, n.to);
      for (const r of data?.query?.redirects || []) aliases.set(r.from, r.to);
      for (const p of data?.query?.pages || []) {
        const key = p.pageid ?? `missing:${p.title}`;
        const prev = pages.get(key);
        if (!prev) {
          pages.set(key, p);
          continue;
        }
        if (p.pageviews) prev.pageviews = { ...(prev.pageviews || {}), ...p.pageviews };
        if (p.extract && !prev.extract) prev.extract = p.extract;
        if (p.revisions && !prev.revisions) prev.revisions = p.revisions;
        if (p.thumbnail && !prev.thumbnail) prev.thumbnail = p.thumbnail;
        if (p.description && !prev.description) prev.description = p.description;
      }
      const next = data?.continue;
      // Only a generator continuation left means this batch is complete.
      const propKeys = next ? Object.keys(next).filter((k) => k !== 'continue' && k !== 'grncontinue') : [];
      if (!propKeys.length) break;
      cont = next;
    }
    const articles = [...pages.values()].map((p) => pageToArticle(p, viewScale)).filter(Boolean);
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
      for (let i = 0; i < titles.length; i += 10) {
        const chunk = titles.slice(i, i + 10);
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
      return cleanTitles(items.map((a) => a.article.replaceAll('_', ' ')));
    },

    // Most viewed articles of the last day, from the action API (fallback for topOfMonth).
    async mostViewed() {
      const data = await getJson(`${api}?${new URLSearchParams({
        action: 'query', format: 'json', formatversion: '2', list: 'mostviewed', pvimlimit: '500',
      })}`);
      return cleanTitles((data?.query?.mostviewed || []).filter((p) => p.ns === 0).map((p) => p.title));
    },
  };
}

function cleanTitles(titles) {
  return titles.filter((t) => !EXCLUDED_TITLES.has(t) && !NAMESPACE_PREFIX.test(t));
}

export function pageToArticle(page, viewScale = 1) {
  if (!page || page.missing || page.invalid || page.ns !== 0) return null;
  if (page.pageprops && 'disambiguation' in page.pageprops) return null;
  if (EXCLUDED_TITLES.has(page.title)) return null;

  // Days without traffic come back as null: they count as zero views.
  const days = page.pageviews ? Object.values(page.pageviews) : [];
  const views = days.length ? Math.round(days.reduce((s, v) => s + (v || 0), 0) / days.length) : 0;
  const bytes = page.length || 0;
  const wikitext = page.revisions?.[0]?.slots?.main?.content ?? page.revisions?.[0]?.content;
  const metrics = wikitextMetrics(wikitext) || estimateMetrics(bytes);
  const stats = computeStats({ views, bytes, ...metrics }, viewScale);

  return {
    id: page.pageid,
    title: page.title,
    description: page.description || '',
    extract: (page.extract || '').trim(),
    image: page.thumbnail?.source || null,
    url: page.fullurl || null,
    views,
    bytes,
    refs: metrics.refs,
    images: metrics.images,
    sections: metrics.sections,
    badge: metrics.badge,
    ...stats,
  };
}
