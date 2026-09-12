-- v2 → v3: admin dashboard tables (access/behaviour log, cron runs, admin state). Idempotent.
-- wrangler d1 execute pli-notify-db --remote --file=migrate-002-admin.sql

CREATE TABLE IF NOT EXISTS access_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            TEXT NOT NULL DEFAULT (datetime('now')),
  event         TEXT NOT NULL,        -- kakao_start, kakao_callback, email_start, settings_view, settings_save, pause, resume,
                                      -- reset, unsubscribe, test, admin_login_ok, admin_login_fail, admin_action
  subscriber_id TEXT,
  path          TEXT,
  ip_hash       TEXT,                 -- sha256(ip:SIGNING_KEY)[0:16] · the raw IP is never stored
  country       TEXT,
  ua            TEXT,
  meta          TEXT                  -- JSON
);
CREATE INDEX IF NOT EXISTS idx_access_ts ON access_log(ts);
CREATE INDEX IF NOT EXISTS idx_access_sub ON access_log(subscriber_id);

CREATE TABLE IF NOT EXISTS cron_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  slot        TEXT,
  due         INTEGER NOT NULL DEFAULT 0,
  sent        INTEGER NOT NULL DEFAULT 0,
  exhausted   INTEGER NOT NULL DEFAULT 0,
  errors      INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS admin_state (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
