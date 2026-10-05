import { createApp } from '../server/app.js';
import { config } from '../server/config.js';
import { FIXTURE_PAGES } from '../server/fixture.js';
import { pageToArticle } from '../server/wiki.js';

const quiet = { warn() {}, error() {} };

// Boots the app on a random port with an in-memory DB and the offline fixture.
// The fixture catalog is pre-loaded (seed: false starts with an empty catalog).
export async function startServer({ seed = true, ...opts } = {}) {
  const clock = { t: Date.UTC(2026, 0, 15, 12) };
  const ctx = createApp({ dbPath: ':memory:', wikiSource: 'fixture', now: () => clock.t, warm: false, log: quiet, ...opts });
  if (seed) for (const page of FIXTURE_PAGES) ctx.catalog.save(pageToArticle(page, config.viewScale));
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let ip = 1;

  function client() {
    let cookie = '';
    // Distinct fake client IPs keep the per-IP auth limiter out of the way.
    const fwd = `10.0.${Math.floor(ip / 250)}.${ip++ % 250}`;
    async function call(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(cookie ? { cookie } : {}),
          'x-forwarded-for': fwd,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
      return { status: res.status, data, headers: res.headers };
    }
    return {
      get: (p) => call('GET', p),
      post: (p, b = {}) => call('POST', p, b),
      async signup(username, extra = {}) {
        const r = await call('POST', '/api/register', {
          username, email: `${username.toLowerCase()}@example.test`, password: 'secret123', adult: true, terms: true, ...extra,
        });
        if (r.status !== 200) throw new Error(`signup failed: ${JSON.stringify(r.data)}`);
        this.username = username;
        return this;
      },
    };
  }

  const userId = (name) => ctx.db.prepare('SELECT id FROM users WHERE username = ?').get(name).id;
  const give = (name, articleId, count = 1) =>
    ctx.db.prepare(`INSERT INTO user_cards (user_id, article_id, count, first_at) VALUES (?, ?, ?, 0)
      ON CONFLICT(user_id, article_id) DO UPDATE SET count = count + excluded.count`).run(userId(name), articleId, count);
  const setCoins = (name, coins) => ctx.db.prepare('UPDATE users SET coins = ? WHERE username = ?').run(coins, name);

  return {
    ...ctx, base, clock, client, userId, give, setCoins,
    close: () => {
      ctx.close();
      return new Promise((r) => server.close(r));
    },
  };
}
