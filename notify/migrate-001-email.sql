-- v1 → v2: add the email channel (kakao columns become optional). Keeps existing rows.
-- wrangler d1 execute pli-notify-db --remote --file=migrate-001-email.sql

CREATE TABLE subscribers_v2 (
  id                TEXT PRIMARY KEY,
  channel           TEXT NOT NULL DEFAULT 'kakao',
  kakao_uid         TEXT UNIQUE,
  refresh_token_enc TEXT,
  email             TEXT UNIQUE,
  days              TEXT NOT NULL DEFAULT '1',
  slot              TEXT NOT NULL DEFAULT '08:00',
  cats              TEXT NOT NULL DEFAULT '',
  mode              TEXT NOT NULL DEFAULT 'random',
  status            TEXT NOT NULL DEFAULT 'pending',
  sent_vols         TEXT NOT NULL DEFAULT '',
  last_sent_date    TEXT,
  fail_count        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO subscribers_v2 (id, channel, kakao_uid, refresh_token_enc, days, slot, cats, mode, status, sent_vols, last_sent_date, fail_count, created_at, updated_at)
  SELECT id, 'kakao', kakao_uid, refresh_token_enc, days, slot, cats, mode, status, sent_vols, last_sent_date, fail_count, created_at, updated_at FROM subscribers;

DROP INDEX IF EXISTS idx_sub_due;
DROP TABLE subscribers;
ALTER TABLE subscribers_v2 RENAME TO subscribers;
CREATE INDEX IF NOT EXISTS idx_sub_due ON subscribers(status, slot);
