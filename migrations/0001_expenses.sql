-- 交易记录表：scope 隔离个人（user_xxx）与家庭（family_xxx）数据
CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  amount REAL NOT NULL,
  category TEXT NOT NULL,
  merchant TEXT,
  description TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'expense',
  by TEXT,
  by_id TEXT,
  parsed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_expenses_scope_date ON expenses (scope, date);
