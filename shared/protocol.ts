// 서버(Worker)와 브라우저가 함께 쓰는 타입 정의.

export type FeedKind = "kis" | "mock";

export interface Quote {
  symbol: string;
  price: number;
  /** 전일 대비 (원) */
  change: number;
  /** 전일 대비율 (%) */
  rate: number;
  open: number;
  high: number;
  low: number;
  /** 누적 거래량 */
  volume: number;
  /** 수신 시각 (epoch ms) */
  at: number;
}

export interface TickPoint {
  /** epoch seconds */
  t: number;
  p: number;
}

export interface Candle {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ---- WebSocket 메시지 ----

export type ClientMessage =
  | { op: "sub"; symbol: string }
  | { op: "unsub"; symbol: string };

export type ServerMessage =
  | { type: "status"; market: "open" | "closed"; feed: FeedKind }
  | { type: "snapshot"; quote: Quote; ticks: TickPoint[]; live: boolean }
  /** 실시간 틱 (짧은 키로 트래픽 절감) */
  | { type: "tick"; s: string; p: number; c: number; r: number; o: number; h: number; l: number; v: number; t: number }
  | { type: "error"; message: string };

// ---- REST 응답 ----

export interface MeResponse {
  user: {
    email: string;
    nickname: string;
    mainSymbol: string | null;
    mainName: string | null;
    cash: number;
    isBankrupt: boolean;
    bankruptCount: number;
    salaryAvailable: boolean;
    salaryAmount: number;
    /** 메인 종목 변경 가능 시각 (epoch ms). null이면 지금 가능 */
    mainChangeAvailableAt: number | null;
    featuredBadge: PublicBadge | null;
    /** 가입 직후 공개 범위 설정을 마쳤는지 */
    profileSetupDone: boolean;
  };
  /** 아직 확인하지 않은 새 배지 */
  newBadges: OwnedBadge[];
  holding: { quantity: number; avgPrice: number } | null;
  quote: Quote | null;
  totals: {
    evaluation: number;
    total: number;
    profit: number;
    profitRate: number;
  };
  thresholds: { bankrupt: number; recovery: number };
  market: { open: boolean; feed: FeedKind };
  /** 이번 조회에서 파산 처리됐는지 */
  justBankrupted: boolean;
}

export interface StockInfo {
  symbol: string;
  name: string;
  market: string;
}

export interface OrderRow {
  id: number;
  symbol: string;
  side: "buy" | "sell" | "liquidation";
  quantity: number;
  price: number;
  amount: number;
  fee: number;
  tax: number;
  createdAt: number;
}

export type GameDifficulty = "easy" | "normal" | "hard";

export interface GameChoice {
  id: string;
  label: string;
}

export interface GameQuestion {
  gameId: string;
  difficulty: GameDifficulty;
  prompt: string;
  /** 쉬움만 공개 */
  stockName: string | null;
  /** 쉬움은 실제 날짜(YYYY-MM-DD), 그 외는 D1, D2 … */
  candles: Candle[];
  datesVisible: boolean;
  choices: GameChoice[];
  reward: number;
  /** 답안 제출 마감 (epoch ms) */
  expiresAt: number;
}

export interface GameStatus {
  isBankrupt: boolean;
  usedToday: number;
  usedThisMonth: number;
  dailyLimit: number;
  monthlyLimit: number;
  rewards: Record<GameDifficulty, number>;
  cash: number;
  recoveryTarget: number;
  /** 풀던 문제(제한 시간 이내) */
  current: GameQuestion | null;
}

export interface GameResult {
  correct: boolean;
  answer: string;
  answerLabel: string;
  reward: number;
  stockName: string;
  /** 정답 구간 설명 (예: 2026-08-01 → 2026-08-29) */
  period: string;
  /** 실제 등락률(%) */
  ratePct: number;
  /** 정답 구간 일봉 (문제 차트 뒤에 이어 붙인다) */
  reveal: Candle[];
  cash: number;
  recovered: boolean;
  recoveryTarget: number;
}

// ---- 배지 · 프로필 ----

export type BadgeTier = "common" | "rare" | "epic" | "legendary";

/** 다른 사람에게 보이는 배지 정보 (획득 조건은 포함하지 않는다) */
export interface PublicBadge {
  id: string;
  name: string;
  tier: BadgeTier;
  /** 조건을 드러내지 않는 한 줄 설명 */
  flavor: string;
}

/** 본인에게만 보이는 배지 정보 */
export interface OwnedBadge extends PublicBadge {
  condition: string;
  earnedAt: number;
}

export const PRIVACY_KEYS = ["badges", "mainSymbol", "bankruptCount", "totalAssets", "profitRate", "recentTrades"] as const;
export type PrivacyKey = (typeof PRIVACY_KEYS)[number];
/** true면 공개. 기본은 전부 비공개 */
export type Privacy = Record<PrivacyKey, boolean>;

export interface MyProfile {
  nickname: string;
  privacy: Privacy;
  featuredBadgeId: string | null;
  badges: OwnedBadge[];
  totalBadges: number;
  /** 닉네임 변경 가능 시각 (epoch ms). null이면 지금 가능 */
  nicknameChangeAvailableAt: number | null;
}

export interface PublicProfile {
  nickname: string;
  featuredBadge: PublicBadge | null;
  joinedAt: number;
  /** 비공개 항목은 null */
  badges: PublicBadge[] | null;
  mainStock: { symbol: string; name: string } | null;
  bankruptCount: number | null;
  totalAssets: number | null;
  profitRate: number | null;
  recentTrades: { name: string; side: "buy" | "sell" | "liquidation"; createdAt: number }[] | null;
}
