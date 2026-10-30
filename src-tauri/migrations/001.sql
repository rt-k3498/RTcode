PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS trust (canonical_path TEXT PRIMARY KEY, trusted INTEGER NOT NULL DEFAULT 0);
PRAGMA user_version = 1;
