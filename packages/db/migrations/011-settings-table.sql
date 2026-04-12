-- Settings key-value store
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Line connections for X-Link
CREATE TABLE IF NOT EXISTS line_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  worker_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
