// Rarity is derived from two public, objective signals of an article:
//   - popularity: average daily page views over the last 60 days
//   - depth: article size in bytes
// The score is computed once, when an article first enters the catalog, and is
// then frozen so a card never changes rarity inside someone's album.

export const RARITIES = [
  { id: 'common', name: 'Common', min: 0, recycle: 5, points: 1 },
  { id: 'uncommon', name: 'Uncommon', min: 25, recycle: 10, points: 3 },
  { id: 'rare', name: 'Rare', min: 40, recycle: 25, points: 10 },
  { id: 'epic', name: 'Epic', min: 55, recycle: 60, points: 30 },
  { id: 'legendary', name: 'Legendary', min: 70, recycle: 150, points: 100 },
  { id: 'mythic', name: 'Mythic', min: 85, recycle: 400, points: 400 },
];

export const RARITY_BY_ID = Object.fromEntries(RARITIES.map((r) => [r.id, r]));
export const RARITY_RANK = Object.fromEntries(RARITIES.map((r, i) => [r.id, i]));

export function computeScore({ views, bytes }) {
  const v = Math.log10(1 + Math.max(0, views || 0)); // 10/day -> 1, 10k/day -> 4
  const l = Math.log10(1 + Math.max(0, bytes || 0)); // 2 kB -> 3.3, 100 kB -> 5
  const score = v * 16 + Math.max(0, l - 3) * 10;
  return Math.round(Math.min(100, score) * 10) / 10;
}

export function rarityForScore(score) {
  let result = RARITIES[0];
  for (const r of RARITIES) if (score >= r.min) result = r;
  return result.id;
}
