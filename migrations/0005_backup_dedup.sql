-- Reconstructed from the deployed schema for fresh databases. Existing production migration names are retained.

CREATE TABLE IF NOT EXISTS restore_points (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  reason TEXT NOT NULL,                  
  payload TEXT NOT NULL,                 
  counts TEXT,                           
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_restore_points_scope ON restore_points (scope, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expenses_idem ON expenses (scope, idempotency_key) WHERE idempotency_key IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_scope_deleted ON expenses (scope, deleted_at, date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_dedup ON expenses (scope, dedup_hash, date) WHERE deleted_at IS NULL;
