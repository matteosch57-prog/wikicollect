import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { GameError } from './errors.js';

const scrypt = promisify(scryptCb);
const SESSION_MS = 30 * 24 * 3600 * 1000;
export const COOKIE = 'wc_session';

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [, salt, key] = stored.split('$');
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

export function createAuth({ db, now = Date.now }) {
  function newSession(userId) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, now() + SESSION_MS);
    return token;
  }

  async function register(username, password) {
    username = String(username || '').trim();
    password = String(password || '');
    if (!/^[A-Za-z0-9_\-.]{3,20}$/.test(username)) {
      throw new GameError('Username: 3–20 characters, letters, digits, _ - . only');
    }
    if (password.length < 6) throw new GameError('Password must be at least 6 characters');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new GameError('Username is taken', 409);
    const hash = await hashPassword(password);
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users (username, pass_hash, created_at, packs, pack_clock, coins) VALUES (?, ?, ?, ?, ?, 0)`)
      .run(username, hash, now(), config.packs.starterPacks, now());
    return newSession(Number(lastInsertRowid));
  }

  async function login(username, password) {
    const u = db.prepare('SELECT id, pass_hash FROM users WHERE username = ?').get(String(username || '').trim());
    if (!u || !(await verifyPassword(String(password || ''), u.pass_hash))) {
      throw new GameError('Wrong username or password', 401);
    }
    return newSession(u.id);
  }

  function logout(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  function userIdFor(token) {
    if (!token) return null;
    const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token = ?').get(token);
    if (!s || s.expires_at < now()) return null;
    return s.user_id;
  }

  function cookieHeader(token, req) {
    const secure = config.cookieSecure || req?.secure ? '; Secure' : '';
    if (!token) return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MS / 1000}${secure}`;
  }

  return { register, login, logout, userIdFor, cookieHeader };
}

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}
