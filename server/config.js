// Central game configuration. Everything tunable lives here.

const env = process.env;
const lang = env.WIKI_LANG || 'en';

export const config = {
  port: Number(env.PORT || 3000),
  dbPath: env.DB_PATH || './data/wikicollect.db',
  // "live" talks to Wikipedia, "fixture" uses the bundled offline catalog (dev/tests).
  wikiSource: env.WIKI_SOURCE || 'live',
  lang,
  // Big wikis need more daily views for the same rarity tier.
  viewScale: Number(env.RARITY_VIEW_SCALE || (lang === 'en' ? 3 : 1)),
  // Wikimedia asks API clients to identify themselves with a contact.
  userAgent: env.WIKI_USER_AGENT || 'WikiCollect/0.2 (https://github.com/matteosch57-prog/wikicollect)',
  cookieSecure: env.COOKIE_SECURE === '1',
  // Usernames (comma separated) that get moderator powers.
  admins: (env.ADMIN_USERNAMES || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  packs: {
    cardsPerPack: 5,
    regenMs: Number(env.PACK_REGEN_MS || 10 * 60 * 1000), // one free pack every 10 minutes
    maxStock: 10, // regeneration stops at 10 (bought / reward packs can go above)
    starterPacks: 10,
  },

  // Published, exact per-card odds. Rarity is rolled first, then an article of
  // that rarity is picked, so these numbers are the real drop rates.
  packTypes: {
    free: {
      name: 'Wiki Pack',
      price: 0,
      slots: [
        ...Array(4).fill({ C: 0.6, PC: 0.25, R: 0.1, SR: 0.04, UR: 0.009, L: 0.001 }),
        { R: 0.6, SR: 0.28, UR: 0.1, L: 0.02 }, // hit slot
      ],
    },
    classic: {
      name: 'Classic Pack',
      price: 150,
      slots: [
        ...Array(4).fill({ C: 0.6, PC: 0.25, R: 0.1, SR: 0.04, UR: 0.009, L: 0.001 }),
        { R: 0.6, SR: 0.28, UR: 0.1, L: 0.02 },
      ],
    },
    premium: {
      name: 'Premium Pack',
      price: 600,
      slots: [
        ...Array(4).fill({ R: 0.7, SR: 0.22, UR: 0.07, L: 0.01 }),
        { SR: 0.6, UR: 0.33, L: 0.07 },
      ],
    },
  },
  // Theme packs draw only from one set; two themes rotate every 2 hours.
  themePack: { price: 250, rotationMs: 2 * 60 * 60 * 1000, active: 2 },

  quiz: {
    rewardCoins: 15,
    rewardedPerDay: 20,
    streakForPack: 5,
  },

  setRewardPacks: 3,

  trade: { maxItemsPerSide: 5, maxPendingPerUser: 20 },

  market: {
    listingFeeRate: 0.02, // of the starting price, min 5 coins, destroyed
    minListingFee: 5,
    salesTaxRate: 0.05, // taken from the final price, destroyed
    durationsH: [1, 6, 24, 72],
    antiSnipeMs: 2 * 60 * 1000,
    relistCooldownMs: 48 * 60 * 60 * 1000, // anti-flipping: bought cards can't be relisted for 48h
    maxActivePerUser: 10,
  },

  // Bouftou-style jackpot: half of every ticket is destroyed, half feeds the pot.
  jackpot: { ticket: 500, burnRate: 0.5, seed: 1000, winChance: 0.02 },

  duel: {
    deckSize: 5,
    answerWindowMs: 30 * 1000,
    winCoins: 60,
    loseCoins: 15,
    expiryMs: 3 * 24 * 60 * 60 * 1000,
  },

  guild: { maxMembers: 30, createCost: 300 },

  pool: {
    target: 60, // pre-fetched random articles kept ready
    lowWater: 20,
    batch: 20,
  },
};
