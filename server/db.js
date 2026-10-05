import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { GameError } from './errors.js';

const BASE_VERSION = 2; // SCHEMA below; later changes are migrations
const SCHEMA_VERSION = 3;

// [version reached, SQL]. Applied in order to databases older than SCHEMA_VERSION.
const MIGRATIONS = [
  [3, `
    ALTER TABLE users ADD COLUMN google_sub TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub);
    -- In-flight OAuth logins (state -> PKCE verifier + nonce), kept 10 minutes.
    CREATE TABLE IF NOT EXISTS oauth_states (
      state TEXT PRIMARY KEY,
      verifier TEXT NOT NULL,
      nonce TEXT NOT NULL,
      link_user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    );
    -- Verified Google identities waiting for the player to pick a username.
    CREATE TABLE IF NOT EXISTS oauth_pending (
      token TEXT PRIMARY KEY,
      google_sub TEXT NOT NULL,
      email TEXT,
      name TEXT,
      created_at INTEGER NOT NULL
    );
  `],
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  email TEXT UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  coins INTEGER NOT NULL DEFAULT 0,
  packs INTEGER NOT NULL DEFAULT 0,
  pack_clock INTEGER NOT NULL,
  packs_opened INTEGER NOT NULL DEFAULT 0,
  quiz_day TEXT,
  quiz_rewarded INTEGER NOT NULL DEFAULT 0,
  quiz_streak INTEGER NOT NULL DEFAULT 0,
  quiz_correct INTEGER NOT NULL DEFAULT 0,
  quiz_answered INTEGER NOT NULL DEFAULT 0,
  duel_wins INTEGER NOT NULL DEFAULT 0,
  duel_losses INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  banned_at INTEGER,
  ban_reason TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,           -- Wikipedia page id
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  extract TEXT NOT NULL DEFAULT '',
  image TEXT,
  url TEXT,
  views INTEGER NOT NULL DEFAULT 0, -- avg daily views when discovered
  bytes INTEGER NOT NULL DEFAULT 0,
  refs INTEGER NOT NULL DEFAULT 0,
  images INTEGER NOT NULL DEFAULT 0,
  sections INTEGER NOT NULL DEFAULT 0,
  badge TEXT,
  rarity TEXT NOT NULL,
  atk INTEGER NOT NULL,
  def INTEGER NOT NULL,
  score REAL NOT NULL,
  discovered_at INTEGER NOT NULL,
  discovered_by INTEGER
);
CREATE INDEX IF NOT EXISTS articles_title ON articles(title);
CREATE INDEX IF NOT EXISTS articles_rarity ON articles(rarity, score);

CREATE TABLE IF NOT EXISTS user_cards (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  locked INTEGER NOT NULL DEFAULT 0,        -- owner lock: no recycle / sale / trade
  relist_after INTEGER NOT NULL DEFAULT 0,  -- anti-flipping cooldown after an auction purchase
  PRIMARY KEY (user_id, article_id)
);
CREATE INDEX IF NOT EXISTS user_cards_article ON user_cards(article_id);
CREATE INDEX IF NOT EXISTS user_cards_first ON user_cards(first_at);

CREATE TABLE IF NOT EXISTS card_tags (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (user_id, article_id, tag)
);
CREATE INDEX IF NOT EXISTS card_tags_tag ON card_tags(user_id, tag);

CREATE TABLE IF NOT EXISTS pulls (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  pack_type TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pulls_created ON pulls(created_at);

-- Pre-fetched random articles not yet dealt.
CREATE TABLE IF NOT EXISTS pool (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id),
  rarity TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS pool_rarity ON pool(rarity);

CREATE TABLE IF NOT EXISTS popular_cache (
  month TEXT PRIMARY KEY,
  titles TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS set_members (
  set_id TEXT NOT NULL,
  title TEXT NOT NULL,
  article_id INTEGER REFERENCES articles(id),
  PRIMARY KEY (set_id, title)
);

CREATE TABLE IF NOT EXISTS set_claims (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  set_id TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, set_id)
);

CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled | countered
  parent_id INTEGER REFERENCES trades(id),
  message TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS trades_to ON trades(to_user, status);
CREATE INDEX IF NOT EXISTS trades_from ON trades(from_user, status);

CREATE TABLE IF NOT EXISTS trade_items (
  trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  side TEXT NOT NULL, -- give (from_user -> to_user) | want (to_user -> from_user)
  article_id INTEGER NOT NULL REFERENCES articles(id),
  qty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS trade_items_trade ON trade_items(trade_id);

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  choices TEXT NOT NULL, -- JSON array of article ids
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS friendships (
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addressee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted
  created_at INTEGER NOT NULL,
  PRIMARY KEY (requester_id, addressee_id)
);
CREATE INDEX IF NOT EXISTS friendships_addressee ON friendships(addressee_id, status);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  from_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_pair ON messages(from_user, to_user, id);
CREATE INDEX IF NOT EXISTS messages_to ON messages(to_user, read_at);

CREATE TABLE IF NOT EXISTS guilds (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  tag TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS guild_members (
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member', -- owner | member
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS guild_messages (
  id INTEGER PRIMARY KEY,
  guild_id INTEGER NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS guild_messages_guild ON guild_messages(guild_id, id);

CREATE TABLE IF NOT EXISTS achievements (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS wishlist (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, article_id)
);
CREATE INDEX IF NOT EXISTS wishlist_article ON wishlist(article_id);

CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  start_price INTEGER NOT NULL,
  current_bid INTEGER,
  current_bidder INTEGER REFERENCES users(id),
  bids_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open', -- open | sold | unsold | cancelled
  created_at INTEGER NOT NULL,
  ends_at INTEGER NOT NULL,
  settled_at INTEGER
);
CREATE INDEX IF NOT EXISTS auctions_open ON auctions(status, ends_at);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY,
  auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bids_auction ON bids(auction_id, id);

CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY,
  challenger_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opponent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | finished | declined | cancelled
  winner_id INTEGER,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS duels_users ON duels(challenger_id, opponent_id, status);

CREATE TABLE IF NOT EXISTS duel_rounds (
  duel_id INTEGER NOT NULL REFERENCES duels(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  choices TEXT,
  served_at INTEGER,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (duel_id, user_id, slot)
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved | dismissed
  created_at INTEGER NOT NULL
);

-- Coin flow ledger: lets admins spot exploits (sudden millionaires) and
-- shows how many coins the sinks destroy.
CREATE TABLE IF NOT EXISTS coin_ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS coin_ledger_user ON coin_ledger(user_id, created_at);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const version = db.prepare('PRAGMA user_version').get().user_version;
  const hasTables = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'").get();
  if (hasTables && (version < BASE_VERSION || version > SCHEMA_VERSION)) {
    throw new Error(
      `Database ${path} uses schema v${version}, this build supports v${BASE_VERSION}–v${SCHEMA_VERSION}. ` +
        (version < BASE_VERSION ? 'It was created by a pre-release build: delete it and restart.' : 'Upgrade the app.'),
    );
  }
  db.exec(SCHEMA);
  let v = hasTables ? version : BASE_VERSION;
  for (const [target, sql] of MIGRATIONS) {
    if (v >= target) continue;
    tx(db, () => db.exec(sql));
    v = target;
  }
  db.exec(`PRAGMA user_version = ${v}`);
  return db;
}

// Run fn inside a transaction (node:sqlite has no helper for it). Nested calls
// join the outer transaction.
export function tx(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

// Every coin movement goes through here so the ledger stays complete.
export function addCoins(db, userId, delta, reason, now = Date.now()) {
  if (!delta) return;
  if (delta < 0) {
    const { changes } = db.prepare('UPDATE users SET coins = coins + ? WHERE id = ? AND coins >= ?').run(delta, userId, -delta);
    if (!changes) throw new GameError('Not enough coins');
  } else {
    db.prepare('UPDATE users SET coins = coins + ? WHERE id = ?').run(delta, userId);
  }
  db.prepare('INSERT INTO coin_ledger (user_id, delta, reason, created_at) VALUES (?, ?, ?, ?)').run(userId, delta, reason, now);
}

export function kvGet(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function kvSet(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)').run(key, JSON.stringify(value));
}

// Single entry point for giving cards to a player: keeps the album and the
// wishlist consistent (an obtained card leaves the wishlist automatically).
export function grantCard(db, userId, articleId, qty = 1, now = Date.now(), { relistAfter = 0 } = {}) {
  db.prepare(`INSERT INTO user_cards (user_id, article_id, count, first_at, relist_after) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id, article_id) DO UPDATE SET count = count + excluded.count,
      relist_after = max(relist_after, excluded.relist_after)`).run(userId, articleId, qty, now, relistAfter);
  db.prepare('DELETE FROM wishlist WHERE user_id = ? AND article_id = ?').run(userId, articleId);
}

// Removes copies from an album. Throws if the player doesn't have enough,
// or if the card is locked (unless allowLocked).
export function takeCard(db, userId, articleId, qty = 1, { allowLocked = false, title } = {}) {
  const row = db.prepare('SELECT count, locked FROM user_cards WHERE user_id = ? AND article_id = ?').get(userId, articleId);
  const name = title || db.prepare('SELECT title FROM articles WHERE id = ?').get(articleId)?.title || `#${articleId}`;
  if (!row || row.count < qty) throw new GameError(`Not enough copies of “${name}”`, 409);
  if (row.locked && !allowLocked) throw new GameError(`“${name}” is locked`, 409);
  if (row.count === qty) db.prepare('DELETE FROM user_cards WHERE user_id = ? AND article_id = ?').run(userId, articleId);
  else db.prepare('UPDATE user_cards SET count = count - ? WHERE user_id = ? AND article_id = ?').run(qty, userId, articleId);
  db.prepare('DELETE FROM card_tags WHERE user_id = ? AND article_id = ? AND NOT EXISTS (SELECT 1 FROM user_cards WHERE user_id = ? AND article_id = ?)')
    .run(userId, articleId, userId, articleId);
}
