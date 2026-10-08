-- Reconstructed from the deployed schema for fresh databases. Existing production migration names are retained.

CREATE TABLE IF NOT EXISTS do_backups (
  do_class   TEXT NOT NULL,             
  scope      TEXT NOT NULL,             
  key        TEXT NOT NULL,             
  value      TEXT NOT NULL,             
  bytes      INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (do_class, scope, key)
);

CREATE INDEX IF NOT EXISTS idx_do_backups_scope ON do_backups (scope, updated_at DESC);

CREATE TABLE IF NOT EXISTS do_backup_runs (
  id          TEXT PRIMARY KEY,
  trigger     TEXT NOT NULL,            
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  scopes      INTEGER NOT NULL DEFAULT 0,
  keys        INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0,
  ok          INTEGER NOT NULL DEFAULT 1,
  detail      TEXT
);

CREATE INDEX IF NOT EXISTS idx_do_backup_runs_time ON do_backup_runs (started_at DESC);
