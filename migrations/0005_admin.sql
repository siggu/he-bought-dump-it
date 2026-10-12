-- 관리자 · 계정 정지

-- role: user | admin  (admin은 GitHub Actions의 '관리자 지정' 워크플로로만 부여)
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN suspended_at INTEGER;
ALTER TABLE users ADD COLUMN suspended_reason TEXT;

-- 관리자 조치 기록. action: nickname | suspend | unsuspend
CREATE TABLE admin_actions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id   INTEGER NOT NULL REFERENCES users(id),
  target_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action     TEXT    NOT NULL,
  detail     TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_actions_created ON admin_actions(created_at);
