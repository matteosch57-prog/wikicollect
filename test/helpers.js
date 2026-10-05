import { createApp } from '../server/app.js';

// Boots the app on a random port with an in-memory DB and the offline fixture.
export async function startServer(opts = {}) {
  const clock = { t: Date.UTC(2026, 0, 15, 12) };
  const ctx = createApp({ dbPath: ':memory:', wikiSource: 'fixture', now: () => clock.t, ...opts });
  const server = await new Promise((resolve) => {
    const s = ctx.app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    async function call(method, path, body) {
      const res = await fetch(base + path, {
        method,
        headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    }
    return {
      get: (p) => call('GET', p),
      post: (p, b = {}) => call('POST', p, b),
      async signup(username, password = 'secret123') {
        const r = await call('POST', '/api/register', { username, password });
        if (r.status !== 200) throw new Error(`signup failed: ${JSON.stringify(r.data)}`);
        return this;
      },
    };
  }

  return { ...ctx, base, clock, client, close: () => new Promise((r) => server.close(r)) };
}
