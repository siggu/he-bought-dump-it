-- 여러 종목 매매 + 유저 간 상호작용

-- 상호작용 허용 설정 JSON (allowSwap, allowRaid, allowDuel). 기본: 전부 거부
ALTER TABLE users ADD COLUMN interaction_settings TEXT NOT NULL DEFAULT '{}';
-- 파산 강제 청산 배치를 식별하는 값 (같은 배치 안에서만 후속 문장이 실행되도록)
ALTER TABLE users ADD COLUMN liquidation_id TEXT;

-- D1 batch 안에서 "직전 문장이 정확히 1행을 바꿨는지" 확인하는 용도.
-- UPDATE tx_guard SET ok = changes() 가 0을 쓰려고 하면 CHECK 위반으로 batch 전체가 롤백된다.
CREATE TABLE tx_guard (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  ok INTEGER NOT NULL CHECK (ok = 1)
);
INSERT INTO tx_guard (id, ok) VALUES (1, 1);

-- 유저 간 상호작용. type: swap(블라인드 박스 교환) | raid(기습 털기) | duel(1:1 수익률 맞짱)
-- status: pending(상대 응답 대기) | active(맞짱 진행 중) | settled | declined | cancelled | expired
CREATE TABLE interactions (
  id         TEXT    PRIMARY KEY,
  type       TEXT    NOT NULL,
  from_user  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL,
  stake      INTEGER NOT NULL DEFAULT 0,
  payload    TEXT    NOT NULL DEFAULT '{}',
  result     TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_interactions_from ON interactions(from_user, created_at);
CREATE INDEX idx_interactions_to ON interactions(to_user, status);
