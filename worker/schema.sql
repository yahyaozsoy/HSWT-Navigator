-- Menu API database (Cloudflare D1, SQLite).
-- Apply: npx wrangler d1 execute hswt-menus --remote --file=worker/schema.sql

-- One row per canteen, language and day. A day is never deleted by the sync, so the history stays
-- even after the source drops past weeks. `source` is where the dishes came from; rows entered by
-- hand ('manual') are never overwritten by the sync.
CREATE TABLE IF NOT EXISTS menu_day (
  canteen    TEXT NOT NULL,
  lang       TEXT NOT NULL CHECK (lang IN ('de', 'en')),
  date       TEXT NOT NULL,          -- YYYY-MM-DD
  dishes     TEXT NOT NULL,          -- JSON array of dishes in eat-api format
  source     TEXT NOT NULL,          -- 'eat-api' | 'manual'
  updated_at TEXT NOT NULL,          -- ISO timestamp of the last change
  PRIMARY KEY (canteen, lang, date)
);

-- What each sync did, for troubleshooting (GET /api/menus/status shows the latest runs).
CREATE TABLE IF NOT EXISTS sync_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at     TEXT NOT NULL,
  canteen    TEXT NOT NULL,
  lang       TEXT NOT NULL,
  week       TEXT NOT NULL,          -- YYYY-Www
  status     TEXT NOT NULL,          -- 'ok' | 'missing' | 'error'
  days       INTEGER NOT NULL DEFAULT 0,
  error      TEXT
);
CREATE INDEX IF NOT EXISTS sync_log_ran_at ON sync_log (ran_at);
