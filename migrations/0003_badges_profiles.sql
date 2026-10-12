-- 배지·프로필·공개 범위

-- privacy: 공개 항목 JSON. 키가 없거나 false면 비공개 (기본: 전부 비공개)
ALTER TABLE users ADD COLUMN privacy TEXT NOT NULL DEFAULT '{}';
-- 닉네임 옆에 표시할 대표 배지
ALTER TABLE users ADD COLUMN featured_badge TEXT;
-- 마지막 닉네임 변경 시각 (가입 시 정한 닉네임은 변경으로 치지 않는다)
ALTER TABLE users ADD COLUMN nickname_changed_at INTEGER;
-- 가입 직후 공개 범위 설정을 마쳤는지
ALTER TABLE users ADD COLUMN profile_setup_done INTEGER NOT NULL DEFAULT 0;

-- 배지 판정용: 체결 당시의 당일 고가·저가·등락률
ALTER TABLE orders ADD COLUMN day_high INTEGER;
ALTER TABLE orders ADD COLUMN day_low INTEGER;
ALTER TABLE orders ADD COLUMN day_rate REAL;

CREATE TABLE user_badges (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_id  TEXT    NOT NULL,
  earned_at INTEGER NOT NULL,
  -- 획득 알림을 확인했는지
  seen      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, badge_id)
);

-- 배지 판정용 활동 기록. type: bankrupt | recover | main_change
-- recover의 value는 재기 시점의 현금
CREATE TABLE user_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  value      INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_user_events_user ON user_events(user_id, type, created_at);
