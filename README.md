# WikiCollect

Every Wikipedia article is a collectible card. Open free packs, fill your album,
finish themed sets, trade duplicates with other players and earn rewards in quizzes.
It's a working take on the [WikiMasters](https://www.wiki-masters.com/) concept.

## How it plays

| Feature | How it works |
| --- | --- |
| **Pulls** | One free 5-card pack every 10 minutes, stocking up to 10. New players start with 10. The 5th card is a "hit slot" with better odds of a famous article or a set card. |
| **Rarity** | Common → Uncommon → Rare → Epic → Legendary → Mythic. It's computed from the article's average daily page views (last 60 days) and its size in bytes. It's fixed once a card is first discovered, so it never changes in your album. |
| **Album** | Filter by rarity, search, sort, see duplicates. Each card links to its Wikipedia article. |
| **Sets** | Themed albums with a fixed list of articles (Solar System, Twelve Olympians, Seven Wonders…). You can actually finish one, and finishing it pays 3 bonus packs. |
| **Exchange** | "Find cards" lists cards other players have spare copies of that you're missing. Offers can be up to 5 cards ⇄ 5 cards. Ownership is checked again, atomically, when an offer is accepted. |
| **Recycle & shop** | Turn duplicates into coins (5–400 by rarity). Buy extra packs for 100 coins. |
| **Quiz** | Read an article intro with its subject blanked out and pick the right title out of 4. +15 coins per correct answer (20 rewarded answers a day), plus a bonus pack for every 5 in a row. |
| **Ranking** | Collection score (points per unique card by rarity) and quiz leaderboard. A global feed shows recent big pulls. |

## Where cards come from

The server talks to Wikipedia. The browser never decides what you pull.

- **random** – MediaWiki `generator=random` with `pageviews`, `info`, `pageimages`, `extracts` and `description`. Results are pre-fetched into a pool, so packs open instantly and each random article is dealt only once.
- **popular** – a top-viewed article from a random month of the past 5 years, from the Wikimedia pageviews API.
- **set** – titles from `server/sets.js`. Redirects are followed.

If Wikipedia is slow or down, a circuit breaker switches to cards already in the
catalog, so pack opening keeps working.

## Run it

Requires Node ≥ 22.13 (uses the built-in `node:sqlite`, so there are no native deps).

```bash
npm install
npm start                 # live Wikipedia, http://localhost:3000
npm run dev               # offline demo catalog, auto-reload
npm test
```

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `DB_PATH` | `./data/wikicollect.db` | SQLite file; keep it on a persistent volume |
| `WIKI_LANG` | `en` | e.g. `fr` for fr.wikipedia.org (sets exist for `en` and `fr`) |
| `WIKI_SOURCE` | `live` | `fixture` = bundled offline catalog |
| `WIKI_USER_AGENT` | WikiCollect/0.1 (repo URL) | Wikimedia asks API clients to identify themselves with a contact |
| `COOKIE_SECURE` | unset | set to `1` behind HTTPS |
| `PACK_REGEN_MS` | `600000` | pack regeneration interval |

Game balance (odds, rewards, prices) lives in `server/config.js` and `server/rarity.js`.

### Docker

```bash
docker build -t wikicollect .
docker run -p 3000:3000 -v wikicollect-data:/data wikicollect
```

The container is a single process with a SQLite file, so it fits any host with a
persistent disk (Fly.io volume, Railway, Render disk, a VPS…).

## Layout

```
server/
  app.js        Express routes
  catalog.js    card sourcing: random pool, popular, sets, fallbacks
  game.js       packs, album, recycle, shop, sets, leaderboard, market
  quiz.js       quiz generation and rewards
  trades.js     player-to-player offers
  wiki.js       Wikipedia / Wikimedia API client
  rarity.js     score + rarity tiers
  fixture.js    offline catalog for dev/tests
public/         no-build SPA (index.html, app.js, styles.css)
test/           node:test suites (API, unit, resilience)
```
