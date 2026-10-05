// Card stats, following the WikiMasters rules:
//   readership (avg daily page views)  -> rarity
//   length (bytes) x rarity multiplier  -> attack (ATK, 0-10 000)
//   quality (refs, images, sections...) -> defence (DEF, 0-10 000)
// Stats are computed once, when an article first enters the catalog, and are
// then frozen so a card never changes inside someone's album.

export const RARITIES = [
  { id: 'C', name: 'Common', minViews: 0, multiplier: 0.25, recycle: 5, points: 1 },
  { id: 'PC', name: 'Uncommon', minViews: 5, multiplier: 0.4, recycle: 10, points: 3 },
  { id: 'R', name: 'Rare', minViews: 20, multiplier: 0.6, recycle: 25, points: 10 },
  { id: 'SR', name: 'Super Rare', minViews: 100, multiplier: 0.75, recycle: 60, points: 30 },
  { id: 'UR', name: 'Ultra Rare', minViews: 500, multiplier: 0.9, recycle: 150, points: 100 },
  { id: 'L', name: 'Legendary', minViews: 2500, multiplier: 1, recycle: 400, points: 400 },
];

export const RARITY_BY_ID = Object.fromEntries(RARITIES.map((r) => [r.id, r]));
export const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const logScore = (n, full) => clamp(Math.log10(1 + Math.max(0, n)) / Math.log10(1 + full), 0, 1);
const round10 = (x) => Math.round(x / 10) * 10;

// viewScale lets big wikis (English) need more views for the same tier.
export function rarityForViews(views, viewScale = 1) {
  let result = RARITIES[0];
  for (const r of RARITIES) if (views >= r.minViews * viewScale) result = r;
  return result.id;
}

// 300 bytes -> 0, ~20 kB -> 0.6, 300 kB+ -> 1
export function lengthScore(bytes) {
  return clamp((Math.log10(Math.max(1, bytes)) - 2.5) / 3, 0.05, 1);
}

// WikiRank-style quality from wikitext metrics, 0..1.
export function qualityScore({ bytes = 0, refs = 0, images = 0, sections = 0, badge = null }) {
  let q =
    0.3 * logScore(refs, 150) +
    0.2 * logScore(images, 30) +
    0.2 * logScore(sections, 40) +
    0.3 * lengthScore(bytes);
  if (badge === 'featured') q += 0.15;
  else if (badge === 'good') q += 0.08;
  return clamp(q, 0.05, 1);
}

export function computeStats({ views, bytes, refs, images, sections, badge }, viewScale = 1) {
  const rarity = rarityForViews(views, viewScale);
  const quality = qualityScore({ bytes, refs, images, sections, badge });
  return {
    rarity,
    atk: round10(RARITY_BY_ID[rarity].multiplier * lengthScore(bytes) * 10000),
    def: round10(quality * 10000),
    // Fine-grained popularity used for sorting inside a tier.
    score: Math.round(Math.log10(1 + Math.max(0, views)) * 200) / 10,
  };
}

const FEATURED = /\{\{\s*(Featured article|Article de qualité|Exzellent|Vetrina|Artículo destacado|Artigo destacado)\s*(?=[|}])/i;
const GOOD = /\{\{\s*(Good article|Bon article|Lesenswert|Voce di qualità|Artículo bueno|Artigo bom)\s*(?=[|}])/i;

// Extract quality metrics from raw wikitext (language-agnostic enough).
export function wikitextMetrics(text) {
  if (!text) return null;
  const refs = (text.match(/<ref[\s>]/gi) || []).length;
  const files = new Set(
    (text.match(/[^\s|=[\]{}:]+\.(?:jpe?g|png|svg|gif|tiff?|webp)\b/gi) || []).map((f) => f.toLowerCase()),
  );
  const sections = (text.match(/^==+[^=\n].*?==+\s*$/gm) || []).length;
  const badge = FEATURED.test(text) ? 'featured' : GOOD.test(text) ? 'good' : null;
  return { refs, images: files.size, sections, badge };
}

// Rough metrics when no wikitext is available (e.g. offline fixture).
export function estimateMetrics(bytes) {
  const kb = bytes / 1024;
  return { refs: Math.round(kb * 0.9), images: Math.round(kb / 9), sections: Math.round(kb / 4), badge: null };
}
