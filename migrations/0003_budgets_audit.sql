-- Reconstructed from the deployed schema for fresh databases. Existing production migration names are retained.

CREATE TABLE IF NOT EXISTS budgets (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,           
  category TEXT,                
  amount REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budgets_scope ON budgets (scope, kind);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  actor_username TEXT NOT NULL, 
  actor_display TEXT,           
  action TEXT NOT NULL,         
  target_id TEXT,               
  target_type TEXT,             
  summary TEXT NOT NULL,        
  detail TEXT,                  
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_scope ON audit_log (scope, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_settings (
  scope TEXT PRIMARY KEY,
  retention_days INTEGER NOT NULL DEFAULT 0  
);
