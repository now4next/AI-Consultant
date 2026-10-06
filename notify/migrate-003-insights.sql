-- v4 → v5: 독자 인사이트. 글 아래에 구독자가 남기는 기록. Idempotent.
-- wrangler d1 execute pli-notify-db --remote --file=migrate-003-insights.sql
--
-- 표시에 쓰는 것은 본인이 정한 별명이다. 실명과 전화번호는 여전히 받지 않는다.
-- 별명은 구독자에 한 번 붙고 모든 편에서 같이 쓰인다. 바꾸면 지난 기록의 표기도 함께 바뀐다.

-- 별명은 subscribers 를 건드리지 않고 따로 둔다. 글을 쓰지 않는 구독자에게는 행이 생기지 않아,
-- "이메일 주소와 설정만 저장한다"는 약속이 그 사람에게는 글자 그대로 유지된다.
-- ALTER TABLE 과 달리 이 방식은 여러 번 돌려도 안전하다.
CREATE TABLE IF NOT EXISTS subscriber_profile (
  subscriber_id TEXT PRIMARY KEY,
  nickname      TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS insights (
  id            TEXT PRIMARY KEY,
  vol           INTEGER NOT NULL,
  subscriber_id TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'public',   -- public | hidden (관리자가 내림) | removed (본인이 지움)
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vol, subscriber_id)                      -- 한 편에 하나. 다시 쓰면 고쳐진다
);

CREATE INDEX IF NOT EXISTS idx_insights_vol ON insights(vol, status, created_at);
CREATE INDEX IF NOT EXISTS idx_insights_sub ON insights(subscriber_id);
