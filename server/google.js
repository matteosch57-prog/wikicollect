// "Sign in with Google" — OpenID Connect authorization-code flow with PKCE,
// state and nonce. No SDK: two redirects and one token request.
//
// Account rules:
//   - a Google identity (its stable `sub`) maps to at most one player;
//   - a Google login is never attached to an existing password account just
//     because the email matches (that would allow account pre-hijacking);
//     players link Google from their own, logged-in account instead;
//   - new players still pick a username and accept the rules before an
//     account is created.

import { createHash, randomBytes } from 'node:crypto';
import { tx } from './db.js';
import { GameError } from './errors.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const STATE_TTL = 10 * 60 * 1000;
const PENDING_TTL = 30 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

export function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1];
  if (!part) throw new GameError('Malformed ID token', 400);
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

export function createGoogleAuth({ db, clientId, clientSecret, redirectUri, fetchImpl = fetch, now = Date.now }) {
  const enabled = !!(clientId && clientSecret && redirectUri);

  function cleanup() {
    db.prepare('DELETE FROM oauth_states WHERE created_at < ?').run(now() - STATE_TTL);
    db.prepare('DELETE FROM oauth_pending WHERE created_at < ?').run(now() - PENDING_TTL);
  }

  // Step 1: build the Google consent URL. `linkUserId` links Google to an
  // already signed-in player instead of logging in.
  function authorizationUrl({ linkUserId = null } = {}) {
    if (!enabled) throw new GameError('Google sign-in is not configured on this server', 404);
    cleanup();
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const nonce = b64url(randomBytes(16));
    db.prepare('INSERT INTO oauth_states (state, verifier, nonce, link_user_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(state, verifier, nonce, linkUserId, now());
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    return `${AUTH_URL}?${params}`;
  }

  // Step 2: Google redirected back. Exchange the code and validate the ID token.
  // Returns { userId } to log in, { linked: userId } after linking, or
  // { pending: token } when a new player must choose a username.
  async function handleCallback({ code, state, error }) {
    if (!enabled) throw new GameError('Google sign-in is not configured on this server', 404);
    if (error) throw new GameError(error === 'access_denied' ? 'Google sign-in was cancelled' : `Google sign-in failed: ${error}`, 400);
    const saved = state && db.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING *').get(String(state));
    if (!saved || now() - saved.created_at > STATE_TTL) throw new GameError('This sign-in link expired. Please try again.', 400);
    if (!code) throw new GameError('Missing authorization code', 400);

    const res = await fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        code_verifier: saved.verifier,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const tokens = await res.json().catch(() => ({}));
    if (!res.ok || !tokens.id_token) throw new GameError('Google did not accept the sign-in. Please try again.', 502);

    // The ID token comes straight from Google's token endpoint over TLS, using
    // our client secret, so its signature does not need re-checking (per
    // Google's OIDC guide); its claims still do.
    const claims = decodeJwtPayload(tokens.id_token);
    if (!ISSUERS.has(claims.iss)) throw new GameError('Unexpected token issuer', 400);
    if (claims.aud !== clientId) throw new GameError('Token was issued for another application', 400);
    if (!(claims.exp * 1000 > now())) throw new GameError('Token expired', 400);
    if (claims.nonce !== saved.nonce) throw new GameError('Sign-in could not be verified (nonce)', 400);
    if (!claims.sub) throw new GameError('Token has no subject', 400);
    const email = claims.email_verified ? String(claims.email || '').toLowerCase() : null;

    return tx(db, () => {
      const owner = db.prepare('SELECT id, banned_at, ban_reason FROM users WHERE google_sub = ?').get(claims.sub);

      if (saved.link_user_id) {
        if (owner && owner.id !== saved.link_user_id) throw new GameError('This Google account is already linked to another player', 409);
        db.prepare('UPDATE users SET google_sub = ? WHERE id = ?').run(claims.sub, saved.link_user_id);
        return { linked: saved.link_user_id };
      }

      if (owner) {
        if (owner.banned_at) throw new GameError(`This account is banned${owner.ban_reason ? `: ${owner.ban_reason}` : ''}`, 403);
        return { userId: owner.id };
      }

      if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
        throw new GameError('An account already uses this email. Sign in with your password, then link Google from your account menu.', 409);
      }

      const token = b64url(randomBytes(24));
      db.prepare('INSERT INTO oauth_pending (token, google_sub, email, name, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(token, claims.sub, email, String(claims.name || claims.given_name || '').slice(0, 80), now());
      return { pending: token };
    });
  }

  function pending(token) {
    cleanup();
    const p = db.prepare('SELECT email, name FROM oauth_pending WHERE token = ?').get(String(token || ''));
    if (!p) throw new GameError('This Google sign-up expired. Please continue with Google again.', 404);
    return { email: p.email, suggestion: suggestUsername(p.name || p.email?.split('@')[0] || '') };
  }

  // Consumes a pending identity (used by auth.registerWithGoogle).
  function takePending(token) {
    const p = db.prepare('DELETE FROM oauth_pending WHERE token = ? RETURNING *').get(String(token || ''));
    if (!p || now() - p.created_at > PENDING_TTL) throw new GameError('This Google sign-up expired. Please continue with Google again.', 404);
    return p;
  }

  function suggestUsername(name) {
    const base = String(name).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_.-]+/g, '').slice(0, 16) || 'collector';
    let candidate = base.length >= 3 ? base : `${base}wiki`;
    for (let i = 0; i < 20 && db.prepare('SELECT 1 FROM users WHERE username = ?').get(candidate); i++) {
      candidate = `${base.slice(0, 15)}${Math.floor(Math.random() * 9000) + 1000}`;
    }
    return candidate;
  }

  function unlink(userId) {
    const u = db.prepare('SELECT pass_hash, google_sub FROM users WHERE id = ?').get(userId);
    if (!u?.google_sub) throw new GameError('No Google account is linked');
    if (!u.pass_hash) throw new GameError('Set a password before unlinking Google, or you would be locked out');
    db.prepare('UPDATE users SET google_sub = NULL WHERE id = ?').run(userId);
    return { ok: true };
  }

  return { enabled, authorizationUrl, handleCallback, pending, takePending, unlink };
}
