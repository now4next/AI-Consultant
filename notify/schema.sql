-- pli-notify · D1 schema
-- wrangler d1 execute pli-notify-db --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS subscribers (
  id                TEXT PRIMARY KEY,            -- random id (also the manage-token subject)
  kakao_uid         TEXT UNIQUE NOT NULL,        -- 카카오 회원번호
  refresh_token_enc TEXT NOT NULL,               -- AES-GCM(SIGNING_KEY) · never stored in clear
  days              TEXT NOT NULL DEFAULT '1',   -- '1,3,5'  (0=일 … 6=토)
  slot              TEXT NOT NULL DEFAULT '08:00', -- 'HH:00' | 'HH:30', 07:00–22:00
  cats              TEXT NOT NULL DEFAULT '',    -- '' = 전체, 또는 '전략,사람'
  mode              TEXT NOT NULL DEFAULT 'random', -- random | latest
  status            TEXT NOT NULL DEFAULT 'pending', -- pending | active | paused | exhausted
  sent_vols         TEXT NOT NULL DEFAULT '',    -- '42,17,8'
  last_sent_date    TEXT,                        -- 'YYYY-MM-DD' (KST) · once-per-day lock
  fail_count        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sub_due ON subscribers(status, slot);

CREATE TABLE IF NOT EXISTS sends (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  subscriber_id TEXT NOT NULL,
  vol           INTEGER,
  kind          TEXT NOT NULL DEFAULT 'issue',   -- issue | welcome | exhausted
  ok            INTEGER NOT NULL DEFAULT 1,
  error         TEXT,
  sent_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sends_sub ON sends(subscriber_id, sent_at);
