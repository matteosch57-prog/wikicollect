import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

// A fake Google: the next token exchange returns whatever identity we queue,
// echoing the nonce from the authorization request unless told otherwise.
const google = { next: null, lastBody: null, nonce: null };
async function fakeGoogleFetch(url, init) {
  assert.equal(url, 'https://oauth2.googleapis.com/token');
  google.lastBody = new URLSearchParams(init.body);
  const who = google.next;
  if (!who) return new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 });
  const claims = {
    iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Date.UTC(2026, 0, 16) / 1000,
    nonce: google.nonce, email_verified: true, ...who,
  };
  return new Response(JSON.stringify({ id_token: jwt(claims), access_token: 'x' }));
}

let srv;
before(async () => {
  srv = await startServer({
    google: { clientId: CLIENT_ID, clientSecret: 'secret', redirectUri: 'https://wc.test/auth/google/callback', fetchImpl: fakeGoogleFetch },
  });
});
after(() => srv.close());

// Runs the redirect dance; returns the final #hash the browser lands on and the session cookie.
let ip = 0;
async function signInWithGoogle(identity, { cookie = '', tamper = {} } = {}) {
  // Each simulated browser gets its own IP so the auth rate limiter stays out of the way.
  const fwd = { 'x-forwarded-for': `10.9.${Math.floor(++ip / 250)}.${ip % 250}` };
  const start = await fetch(`${srv.base}/auth/google${tamper.link ? '?link=1' : ''}`, { redirect: 'manual', headers: { ...fwd, ...(cookie ? { cookie } : {}) } });
  assert.equal(start.status, 303);
  const consent = new URL(start.headers.get('location'));
  assert.equal(consent.origin + consent.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(consent.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(consent.searchParams.get('client_id'), CLIENT_ID);
  google.nonce = tamper.nonce ?? consent.searchParams.get('nonce');
  google.next = identity;
  const state = tamper.state ?? consent.searchParams.get('state');
  const back = await fetch(`${srv.base}/auth/google/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: fwd });
  assert.equal(back.status, 303);
  return { hash: back.headers.get('location').replace(/^\/#/, ''), cookie: (back.headers.get('set-cookie') || '').split(';')[0] };
}

test('config advertises Google sign-in', async () => {
  assert.equal((await srv.client().get('/api/config')).data.googleAuth, true);
});

test('new Google player picks a username, then signs straight in next time', async () => {
  const first = await signInWithGoogle({ sub: 'g-111', email: 'Marie@Example.test', name: 'Marie Curie' });
  assert.match(first.hash, /^\/welcome\?t=/);
  assert.equal(first.cookie, '', 'no session before the account exists');
  assert.ok(google.lastBody.get('code_verifier'), 'PKCE verifier sent to Google');
  const token = decodeURIComponent(first.hash.split('t=')[1]);

  const c = srv.client();
  const pending = (await c.get(`/api/auth/google/pending?t=${encodeURIComponent(token)}`)).data;
  assert.equal(pending.email, 'marie@example.test');
  assert.equal(pending.suggestion, 'MarieCurie');
  assert.equal((await c.post('/api/register/google', { token, username: 'MarieCurie', adult: false, terms: true })).status, 400);
  assert.equal((await c.post('/api/register/google', { token, username: 'xX_Nazi_Xx', adult: true, terms: true })).status, 400);
  const done = await c.post('/api/register/google', { token, username: 'MarieCurie', adult: true, terms: true });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  const me = (await c.get('/api/me')).data;
  assert.equal(me.username, 'MarieCurie');
  assert.deepEqual(me.auth, { google: true, password: false });
  assert.equal((await c.post('/api/register/google', { token, username: 'Other', adult: true, terms: true })).status, 404, 'token is single-use');

  // Returning player: straight in.
  const again = await signInWithGoogle({ sub: 'g-111', email: 'marie@example.test' });
  assert.equal(again.hash, '/');
  assert.match(again.cookie, /^wc_session=/);
  const meAgain = await fetch(`${srv.base}/api/me`, { headers: { cookie: again.cookie } }).then((r) => r.json());
  assert.equal(meAgain.username, 'MarieCurie');

  // Password login is refused for a Google-only account.
  const pw = await srv.client().post('/api/login', { username: 'MarieCurie', password: 'whatever1' });
  assert.equal(pw.status, 401);
  assert.match(pw.data.error, /Google/);
});

test('Google never silently takes over an existing password account', async () => {
  await srv.client().signup('victim');
  const r = await signInWithGoogle({ sub: 'g-attacker-or-owner', email: 'victim@example.test' });
  assert.match(decodeURIComponent(r.hash), /auth_error=An account already uses this email/);
  assert.equal(r.cookie, '');
});

test('a signed-in player can link Google, then use it to sign in', async () => {
  const c = await srv.client().signup('linker');
  const login = await srv.client().post('/api/login', { username: 'linker', password: 'secret123' });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const linked = await signInWithGoogle({ sub: 'g-linker', email: 'linker@example.test' }, { cookie, tamper: { link: true } });
  assert.equal(linked.hash, '/?google=linked');
  assert.deepEqual((await c.get('/api/me')).data.auth, { google: true, password: true });
  const viaGoogle = await signInWithGoogle({ sub: 'g-linker' });
  assert.equal(viaGoogle.hash, '/');
  // Linking an identity that belongs to someone else is refused.
  await srv.client().signup('other');
  const otherCookie = (await srv.client().post('/api/login', { username: 'other', password: 'secret123' })).headers.get('set-cookie').split(';')[0];
  const clash = await signInWithGoogle({ sub: 'g-linker' }, { cookie: otherCookie, tamper: { link: true } });
  assert.match(decodeURIComponent(clash.hash), /already linked to another player/);
  // Unlink keeps the account reachable by password.
  assert.equal((await c.post('/api/account/google/unlink')).status, 200);
});

test('Google-only players must set a password before unlinking', async () => {
  const r = await signInWithGoogle({ sub: 'g-solo', email: 'solo@example.test', name: 'Solo' });
  const token = decodeURIComponent(r.hash.split('t=')[1]);
  const c = srv.client();
  await c.post('/api/register/google', { token, username: 'solo', adult: true, terms: true });
  assert.equal((await c.post('/api/account/google/unlink')).status, 400);
  assert.equal((await c.post('/api/account/password', { password: 'short' })).status, 400);
  assert.equal((await c.post('/api/account/password', { password: 'new-secret-1' })).status, 200);
  assert.equal((await c.post('/api/account/password', { current: 'nope', password: 'new-secret-2' })).status, 401);
  assert.equal((await c.post('/api/account/google/unlink')).status, 200);
  assert.equal((await srv.client().post('/api/login', { username: 'solo', password: 'new-secret-1' })).status, 200);
});

test('forged or mismatched callbacks are rejected', async () => {
  const badState = await signInWithGoogle({ sub: 'g-x' }, { tamper: { state: 'forged' } });
  assert.match(decodeURIComponent(badState.hash), /auth_error=This sign-in link expired/);
  const badNonce = await signInWithGoogle({ sub: 'g-x' }, { tamper: { nonce: 'replayed' } });
  assert.match(decodeURIComponent(badNonce.hash), /auth_error=.*nonce/);
  const badAud = await signInWithGoogle({ sub: 'g-x', aud: 'someone-else' });
  assert.match(decodeURIComponent(badAud.hash), /another application/);
  const badIss = await signInWithGoogle({ sub: 'g-x', iss: 'https://evil.example' });
  assert.match(decodeURIComponent(badIss.hash), /issuer/);
  const expired = await signInWithGoogle({ sub: 'g-x', exp: 1 });
  assert.match(decodeURIComponent(expired.hash), /expired/i);
  const cancelled = await fetch(`${srv.base}/auth/google/callback?error=access_denied&state=x`, { redirect: 'manual' });
  assert.match(decodeURIComponent(cancelled.headers.get('location')), /cancelled/);
});

test('banned Google players cannot sign in', async () => {
  const r = await signInWithGoogle({ sub: 'g-banned', email: 'b@example.test', name: 'Banned' });
  const token = decodeURIComponent(r.hash.split('t=')[1]);
  await srv.client().post('/api/register/google', { token, username: 'banme', adult: true, terms: true });
  srv.db.prepare("UPDATE users SET banned_at = 1 WHERE username = 'banme'").run();
  const again = await signInWithGoogle({ sub: 'g-banned' });
  assert.match(decodeURIComponent(again.hash), /banned/);
});

test('without credentials, Google sign-in is off', async () => {
  const plain = await startServer();
  try {
    assert.equal((await plain.client().get('/api/config')).data.googleAuth, false);
    const r = await fetch(`${plain.base}/auth/google`, { redirect: 'manual' });
    assert.match(decodeURIComponent(r.headers.get('location')), /not configured/);
  } finally {
    await plain.close();
  }
});
