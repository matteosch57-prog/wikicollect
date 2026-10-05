import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
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
  quiz_answered INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,           -- Wikipedia page id
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  extract TEXT NOT NULL DEFAULT '',
  image TEXT,
  url TEXT,
  views INTEGER NOT NULL DEFAULT 0, -- avg daily views when discovered
  bytes INTEGER NOT NULL DEFAULT 0,
  score REAL NOT NULL,
  rarity TEXT NOT NULL,
  discovered_at INTEGER NOT NULL,
  discovered_by INTEGER
);
CREATE INDEX IF NOT EXISTS articles_title ON articles(title);
CREATE INDEX IF NOT EXISTS articles_rarity ON articles(rarity);

CREATE TABLE IF NOT EXISTS user_cards (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  count INTEGER NOT NULL,
  first_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, article_id)
);
CREATE INDEX IF NOT EXISTS user_cards_article ON user_cards(article_id);

CREATE TABLE IF NOT EXISTS pulls (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pulls_created ON pulls(created_at);

-- Pre-fetched random articles waiting to be dealt (each is dealt once).
CREATE TABLE IF NOT EXISTS pool (
  article_id INTEGER PRIMARY KEY REFERENCES articles(id)
);

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
  status TEXT NOT NULL DEFAULT 'pending', -- pending | accepted | declined | cancelled | failed
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

CREATE TABLE IF NOT EXISTS quiz_questions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  choices TEXT NOT NULL, -- JSON array of article ids
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);
  return db;
}

// Run fn inside a transaction (node:sqlite has no helper for it).
export function tx(db, fn) {
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
