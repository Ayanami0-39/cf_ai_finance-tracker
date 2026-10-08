-- Reconstructed from the deployed schema for fresh databases. Existing production migration names are retained.

ALTER TABLE expenses ADD COLUMN idempotency_key TEXT;

ALTER TABLE expenses ADD COLUMN deleted_at INTEGER;

ALTER TABLE expenses ADD COLUMN account_id TEXT;

ALTER TABLE expenses ADD COLUMN paid_by TEXT;

ALTER TABLE expenses ADD COLUMN split_with TEXT;

ALTER TABLE expenses ADD COLUMN dedup_hash TEXT;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'cash',     
  icon TEXT,                             
  initial_balance REAL NOT NULL DEFAULT 0,
  note TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_scope ON accounts (scope, archived);

CREATE TABLE IF NOT EXISTS transfers (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  from_account TEXT NOT NULL,
  to_account TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_transfers_scope ON transfers (scope, date DESC);

CREATE TABLE IF NOT EXISTS category_rules (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'merchant', 
  pattern TEXT NOT NULL,                 
  category TEXT NOT NULL,                
  priority INTEGER NOT NULL DEFAULT 100, 
  active INTEGER NOT NULL DEFAULT 1,
  hit_count INTEGER NOT NULL DEFAULT 0,  
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rules_scope ON category_rules (scope, active, priority);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,                    
  title TEXT NOT NULL,
  body TEXT,
  target_id TEXT,                        
  read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_scope ON notifications (scope, read, created_at DESC);

CREATE TABLE IF NOT EXISTS account_sessions (
  id TEXT PRIMARY KEY,                   
  username TEXT NOT NULL,
  token_hash TEXT NOT NULL,              
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_username ON account_sessions (username, revoked, expires_at DESC);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,                  
  fail_count INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL,
  last_fail_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS login_devices (
  key TEXT PRIMARY KEY,                  
  username TEXT NOT NULL,
  session_id TEXT NOT NULL,
  user_agent TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_devices_username ON login_devices (username, last_seen DESC);
