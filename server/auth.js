import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { GameError } from './errors.js';
import { assertCleanUsername } from './moderation.js';

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
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').run(userId, now());
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, now() + SESSION_MS);
    return token;
  }

  async function register({ username, email, password, adult, terms }) {
    username = String(username || '').trim();
    email = String(email || '').trim().toLowerCase();
    password = String(password || '');
    if (!/^[A-Za-z0-9_\-.]{3,20}$/.test(username)) {
      throw new GameError('Username: 3–20 characters, letters, digits, _ - . only');
    }
    assertCleanUsername(username);
    if (!/^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(email)) throw new GameError('Please enter a valid email address');
    if (password.length < 8) throw new GameError('Password must be at least 8 characters');
    if (!adult || !terms) throw new GameError('Please confirm you are 18+ and accept the rules');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new GameError('Username is taken', 409);
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new GameError('An account already uses this email', 409);
    const hash = await hashPassword(password);
    const isAdmin = config.admins.includes(username.toLowerCase()) ? 1 : 0;
    const { lastInsertRowid } = db.prepare(`
      INSERT INTO users (username, email, pass_hash, created_at, packs, pack_clock, coins, is_admin) VALUES (?, ?, ?, ?, ?, ?, 0, ?)`)
      .run(username, email, hash, now(), config.packs.starterPacks, now(), isAdmin);
    return newSession(Number(lastInsertRowid));
  }

  async function login(identifier, password) {
    const id = String(identifier || '').trim();
    const u = db.prepare('SELECT id, pass_hash, banned_at, ban_reason FROM users WHERE username = ? OR email = ?').get(id, id.toLowerCase());
    if (!u || !(await verifyPassword(String(password || ''), u.pass_hash))) {
      throw new GameError('Wrong username or password', 401);
    }
    if (u.banned_at) throw new GameError(`This account is banned${u.ban_reason ? `: ${u.ban_reason}` : ''}`, 403);
    return newSession(u.id);
  }

  function logout(token) {
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  function userIdFor(token) {
    if (!token) return null;
    const s = db.prepare(`SELECT s.user_id, s.expires_at, u.banned_at FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ?`).get(token);
    if (!s || s.expires_at < now() || s.banned_at) return null;
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
