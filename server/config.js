// Central game configuration. Everything tunable lives here.

const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  dbPath: env.DB_PATH || './data/wikicollect.db',
  // "live" talks to Wikipedia, "fixture" uses the bundled offline catalog (dev/tests).
  wikiSource: env.WIKI_SOURCE || 'live',
  lang: env.WIKI_LANG || 'en',
  // Wikimedia asks API clients to identify themselves with a contact.
  userAgent: env.WIKI_USER_AGENT || 'WikiCollect/0.1 (https://github.com/matteosch57-prog/wikicollect)',
  cookieSecure: env.COOKIE_SECURE === '1',

  packs: {
    cardsPerPack: 5,
    regenMs: Number(env.PACK_REGEN_MS || 10 * 60 * 1000), // one pack every 10 minutes
    maxStock: 10, // regeneration stops at 10 (bonus packs can go above)
    starterPacks: 10,
    shopPrice: 100,
  },

  // Where each card in a pack comes from. The last slot is the "hit" slot.
  slotOdds: {
    normal: { random: 0.93, popular: 0.03, set: 0.04 },
    hit: { random: 0.6, popular: 0.25, set: 0.15 },
  },

  quiz: {
    rewardCoins: 15,
    rewardedPerDay: 20,
    streakForPack: 5,
  },

  setRewardPacks: 3,

  trade: {
    maxItemsPerSide: 5,
    maxPendingPerUser: 20,
  },

  pool: {
    target: 60, // pre-fetched random articles kept ready
    lowWater: 20,
    batch: 20,
  },
};
