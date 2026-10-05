// Moderation: username / text filtering, player reports, bans and an economy
// watch list for admins (sudden coin spikes usually mean an exploit).

import { tx } from './db.js';
import { GameError } from './errors.js';
import { notify } from './notify.js';

// Deliberately short lists of slurs and hate terms (EN/FR), compared against a
// normalised form (accents, leetspeak, separators and repeated letters removed).
// Unambiguous terms are blocked anywhere in a string; terms that also occur
// inside innocent words ("grape", "violet") only match as whole words.
// Admins handle anything subtler through reports.
const ANYWHERE = [
  'nigger', 'nigga', 'faggot', 'kike', 'bougnoule', 'youpin', 'hitler', 'whitepower', 'gaschamber', 'kukluxklan',
  'pedophile', 'pedophil', 'encule', 'salope',
];
const WHOLE_WORD = [
  'rape', 'viol', 'pute', 'pede', 'nazi', 'heil', 'sieg', 'retard', 'spic', 'negre', 'tapette', 'cunt',
  'connard', 'fagot', 'bicot', 'pedo', 'chink',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

export function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0134578@$!]/g, (c) => LEET[c])
    .replace(/[^a-z]/g, '')
    .replace(/(.)\1+/g, '$1');
}

// Guard: a term that normalises to almost nothing would match everything.
const ANYWHERE_N = ANYWHERE.map(normalize).filter((w) => w.length >= 4);
const WHOLE_WORD_N = new Set(WHOLE_WORD.map(normalize));

// Splits on spaces, punctuation, digits-as-separators and camelCase.
function words(s) {
  return String(s || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[\s_\-.,;:!?'"()[\]{}\/\\]+/)
    .map(normalize)
    .filter(Boolean);
}

export function isOffensive(s) {
  const all = normalize(s);
  if (ANYWHERE_N.some((w) => all.includes(w))) return true;
  return WHOLE_WORD_N.has(all) || words(s).some((w) => WHOLE_WORD_N.has(w));
}

export function assertCleanUsername(name) {
  if (isOffensive(name)) throw new GameError('This username is not allowed');
}

// Trims, length-limits and filters free text (chat, guild names...).
export function cleanText(input, max, { allowEmpty = false } = {}) {
  const text = String(input ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
  if (!text && !allowEmpty) throw new GameError('Message is empty');
  if (text && isOffensive(text)) throw new GameError('Please keep it civil — this message was blocked');
  return text;
}

export function createModeration({ db, config, now = Date.now }) {
  const isAdmin = (userId) => {
    const u = db.prepare('SELECT username, is_admin FROM users WHERE id = ?').get(userId);
    return !!u && (!!u.is_admin || config.admins.includes(u.username.toLowerCase()));
  };
  const requireAdmin = (userId) => {
    if (!isAdmin(userId)) throw new GameError('Moderators only', 403);
  };

  function report(userId, { username, reason, context = '' }) {
    const target = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username || ''));
    if (!target) throw new GameError('Player not found', 404);
    if (target.id === userId) throw new GameError("You can't report yourself");
    const text = String(reason || '').trim().slice(0, 500);
    if (text.length < 3) throw new GameError('Please describe the problem');
    const recent = db.prepare('SELECT COUNT(*) AS n FROM reports WHERE reporter_id = ? AND created_at > ?').get(userId, now() - 3600_000).n;
    if (recent >= 10) throw new GameError('Too many reports in the last hour', 429);
    db.prepare('INSERT INTO reports (reporter_id, target_user_id, reason, context, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, target.id, text, String(context).slice(0, 500), now());
    return { ok: true };
  }

  function overview(userId) {
    requireAdmin(userId);
    const reports = db.prepare(`SELECT r.*, a.username AS reporter, t.username AS target, t.banned_at FROM reports r
      JOIN users a ON a.id = r.reporter_id JOIN users t ON t.id = r.target_user_id
      WHERE r.status = 'open' ORDER BY r.id DESC LIMIT 100`).all()
      .map((r) => ({ id: r.id, reporter: r.reporter, target: r.target, reason: r.reason, context: r.context, at: r.created_at, banned: !!r.banned_at }));
    // Biggest coin gains over the last 24h: the first place to look for exploits.
    const earners = db.prepare(`SELECT u.username, SUM(l.delta) AS gained, u.coins FROM coin_ledger l JOIN users u ON u.id = l.user_id
      WHERE l.delta > 0 AND l.created_at > ? GROUP BY l.user_id ORDER BY gained DESC LIMIT 20`).all(now() - 86400_000);
    const richest = db.prepare('SELECT username, coins FROM users ORDER BY coins DESC LIMIT 20').all();
    const banned = db.prepare('SELECT username, banned_at, ban_reason FROM users WHERE banned_at IS NOT NULL ORDER BY banned_at DESC LIMIT 50').all();
    return { reports, earners, richest, banned };
  }

  function resolveReport(userId, id, status) {
    requireAdmin(userId);
    if (!['resolved', 'dismissed'].includes(status)) throw new GameError('Invalid status');
    db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, id);
    return { ok: true };
  }

  function ban(userId, username, reason = '') {
    requireAdmin(userId);
    return tx(db, () => {
      const target = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username));
      if (!target) throw new GameError('Player not found', 404);
      if (target.id === userId) throw new GameError("You can't ban yourself");
      db.prepare('UPDATE users SET banned_at = ?, ban_reason = ? WHERE id = ?').run(now(), String(reason).slice(0, 200), target.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(target.id);
      // Close what they had open on the market and in trades.
      db.prepare("UPDATE trades SET status = 'cancelled', resolved_at = ? WHERE status = 'pending' AND (from_user = ? OR to_user = ?)")
        .run(now(), target.id, target.id);
      return { ok: true };
    });
  }

  function unban(userId, username) {
    requireAdmin(userId);
    db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE username = ?').run(String(username));
    return { ok: true };
  }

  // Force-rename an offensive username.
  function rename(userId, username, newName) {
    requireAdmin(userId);
    const name = String(newName || '').trim();
    if (!/^[A-Za-z0-9_\-.]{3,20}$/.test(name)) throw new GameError('Invalid new username');
    assertCleanUsername(name);
    return tx(db, () => {
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(name)) throw new GameError('Username taken', 409);
      const target = db.prepare('SELECT id FROM users WHERE username = ?').get(String(username));
      if (!target) throw new GameError('Player not found', 404);
      db.prepare('UPDATE users SET username = ? WHERE id = ?').run(name, target.id);
      notify(db, target.id, 'custom', { message: `A moderator renamed your account to ${name}.` }, now());
      return { ok: true };
    });
  }

  return { isAdmin, report, overview, resolveReport, ban, unban, rename };
}
