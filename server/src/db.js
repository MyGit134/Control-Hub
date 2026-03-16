const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbFile = process.env.DB_FILE
  ? path.resolve(process.cwd(), process.env.DB_FILE)
  : path.join(dataDir, 'app.db');

const db = new Database(dbFile);

db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  can_run_multi INTEGER NOT NULL DEFAULT 0,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  uses_left INTEGER NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  group_id INTEGER,
  ssh_host TEXT NOT NULL,
  ssh_port INTEGER NOT NULL DEFAULT 22,
  ssh_username TEXT NOT NULL,
  ssh_auth_type TEXT NOT NULL DEFAULT 'password',
  ssh_password_enc TEXT,
  ssh_private_key_enc TEXT,
  ssh_passphrase_enc TEXT,
  term_type TEXT NOT NULL DEFAULT 'xterm-256color',
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(name, owner_id),
  FOREIGN KEY (owner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  machine_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  target_host TEXT NOT NULL,
  target_port INTEGER NOT NULL,
  target_path TEXT NOT NULL DEFAULT '/',
  protocol TEXT NOT NULL DEFAULT 'http',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (machine_id) REFERENCES machines(id)
);
`);

function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('users', 'can_run_multi', 'can_run_multi INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'token_version', 'token_version INTEGER NOT NULL DEFAULT 0');
ensureColumn('machines', 'group_id', 'group_id INTEGER');
ensureColumn('machines', 'term_type', "term_type TEXT NOT NULL DEFAULT 'xterm-256color'");

module.exports = db;

