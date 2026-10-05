// Friends, direct messages, guilds and moderation.

import { config } from './config.js';
import { tx, addCoins } from './db.js';
import { GameError } from './errors.js';
import { notify, checkAchievements } from './notify.js';
import { cleanText } from './moderation.js';

export function createSocial({ db, game, now = Date.now }) {
  const userByName = (name) => {
    const u = db.prepare('SELECT id, username FROM users WHERE username = ? AND banned_at IS NULL').get(String(name || ''));
    if (!u) throw new GameError('Player not found', 404);
    return u;
  };
  const nameOf = (id) => db.prepare('SELECT username FROM users WHERE id = ?').get(id)?.username;

  function areFriends(a, b) {
    return !!db.prepare(`SELECT 1 FROM friendships WHERE status = 'accepted'
      AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`).get(a, b, b, a);
  }

  // --- friends --------------------------------------------------------------

  function friends(userId) {
    const rows = db.prepare(`
      SELECT f.*, CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END AS other_id
      FROM friendships f WHERE f.requester_id = ? OR f.addressee_id = ?`).all(userId, userId, userId);
    const view = (r) => {
      const other = db.prepare('SELECT id, username FROM users WHERE id = ?').get(r.other_id);
      const unread = db.prepare('SELECT COUNT(*) AS n FROM messages WHERE from_user = ? AND to_user = ? AND read_at IS NULL').get(other.id, userId).n;
      const last = db.prepare(`SELECT body, created_at, from_user FROM messages
        WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?) ORDER BY id DESC LIMIT 1`).get(userId, other.id, other.id, userId);
      return {
        username: other.username,
        since: r.created_at,
        unread,
        lastMessage: last ? { body: last.body.slice(0, 80), at: last.created_at, mine: last.from_user === userId } : null,
      };
    };
    return {
      friends: rows.filter((r) => r.status === 'accepted').map(view)
        .sort((a, b) => (b.lastMessage?.at || b.since) - (a.lastMessage?.at || a.since)),
      incoming: rows.filter((r) => r.status === 'pending' && r.addressee_id === userId).map(view),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === userId).map(view),
    };
  }

  function requestFriend(userId, name) {
    const other = userByName(name);
    if (other.id === userId) throw new GameError("You can't add yourself");
    return tx(db, () => {
      const existing = db.prepare(`SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`)
        .get(userId, other.id, other.id, userId);
      if (existing?.status === 'accepted') throw new GameError('You are already friends');
      if (existing && existing.requester_id === userId) throw new GameError('Request already sent');
      if (existing) {
        // They already asked us: accept.
        db.prepare("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?").run(other.id, userId);
        notify(db, other.id, 'friend_accepted', { by: nameOf(userId) }, now());
        checkAchievements(db, userId, now());
        checkAchievements(db, other.id, now());
        return { status: 'friends' };
      }
      const pending = db.prepare("SELECT COUNT(*) AS n FROM friendships WHERE requester_id = ? AND status = 'pending'").get(userId).n;
      if (pending >= 50) throw new GameError('Too many pending friend requests');
      db.prepare('INSERT INTO friendships (requester_id, addressee_id, created_at) VALUES (?, ?, ?)').run(userId, other.id, now());
      notify(db, other.id, 'friend_request', { from: nameOf(userId) }, now());
      return { status: 'requested' };
    });
  }

  function answerFriend(userId, name, accept) {
    const other = userByName(name);
    return tx(db, () => {
      const req = db.prepare("SELECT * FROM friendships WHERE requester_id = ? AND addressee_id = ? AND status = 'pending'").get(other.id, userId);
      if (!req) throw new GameError('No pending request from this player', 404);
      if (accept) {
        db.prepare("UPDATE friendships SET status = 'accepted' WHERE requester_id = ? AND addressee_id = ?").run(other.id, userId);
        notify(db, other.id, 'friend_accepted', { by: nameOf(userId) }, now());
        checkAchievements(db, userId, now());
        checkAchievements(db, other.id, now());
      } else {
        db.prepare('DELETE FROM friendships WHERE requester_id = ? AND addressee_id = ?').run(other.id, userId);
      }
      return { status: accept ? 'friends' : 'none' };
    });
  }

  function removeFriend(userId, name) {
    const other = userByName(name);
    db.prepare('DELETE FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)')
      .run(userId, other.id, other.id, userId);
    return { status: 'none' };
  }

  // --- direct messages (friends only) ---------------------------------------

  function conversation(userId, name, { after = 0 } = {}) {
    const other = userByName(name);
    if (!areFriends(userId, other.id)) throw new GameError('You can only message friends', 403);
    const rows = db.prepare(`SELECT id, from_user, body, created_at FROM messages
      WHERE ((from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?)) AND id > ?
      ORDER BY id DESC LIMIT 100`).all(userId, other.id, other.id, userId, Number(after) || 0).reverse();
    db.prepare('UPDATE messages SET read_at = ? WHERE from_user = ? AND to_user = ? AND read_at IS NULL').run(now(), other.id, userId);
    return {
      with: other.username,
      messages: rows.map((m) => ({ id: m.id, mine: m.from_user === userId, body: m.body, at: m.created_at })),
    };
  }

  const lastPost = new Map();
  function throttle(userId) {
    const t = Date.now();
    if (t - (lastPost.get(userId) || 0) < 700) throw new GameError('Slow down a little', 429);
    lastPost.set(userId, t);
  }

  function sendMessage(userId, name, body) {
    const other = userByName(name);
    if (!areFriends(userId, other.id)) throw new GameError('You can only message friends', 403);
    const text = cleanText(body, 1000);
    throttle(userId);
    return tx(db, () => {
      const { lastInsertRowid } = db.prepare('INSERT INTO messages (from_user, to_user, body, created_at) VALUES (?, ?, ?, ?)')
        .run(userId, other.id, text, now());
      // One unread chat notification per conversation is enough.
      const already = db.prepare(`SELECT 1 FROM notifications WHERE user_id = ? AND type = 'chat_message' AND read_at IS NULL
        AND json_extract(data, '$.from') = ?`).get(other.id, nameOf(userId));
      if (!already) notify(db, other.id, 'chat_message', { from: nameOf(userId) }, now());
      return { id: Number(lastInsertRowid), mine: true, body: text, at: now() };
    });
  }

  // --- guilds ---------------------------------------------------------------

  function membership(userId) {
    return db.prepare('SELECT * FROM guild_members WHERE user_id = ?').get(userId);
  }

  function guildView(guildId, viewerId) {
    const g = db.prepare('SELECT * FROM guilds WHERE id = ?').get(guildId);
    if (!g) throw new GameError('Guild not found', 404);
    const members = db.prepare(`SELECT u.id, u.username, gm.role, gm.joined_at FROM guild_members gm JOIN users u ON u.id = gm.user_id
      WHERE gm.guild_id = ?`).all(guildId)
      .map((m) => ({ username: m.username, role: m.role, joinedAt: m.joined_at, score: game.collectionScore(m.id) }))
      .sort((a, b) => b.score - a.score);
    const mine = viewerId ? membership(viewerId) : null;
    return {
      id: g.id, name: g.name, tag: g.tag, description: g.description, createdAt: g.created_at,
      owner: nameOf(g.owner_id),
      members,
      score: members.reduce((s, m) => s + m.score, 0),
      maxMembers: config.guild.maxMembers,
      isMember: mine?.guild_id === g.id,
      isOwner: mine?.guild_id === g.id && mine.role === 'owner',
    };
  }

  function guilds({ q } = {}) {
    const rows = db.prepare(`SELECT g.id, g.name, g.tag, g.description, COUNT(gm.user_id) AS members FROM guilds g
      LEFT JOIN guild_members gm ON gm.guild_id = g.id ${q ? 'WHERE g.name LIKE ? OR g.tag LIKE ?' : ''}
      GROUP BY g.id ORDER BY members DESC, g.created_at ASC LIMIT 60`).all(...(q ? [`%${q}%`, `%${q}%`] : []));
    return rows.map((r) => ({ ...r, maxMembers: config.guild.maxMembers }));
  }

  function myGuild(userId) {
    const m = membership(userId);
    return m ? guildView(m.guild_id, userId) : null;
  }

  function createGuild(userId, { name, tag, description = '' }) {
    name = cleanText(name, 32);
    tag = String(tag || '').trim().toUpperCase();
    if (name.length < 3) throw new GameError('Guild name: at least 3 characters');
    if (!/^[A-Z0-9]{2,5}$/.test(tag)) throw new GameError('Guild tag: 2–5 letters or digits');
    return tx(db, () => {
      if (membership(userId)) throw new GameError('Leave your current guild first');
      if (db.prepare('SELECT 1 FROM guilds WHERE name = ? OR tag = ?').get(name, tag)) throw new GameError('Name or tag already taken', 409);
      addCoins(db, userId, -config.guild.createCost, 'guild:create', now());
      game.burn(config.guild.createCost);
      const { lastInsertRowid } = db.prepare('INSERT INTO guilds (name, tag, description, owner_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(name, tag, cleanText(description || ' ', 300, { allowEmpty: true }), userId, now());
      const id = Number(lastInsertRowid);
      db.prepare("INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)").run(id, userId, now());
      checkAchievements(db, userId, now());
      return guildView(id, userId);
    });
  }

  function joinGuild(userId, guildId) {
    return tx(db, () => {
      if (membership(userId)) throw new GameError('Leave your current guild first');
      const g = db.prepare('SELECT id FROM guilds WHERE id = ?').get(guildId);
      if (!g) throw new GameError('Guild not found', 404);
      const n = db.prepare('SELECT COUNT(*) AS n FROM guild_members WHERE guild_id = ?').get(guildId).n;
      if (n >= config.guild.maxMembers) throw new GameError('This guild is full');
      db.prepare("INSERT INTO guild_members (guild_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)").run(guildId, userId, now());
      checkAchievements(db, userId, now());
      return guildView(guildId, userId);
    });
  }

  function leaveGuild(userId) {
    return tx(db, () => {
      const m = membership(userId);
      if (!m) throw new GameError('You are not in a guild');
      db.prepare('DELETE FROM guild_members WHERE user_id = ?').run(userId);
      if (m.role === 'owner') {
        const heir = db.prepare('SELECT user_id FROM guild_members WHERE guild_id = ? ORDER BY joined_at LIMIT 1').get(m.guild_id);
        if (heir) {
          db.prepare("UPDATE guild_members SET role = 'owner' WHERE user_id = ?").run(heir.user_id);
          db.prepare('UPDATE guilds SET owner_id = ? WHERE id = ?').run(heir.user_id, m.guild_id);
        } else {
          db.prepare('DELETE FROM guilds WHERE id = ?').run(m.guild_id);
        }
      }
      return { ok: true };
    });
  }

  function kick(userId, name) {
    const other = userByName(name);
    return tx(db, () => {
      const m = membership(userId);
      if (m?.role !== 'owner') throw new GameError('Only the guild owner can remove members', 403);
      const target = membership(other.id);
      if (!target || target.guild_id !== m.guild_id || other.id === userId) throw new GameError('Not a member of your guild', 404);
      db.prepare('DELETE FROM guild_members WHERE user_id = ?').run(other.id);
      return guildView(m.guild_id, userId);
    });
  }

  function inviteToGuild(userId, name) {
    const other = userByName(name);
    const m = membership(userId);
    if (!m) throw new GameError('You are not in a guild');
    if (!areFriends(userId, other.id)) throw new GameError('You can only invite friends', 403);
    if (membership(other.id)?.guild_id === m.guild_id) throw new GameError('Already a member');
    const g = db.prepare('SELECT name FROM guilds WHERE id = ?').get(m.guild_id);
    notify(db, other.id, 'guild_invite', { guildId: m.guild_id, guild: g.name, from: nameOf(userId) }, now());
    return { ok: true };
  }

  function guildChat(userId, { after = 0 } = {}) {
    const m = membership(userId);
    if (!m) throw new GameError('You are not in a guild', 404);
    const rows = db.prepare(`SELECT gm.id, gm.body, gm.created_at, u.username FROM guild_messages gm JOIN users u ON u.id = gm.user_id
      WHERE gm.guild_id = ? AND gm.id > ? ORDER BY gm.id DESC LIMIT 100`).all(m.guild_id, Number(after) || 0).reverse();
    return rows.map((r) => ({ id: r.id, from: r.username, body: r.body, at: r.created_at, mine: r.username === nameOf(userId) }));
  }

  function postGuildChat(userId, body) {
    const m = membership(userId);
    if (!m) throw new GameError('You are not in a guild', 404);
    const text = cleanText(body, 1000);
    throttle(userId);
    const { lastInsertRowid } = db.prepare('INSERT INTO guild_messages (guild_id, user_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(m.guild_id, userId, text, now());
    return { id: Number(lastInsertRowid), from: nameOf(userId), body: text, at: now(), mine: true };
  }

  return {
    areFriends, friends, requestFriend, answerFriend, removeFriend, conversation, sendMessage,
    guilds, guildView, myGuild, createGuild, joinGuild, leaveGuild, kick, inviteToGuild, guildChat, postGuildChat,
  };
}
