-- 한 번 누르면 끝나는 피드백.
--
-- 독자 기록(insights)은 메일로 받은 토큰이 있어야 쓸 수 있다. 그래서 92편에 0건이다.
-- 처음 들른 사람이 남길 수 있는 신호가 하나도 없었다는 뜻이다. 이 표는 그 앞단을 맡는다.
-- 이름도 이메일도 받지 않고, 같은 기기에서 같은 편에 한 번만 센다.

CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  vol        INTEGER NOT NULL,
  verdict    TEXT    NOT NULL,             -- helpful | meh
  ip_hash    TEXT    NOT NULL,             -- sha256(ip:SIGNING_KEY)[0:16] · 원본 IP 는 저장하지 않는다
  ua         TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(vol, ip_hash)                     -- 다시 누르면 갱신, 새로 쌓이지 않는다
);

CREATE INDEX IF NOT EXISTS idx_feedback_vol ON feedback(vol);
CREATE INDEX IF NOT EXISTS idx_feedback_ts  ON feedback(created_at);
