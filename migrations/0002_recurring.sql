-- Reconstructed from the deployed schema for fresh databases. Existing production migration names are retained.

CREATE TABLE IF NOT EXISTS recurring_expenses (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  name TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  merchant TEXT,
  day_of_month INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_run TEXT 
, last_remind TEXT);

CREATE INDEX IF NOT EXISTS idx_recurring_scope ON recurring_expenses (scope, active);
