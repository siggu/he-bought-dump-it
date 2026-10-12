-- 금액은 모두 정수(원/덤프코인 단위)로 저장한다.

CREATE TABLE users (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  email                  TEXT    NOT NULL UNIQUE,
  nickname               TEXT    NOT NULL UNIQUE,
  password_hash          TEXT    NOT NULL,
  main_symbol            TEXT,
  main_symbol_changed_at INTEGER,
  cash                   INTEGER NOT NULL,
  is_bankrupt            INTEGER NOT NULL DEFAULT 0,
  bankrupt_count         INTEGER NOT NULL DEFAULT 0,
  last_salary_month      TEXT,
  created_at             INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  key      TEXT    PRIMARY KEY,
  count    INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);

CREATE TABLE stocks (
  symbol TEXT PRIMARY KEY,
  name   TEXT NOT NULL,
  market TEXT NOT NULL
);
CREATE INDEX idx_stocks_name ON stocks(name);

CREATE TABLE holdings (
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol    TEXT    NOT NULL,
  quantity  INTEGER NOT NULL,
  avg_price REAL    NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

-- 시장가 주문은 즉시 체결되므로 주문 = 체결 내역이다.
-- side: buy | sell | liquidation(파산 강제청산)
CREATE TABLE orders (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol     TEXT    NOT NULL,
  side       TEXT    NOT NULL,
  quantity   INTEGER NOT NULL,
  price      INTEGER NOT NULL,
  amount     INTEGER NOT NULL,
  fee        INTEGER NOT NULL,
  tax        INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_orders_user ON orders(user_id, id);

-- 매매 외 재화 변동 내역. type: signup | salary | game
CREATE TABLE cash_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  amount     INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_cash_events_user ON cash_events(user_id, id);

-- 파산자 전용 미니게임. 문제를 받는 순간 1행이 생기며, 이 행 수로 일/월 횟수 제한을 센다.
-- difficulty: easy | normal | hard
CREATE TABLE game_sessions (
  id          TEXT    PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  difficulty  TEXT    NOT NULL,
  symbol      TEXT    NOT NULL,
  question    TEXT    NOT NULL,
  answer      TEXT    NOT NULL,
  reveal      TEXT    NOT NULL,
  guess       TEXT,
  correct     INTEGER,
  reward      INTEGER,
  created_at  INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX idx_game_sessions_user ON game_sessions(user_id, created_at);
