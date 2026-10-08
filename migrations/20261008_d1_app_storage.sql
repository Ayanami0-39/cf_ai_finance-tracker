-- Additive only: existing expenses, Durable Object namespaces and records stay intact.
-- JSON preserves existing password hashes and all account/family fields verbatim.
CREATE TABLE IF NOT EXISTS app_user_accounts (
  username_key TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK (json_valid(record_json))
);
CREATE TABLE IF NOT EXISTS app_families (
  code TEXT PRIMARY KEY,
  record_json TEXT NOT NULL CHECK (json_valid(record_json))
);
CREATE TABLE IF NOT EXISTS app_family_memberships (
  username_key TEXT PRIMARY KEY,
  family_code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_chat_messages (
  scope TEXT NOT NULL,
  id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  record_json TEXT NOT NULL CHECK (json_valid(record_json)),
  PRIMARY KEY (scope, id)
);
CREATE INDEX IF NOT EXISTS idx_chat_scope_timestamp ON app_chat_messages (scope, timestamp, id);
CREATE TABLE IF NOT EXISTS app_scope_metadata (
  scope TEXT NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  PRIMARY KEY (scope, key)
);
-- Immutable copies of ALL legacy keys, including legacy expenses and metadata.
CREATE TABLE IF NOT EXISTS app_legacy_snapshots (
  object_id TEXT NOT NULL,
  key TEXT NOT NULL,
  scope TEXT,
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  captured_at INTEGER NOT NULL,
  PRIMARY KEY (object_id, key)
);
CREATE TABLE IF NOT EXISTS app_storage_migrations (
  migration_key TEXT PRIMARY KEY,
  completed_at INTEGER NOT NULL,
  source_count INTEGER NOT NULL
);

-- Inventory also includes empty/orphaned objects, so full-namespace verification is possible.
CREATE TABLE IF NOT EXISTS app_legacy_objects (
  object_id TEXT PRIMARY KEY,
  scope TEXT
);
