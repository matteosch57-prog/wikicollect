import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { createWikiClient } from './wiki.js';
import { fixtureFetch } from './fixture.js';
import { createCatalog } from './catalog.js';
import { createGame } from './game.js';
import { createQuiz } from './quiz.js';
import { createTrades } from './trades.js';
import { createMarket } from './market.js';
import { createDuels } from './duels.js';
import { createSocial } from './social.js';
import { createModeration } from './moderation.js';
import { createAuth, readCookie, COOKIE } from './auth.js';
import { GameError } from './errors.js';
import { RARITIES } from './rarity.js';
import { listNotifications, markRead, achievementsFor } from './notify.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

// Content Security Policy: everything self-hosted except Wikimedia images.
// No inline scripts.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // inline style attributes only; scripts stay strict
  "font-src 'self'",
  "img-src 'self' data: https://upload.wikimedia.org",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

function securityHeaders(req, res, next) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  if (req.secure || config.cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// Fixed-window rate limiter keyed by user (or IP when logged out).
function rateLimiter({ windowMs, max, now }) {
  const hits = new Map();
  setInterval(() => hits.clear(), windowMs * 10).unref();
  return (req, _res, next) => {
    const key = req.userId ? `u${req.userId}` : `ip${req.ip}`;
    const t = now();
    const e = hits.get(key);
    if (!e || t > e.reset) hits.set(key, { n: 1, reset: t + windowMs });
    else if (++e.n > max) return next(new GameError('Too many requests — slow down a little', 429));
    next();
  };
}

export function createApp({
  dbPath = config.dbPath,
  wikiSource = config.wikiSource,
  fetchImpl,
  now = Date.now,
  random = Math.random,
  warm = true,
  log = console,
} = {}) {
  const db = openDb(dbPath);
  const wiki = createWikiClient({
    lang: config.lang,
    userAgent: config.userAgent,
    viewScale: config.viewScale,
    fetchImpl: fetchImpl || (wikiSource === 'fixture' ? fixtureFetch : fetch),
    // No throttling against the in-process fixture.
    ...(wikiSource === 'fixture' || fetchImpl ? { spacingMs: 0, retryDelayMs: 0 } : {}),
  });
  const catalog = createCatalog({ db, wiki, lang: config.lang, now, random, log });
  const game = createGame({ db, catalog, now, random });
  const quiz = createQuiz({ db, game, now, random });
  const trades = createTrades({ db, now });
  const market = createMarket({ db, game, now });
  const duels = createDuels({ db, game, now, random });
  const social = createSocial({ db, game, now });
  const mod = createModeration({ db, config, now });
  const auth = createAuth({ db, now });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.json({ limit: '32kb' }));

  // Request bodies must be JSON (blocks cross-site form posts; cookies are SameSite=Lax too).
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.is('application/json') === false) return next(new GameError('Expected JSON', 415));
    req.userId = auth.userIdFor(readCookie(req, COOKIE));
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', rateLimiter({ windowMs: 10_000, max: 60, now }));
  const authLimit = rateLimiter({ windowMs: 15 * 60_000, max: 20, now });

  const requireUser = (req, _res, next) => (req.userId ? next() : next(new GameError('Please log in', 401)));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => r !== undefined && res.json(r), next);
  const id = (req, key = 'id') => {
    const n = Number(req.params[key]);
    if (!Number.isInteger(n) || n <= 0) throw new GameError('Invalid id');
    return n;
  };

  // --- public ---------------------------------------------------------------

  app.get('/api/config', wrap(() => ({
    lang: config.lang,
    offline: wikiSource === 'fixture' && !fetchImpl,
    rarities: RARITIES.map(({ id: rid, name, minViews, multiplier, recycle, points }) => ({
      id: rid, name, minViews: minViews * config.viewScale, multiplier, recycle, points,
    })),
    packs: config.packs,
    quiz: config.quiz,
    duel: config.duel,
    market: config.market,
    guild: config.guild,
    setRewardPacks: config.setRewardPacks,
    trade: config.trade,
  })));
  app.get('/api/leaderboard', wrap(() => game.leaderboard()));
  app.get('/api/pulls/recent', wrap((req) => game.recentPulls(req.query.min || 'SR', Number(req.query.limit) || 24)));
  app.get('/api/cards/:id', wrap((req) => game.card(id(req), req.userId)));
  app.get('/api/users/:name', wrap((req) => game.publicProfile(req.params.name, req.userId)));

  // --- account --------------------------------------------------------------

  app.post('/api/register', authLimit, wrap(async (req, res) => {
    const token = await auth.register(req.body);
    res.setHeader('Set-Cookie', auth.cookieHeader(token, req));
    return { ok: true };
  }));
  app.post('/api/login', authLimit, wrap(async (req, res) => {
    const token = await auth.login(req.body.username, req.body.password);
    res.setHeader('Set-Cookie', auth.cookieHeader(token, req));
    return { ok: true };
  }));
  app.post('/api/logout', wrap((req, res) => {
    auth.logout(readCookie(req, COOKIE));
    res.setHeader('Set-Cookie', auth.cookieHeader(null, req));
    return { ok: true };
  }));
  app.get('/api/me', wrap((req) => (req.userId ? game.profile(req.userId) : null)));
  app.get('/api/achievements', requireUser, wrap((req) => achievementsFor(db, req.userId)));
  app.get('/api/notifications', requireUser, wrap((req) => listNotifications(db, req.userId)));
  app.post('/api/notifications/read', requireUser, wrap((req) => {
    markRead(db, req.userId, req.body.ids === 'all' ? 'all' : [].concat(req.body.ids || []), now());
    return { ok: true };
  }));

  // --- packs & shop ---------------------------------------------------------

  app.get('/api/shop', requireUser, wrap(() => game.shop()));
  app.post('/api/packs/open', requireUser, wrap((req) => game.openPack(req.userId, { type: req.body.type || 'free', theme: req.body.theme })));
  app.post('/api/jackpot/spin', requireUser, wrap((req) => game.spinJackpot(req.userId)));

  // --- album ----------------------------------------------------------------

  app.get('/api/collection', requireUser, wrap((req) => game.collection(req.userId, {
    ...req.query, dupes: req.query.dupes === '1', locked: req.query.locked === '1',
  })));
  app.get('/api/export', requireUser, wrap((req, res) => {
    const rows = game.exportCollection(req.userId);
    if (req.query.format === 'csv') {
      const cols = ['pageid', 'title', 'url', 'rarity', 'atk', 'def', 'count', 'pinned', 'locked', 'tags', 'obtainedAt'];
      const cell = (v) => `"${String(Array.isArray(v) ? v.join('|') : v ?? '').replaceAll('"', '""')}"`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="wikicollect-collection.csv"');
      res.send([cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n'));
      return undefined;
    }
    res.setHeader('Content-Disposition', 'attachment; filename="wikicollect-collection.json"');
    return { exportedAt: new Date(now()).toISOString(), lang: config.lang, cards: rows };
  }));
  app.post('/api/cards/:id/flags', requireUser, wrap((req) => game.setCardFlags(req.userId, id(req), req.body)));
  app.post('/api/cards/:id/wish', requireUser, wrap((req) => game.setWish(req.userId, id(req), !!req.body.wished)));
  app.get('/api/wishlist', requireUser, wrap((req) => game.wishlist(req.userId)));
  app.post('/api/recycle', requireUser, wrap((req) => game.recycle(req.userId, Number(req.body.articleId), req.body.qty ?? 1)));
  app.post('/api/recycle/duplicates', requireUser, wrap((req) => game.recycleAllDuplicates(req.userId, req.body.maxRarity)));

  app.get('/api/sets', requireUser, wrap(async (req) => {
    await catalog.resolveAllSets().catch(() => {});
    return game.setsProgress(req.userId);
  }));
  app.post('/api/sets/:id/claim', requireUser, wrap((req) => game.claimSet(req.userId, req.params.id)));

  // --- quiz & duels ---------------------------------------------------------

  app.get('/api/quiz/next', requireUser, wrap((req) => quiz.next(req.userId)));
  app.post('/api/quiz/:id/answer', requireUser, wrap((req) => quiz.answer(req.userId, id(req), req.body.choice)));

  app.get('/api/duels', requireUser, wrap((req) => duels.list(req.userId)));
  app.post('/api/duels', requireUser, wrap((req) => duels.challenge(req.userId, req.body)));
  app.get('/api/duels/:id', requireUser, wrap((req) => duels.get(req.userId, id(req))));
  app.post('/api/duels/:id/accept', requireUser, wrap((req) => duels.accept(req.userId, id(req), req.body)));
  app.post('/api/duels/:id/decline', requireUser, wrap((req) => duels.decline(req.userId, id(req))));
  app.get('/api/duels/:id/question', requireUser, wrap((req) => duels.question(req.userId, id(req))));
  app.post('/api/duels/:id/answer', requireUser, wrap((req) => duels.answer(req.userId, id(req), req.body.choice)));

  // --- trading & market -----------------------------------------------------

  app.get('/api/trade-finder', requireUser, wrap((req) => game.tradeFinder(req.userId, { q: req.query.q })));
  app.get('/api/users/:name/cards', requireUser, wrap((req) =>
    game.userCards(req.params.name, req.userId, { dupesOnly: req.query.dupes === '1' })));
  app.get('/api/trades', requireUser, wrap((req) => trades.list(req.userId)));
  app.post('/api/trades', requireUser, wrap((req) => trades.create(req.userId, req.body)));
  app.post('/api/trades/:id/counter', requireUser, wrap((req) => trades.counter(req.userId, id(req), req.body)));
  app.post('/api/trades/:id/:action', requireUser, wrap((req) => trades.resolve(req.userId, id(req), req.params.action)));

  app.get('/api/auctions', requireUser, wrap((req) => market.list(req.userId, req.query)));
  app.post('/api/auctions', requireUser, wrap((req) => market.create(req.userId, req.body)));
  app.get('/api/auctions/:id', requireUser, wrap((req) => market.get(id(req), req.userId)));
  app.post('/api/auctions/:id/bid', requireUser, wrap((req) => market.bid(req.userId, id(req), req.body.amount)));
  app.post('/api/auctions/:id/cancel', requireUser, wrap((req) => market.cancel(req.userId, id(req))));

  // --- social ---------------------------------------------------------------

  app.get('/api/friends', requireUser, wrap((req) => social.friends(req.userId)));
  app.post('/api/friends', requireUser, wrap((req) => social.requestFriend(req.userId, req.body.username)));
  app.post('/api/friends/:name/accept', requireUser, wrap((req) => social.answerFriend(req.userId, req.params.name, true)));
  app.post('/api/friends/:name/decline', requireUser, wrap((req) => social.answerFriend(req.userId, req.params.name, false)));
  app.post('/api/friends/:name/remove', requireUser, wrap((req) => social.removeFriend(req.userId, req.params.name)));
  app.get('/api/dms/:name', requireUser, wrap((req) => social.conversation(req.userId, req.params.name, req.query)));
  app.post('/api/dms/:name', requireUser, wrap((req) => social.sendMessage(req.userId, req.params.name, req.body.body)));

  app.get('/api/guilds', requireUser, wrap((req) => social.guilds(req.query)));
  app.get('/api/guild', requireUser, wrap((req) => social.myGuild(req.userId)));
  app.post('/api/guilds', requireUser, wrap((req) => social.createGuild(req.userId, req.body)));
  app.get('/api/guilds/:id', requireUser, wrap((req) => social.guildView(id(req), req.userId)));
  app.post('/api/guilds/:id/join', requireUser, wrap((req) => social.joinGuild(req.userId, id(req))));
  app.post('/api/guild/leave', requireUser, wrap((req) => social.leaveGuild(req.userId)));
  app.post('/api/guild/kick', requireUser, wrap((req) => social.kick(req.userId, req.body.username)));
  app.post('/api/guild/invite', requireUser, wrap((req) => social.inviteToGuild(req.userId, req.body.username)));
  app.get('/api/guild/chat', requireUser, wrap((req) => social.guildChat(req.userId, req.query)));
  app.post('/api/guild/chat', requireUser, wrap((req) => social.postGuildChat(req.userId, req.body.body)));

  // --- moderation -----------------------------------------------------------

  app.post('/api/reports', requireUser, wrap((req) => mod.report(req.userId, req.body)));
  app.get('/api/admin', requireUser, wrap((req) => mod.overview(req.userId)));
  app.post('/api/admin/reports/:id', requireUser, wrap((req) => mod.resolveReport(req.userId, id(req), req.body.status)));
  app.post('/api/admin/ban', requireUser, wrap((req) => mod.ban(req.userId, req.body.username, req.body.reason)));
  app.post('/api/admin/unban', requireUser, wrap((req) => mod.unban(req.userId, req.body.username)));
  app.post('/api/admin/rename', requireUser, wrap((req) => mod.rename(req.userId, req.body.username, req.body.newName)));

  app.use('/api', (_req, _res, next) => next(new GameError('Not found', 404)));

  app.use(express.static(PUBLIC_DIR, {
    extensions: ['html'],
    setHeaders(res, path) {
      if (/\.woff2$/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      else if (/\.(css|js|svg)$/.test(path)) res.setHeader('Cache-Control', 'public, max-age=300');
    },
  }));
  app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: PUBLIC_DIR }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    const known = err instanceof GameError || (status < 500 && err.expose);
    if (!known) log.error?.(err);
    res.status(status).json({ error: known ? err.message : 'Something went wrong' });
  });

  // Background jobs: settle auctions, keep the card pool warm.
  const timers = [];
  if (warm) {
    catalog.warmUp().catch((err) => log.warn?.('[catalog] warm-up failed:', err.message));
    timers.push(setInterval(() => {
      try {
        market.settleDue();
      } catch (err) {
        log.error?.(err);
      }
    }, 15_000));
    timers.forEach((t) => t.unref());
  }

  return { app, db, catalog, game, market, duels, social, close: () => timers.forEach(clearInterval) };
}
