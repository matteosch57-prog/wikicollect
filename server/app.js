import express from 'express';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { openDb } from './db.js';
import { createWikiClient } from './wiki.js';
import { fixtureFetch } from './fixture.js';
import { createCatalog } from './catalog.js';
import { createGame } from './game.js';
import { GameError } from './errors.js';
import { createQuiz } from './quiz.js';
import { createTrades } from './trades.js';
import { createAuth, readCookie, COOKIE } from './auth.js';
import { RARITIES } from './rarity.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public', import.meta.url));

export function createApp({
  dbPath = config.dbPath,
  wikiSource = config.wikiSource,
  fetchImpl,
  now = Date.now,
  random = Math.random,
} = {}) {
  const db = openDb(dbPath);
  const wiki = createWikiClient({
    lang: config.lang,
    userAgent: config.userAgent,
    fetchImpl: fetchImpl || (wikiSource === 'fixture' ? fixtureFetch : fetch),
  });
  const catalog = createCatalog({ db, wiki, lang: config.lang, now, random });
  const game = createGame({ db, catalog, now, random });
  const quiz = createQuiz({ db, game, now, random });
  const trades = createTrades({ db, now });
  const auth = createAuth({ db, now });

  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  // Tiny in-memory limiter for auth endpoints.
  const attempts = new Map();
  function limitAuth(req, _res, next) {
    const key = req.ip;
    const t = now();
    const entry = attempts.get(key) || { n: 0, reset: t + 15 * 60 * 1000 };
    if (t > entry.reset) Object.assign(entry, { n: 0, reset: t + 15 * 60 * 1000 });
    entry.n++;
    attempts.set(key, entry);
    if (entry.n > 30) return next(new GameError('Too many attempts, try again later', 429));
    next();
  }

  // Request bodies must be JSON (blocks cross-site form posts; cookies are SameSite=Lax too).
  app.use('/api', (req, _res, next) => {
    if (req.method !== 'GET' && req.is('application/json') === false) return next(new GameError('Expected JSON', 415));
    req.userId = auth.userIdFor(readCookie(req, COOKIE));
    next();
  });

  const requireUser = (req, _res, next) => (req.userId ? next() : next(new GameError('Please log in', 401)));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).then((r) => r !== undefined && res.json(r), next);

  app.get('/api/config', wrap(() => ({
    lang: config.lang,
    offline: wikiSource === 'fixture' && !fetchImpl,
    rarities: RARITIES.map(({ id, name, min, recycle, points }) => ({ id, name, min, recycle, points })),
    packs: config.packs,
    quiz: config.quiz,
    setRewardPacks: config.setRewardPacks,
    slotOdds: config.slotOdds,
    trade: config.trade,
  })));

  app.post('/api/register', limitAuth, wrap(async (req, res) => {
    const token = await auth.register(req.body.username, req.body.password);
    res.setHeader('Set-Cookie', auth.cookieHeader(token, req));
    return { ok: true };
  }));
  app.post('/api/login', limitAuth, wrap(async (req, res) => {
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

  app.post('/api/packs/open', requireUser, wrap((req) => game.openPack(req.userId)));
  app.post('/api/shop/pack', requireUser, wrap((req) => game.buyPack(req.userId)));

  app.get('/api/collection', requireUser, wrap((req) =>
    game.collection(req.userId, { ...req.query, dupesOnly: req.query.dupes === '1' })));
  app.get('/api/cards/:id', wrap((req) => game.card(Number(req.params.id), req.userId)));
  app.post('/api/recycle', requireUser, wrap((req) => game.recycle(req.userId, Number(req.body.articleId), req.body.qty ?? 1)));
  app.post('/api/recycle/duplicates', requireUser, wrap((req) => game.recycleAllDuplicates(req.userId, req.body.maxRarity)));

  app.get('/api/sets', requireUser, wrap(async (req) => {
    await catalog.resolveAllSets().catch((err) => console.warn('[sets] resolve failed:', err.message));
    return game.setsProgress(req.userId);
  }));
  app.post('/api/sets/:id/claim', requireUser, wrap((req) => game.claimSet(req.userId, req.params.id)));

  app.get('/api/quiz/next', requireUser, wrap((req) => quiz.next(req.userId)));
  app.post('/api/quiz/:id/answer', requireUser, wrap((req) => quiz.answer(req.userId, Number(req.params.id), req.body.choice)));

  app.get('/api/market', requireUser, wrap((req) => game.market(req.userId, { q: req.query.q })));
  app.get('/api/users/:name/cards', requireUser, wrap((req) =>
    game.userCards(req.params.name, { dupesOnly: req.query.dupes === '1' })));
  app.get('/api/trades', requireUser, wrap((req) => trades.list(req.userId)));
  app.post('/api/trades', requireUser, wrap((req) => trades.create(req.userId, req.body)));
  app.post('/api/trades/:id/:action', requireUser, wrap((req) =>
    trades.resolve(req.userId, Number(req.params.id), req.params.action)));

  app.get('/api/leaderboard', wrap(() => game.leaderboard()));
  app.get('/api/pulls/recent', wrap((req) => game.recentPulls(req.query.min || 'rare', Number(req.query.limit) || 24)));

  app.use('/api', (_req, _res, next) => next(new GameError('Not found', 404)));

  app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
  app.get('/{*splat}', (_req, res) => res.sendFile('index.html', { root: PUBLIC_DIR }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 && !(err instanceof GameError) ? 'Something went wrong' : err.message });
  });

  // Warm the card pool in the background so the first pack opens instantly.
  catalog.refillPool().catch((err) => console.warn('[catalog] initial pool fill failed:', err.message));

  return { app, db, catalog, game };
}
