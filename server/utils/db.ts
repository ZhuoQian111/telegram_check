import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
let connection: Database.Database | undefined
export function db() {
  if (connection) return connection
  const path = process.env.DATABASE_PATH || './data/app.sqlite'
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  connection = new Database(path)
  connection.pragma('journal_mode = WAL')
  connection.pragma('foreign_keys = ON')
  connection.pragma('busy_timeout = 5000')
  connection.exec(`
    CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, username TEXT NOT NULL DEFAULT '',
      session TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'connected', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      chat_id TEXT NOT NULL, chat_title TEXT NOT NULL, peer TEXT NOT NULL, text TEXT NOT NULL,
      time TEXT NOT NULL, timezone TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
      next_run TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_due ON tasks(enabled,next_run);
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, task_name TEXT NOT NULL,
      account_id TEXT NOT NULL, chat_title TEXT NOT NULL, scheduled_at TEXT NOT NULL,
      started_at TEXT, finished_at TEXT, status TEXT NOT NULL, error TEXT, message_id TEXT,
      random_id TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'scheduled',
      UNIQUE(task_id,scheduled_at,kind)
    );
    CREATE INDEX IF NOT EXISTS runs_history ON runs(scheduled_at DESC);
    CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, password_fingerprint TEXT NOT NULL);
    INSERT OR IGNORE INTO migrations VALUES (1);
  `)
  return connection
}
