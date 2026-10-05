# WikiCollect

**The encyclopedia, collected.** Every Wikipedia article is a collectible card.
Open packs, fill your album, finish themed sets, duel your friends on what you
know, trade and auction your duplicates.

An open-source take on the [WikiMasters](https://www.wiki-masters.com/) concept.
It is built to fix what that game's community reports most: lag, features
that are shown but don't work, missing security headers, inflation,
resale flipping, offensive usernames and no way to export your collection.

## The cards

Card stats follow the WikiMasters rules, computed from public data when an
article is first discovered and then frozen:

| | Comes from | |
| --- | --- | --- |
| **Rarity** | readership: average daily page views over 60 days | C · PC · R · SR · UR · L |
| **ATK** | article length × rarity multiplier (0.25 → 1) | 0–10 000 |
| **DEF** | article quality: references, images, sections, featured/good labels | 0–10 000 |

## Features

- **Packs**: a free 5-card pack every 10 min, 10 in reserve. Rarity is
  **rolled first with published odds**, then an article of that rarity is
  drawn, so the odds shown in the shop are the real ones.
- **Shop**: Classic and Premium ("Rare or better") packs, two **theme packs
  rotating every 2 hours**, and a jackpot where half of every ticket is destroyed.
- **Album**: rarity filters, search and sorting; **tags**; a **pinned showcase**
  on your profile; **locked cards** that can't be recycled, auctioned, offered or
  requested; **JSON/CSV export**.
- **Sets**: themed albums that can actually be completed, worth 3 bonus packs each.
- **Duels**: an asynchronous quiz built from your own deck of 5. Name your card from its
  blanked-out intro in 30 s; your **ATK scores, their DEF absorbs**. Decoys
  come from your own deck and the answer is never sent to the client.
- **Exchange**: offers of up to 5⇄5 cards with **counter-offers**, a finder for
  other players' spare copies of cards you lack (wishlist matches first).
- **Market**: escrowed auctions (bids are held and refunded at once, so
  nothing "jumps"), anti-sniping, a listing fee and a 5% **sales tax that is
  burned**, a **48h relist cooldown** against flipping, and wishlist alerts. A
  wishlist entry clears itself when you obtain the card.
- **Accounts**: email + password, or **Sign in with Google** (OpenID Connect
  with PKCE, state and nonce). A Google login is never silently attached to an
  existing password account with the same email; players link Google from
  their account menu instead. New Google players still choose a username and
  accept the rules.
- **Social**: friends, direct messages, guilds with chat and a guild ranking,
  notifications, achievements, global, weekly, duel and quiz leaderboards.
- **Moderation**: username/text filter (EN/FR, leetspeak-aware, no
  "Scunthorpe" false positives), player reports, bans, forced renames, and a
  coin ledger that shows admins who gained suspiciously much in 24h.
- **Installable PWA**, light and dark ("reading room") themes, mobile tab bar.

## Engineering notes

- One Node process, Express + built-in `node:sqlite` (WAL, indexed queries),
  no native dependencies, no external services.
- Wikipedia ingestion is serialised and polite: a proper User-Agent,
  `maxlag`, prop continuation for complete page views, and one retry on 429.
  A **circuit breaker** serves packs from the local catalog when Wikipedia is
  slow or down.
- All state changes run in transactions. Every coin movement is written to a
  ledger.
- Security headers on every response (strict CSP for scripts, HSTS,
  frame-ancestors none, nosniff, referrer and permissions policies),
  per-user rate limiting, JSON-only mutations, HttpOnly SameSite cookies,
  scrypt password hashes.
- Self-hosted fonts (Instrument Serif, Geist, Geist Mono — SIL OFL). The only
  third-party requests are Wikimedia thumbnails.

## Run it

```bash
npm install
npm run demo       # offline demo catalogue on http://localhost:3000
npm start          # live Wikipedia (set WIKI_LANG=fr in .env for French)
npm run dev        # demo catalogue + auto-reload
npm test           # API, economy, social, Google sign-in, resilience, units
```

Settings can go in a `.env` file (copy `.env.example`); works the same on Windows, macOS and Linux.

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DB_PATH` | `./data/wikicollect.db` | SQLite file — keep it on a persistent volume |
| `WIKI_LANG` | `en` | e.g. `fr` for fr.wikipedia.org (themed sets exist for `en` and `fr`) |
| `RARITY_VIEW_SCALE` | `3` for en, else `1` | multiplies the views needed per tier on big wikis |
| `WIKI_SOURCE` | `live` | `fixture` = bundled offline catalogue |
| `WIKI_USER_AGENT` | WikiCollect/0.2 (repo URL) | Wikimedia asks clients to identify themselves |
| `ADMIN_USERNAMES` | — | comma-separated usernames with moderation rights |
| `PUBLIC_URL` | — | public base URL, e.g. `https://wikicollect.example` (needed for Google sign-in) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | enables "Sign in with Google" (see below) |
| `COOKIE_SECURE` | — | `1` behind HTTPS |
| `PACK_REGEN_MS` | `600000` | free pack interval |

Game balance (odds, prices, taxes, rewards) lives in `server/config.js` and
`server/rarity.js`. If your host needs an outbound proxy, Node ≥ 22.21 honours
`HTTPS_PROXY` when `NODE_USE_ENV_PROXY=1` is set.

### Sign in with Google

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   configure the OAuth consent screen (scopes: `openid`, `email`, `profile`).
2. Create credentials → **OAuth client ID** → *Web application*.
3. Add the authorised redirect URI `<PUBLIC_URL>/auth/google/callback`,
   e.g. `https://wikicollect.example/auth/google/callback` (and
   `http://localhost:3000/auth/google/callback` for local testing).
4. Start the server with `PUBLIC_URL`, `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`. The Google button appears automatically; without
   them, it stays hidden.

### Docker

```bash
docker build -t wikicollect .
docker run -p 3000:3000 -v wikicollect-data:/data -e WIKI_LANG=fr wikicollect
```

## Layout

```
server/
  app.js          routes, security headers, rate limits, background jobs
  catalog.js      rarity-first dealing, pool, top-viewed enrichment, sets, circuit breaker
  wiki.js         Wikipedia/Wikimedia client (continuation, retries, wikitext metrics)
  rarity.js       tiers, ATK/DEF/quality formulas
  game.js         packs, shop, jackpot, album, wishlist, sets, leaderboards, profiles
  trades.js       offers & counter-offers        market.js   auctions
  duels.js        async quiz duels               quiz.js     solo quiz + question builder
  social.js       friends, DMs, guilds           notify.js   notifications & achievements
  moderation.js   filters, reports, bans         db.js       schema, transactions, ledger
public/           no-build SPA (ES modules), styles, self-hosted fonts, PWA
test/             node:test suites
```

Card text and images come from Wikipedia (CC BY-SA 4.0). WikiCollect is not
affiliated with the Wikimedia Foundation or with WikiMasters.
