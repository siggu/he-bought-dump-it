// 게임 규칙 상수와 순수 계산 함수. (DB/네트워크 의존성 없음 → 단위 테스트 대상)

import type { GameChoice, GameDifficulty } from "../shared/protocol";

export const INITIAL_CASH = 10_000_000;
export const SALARY_AMOUNT = 1_000_000;
/**
 * 파산 기준: 총자산(현금 + 보유 주식 전체 평가액)이 이 금액 "미만"이면 파산.
 * 파산하면 보유 주식을 모두 현재가로 강제 매도하고 매매를 잠근다.
 */
export const BANKRUPT_FLOOR = 100_000;
/** 재기 기준: 파산 상태에서 현금이 이 금액 "이상"이 되면 매매 재개 */
export const RECOVERY_CASH = 1_000_000;
/** 매수로 동시에 보유할 수 있는 최대 종목 수 */
export const MAX_HOLDINGS = 20;

/** 매매 수수료 0.015% */
export const FEE_RATE = 0.00015;
/** 증권거래세(매도 시) 0.20% */
export const SELL_TAX_RATE = 0.002;
export const MAX_ORDER_QUANTITY = 1_000_000;

/** 정답 보상: 어려울수록 맞히기 어렵지만 보상이 크다 (하이리스크 하이리턴) */
export const GAME_REWARDS: Record<GameDifficulty, number> = {
  easy: 100_000,
  normal: 300_000,
  hard: 600_000,
};
/** 문제를 받는 순간 1회 차감 (KST 기준) */
export const GAME_DAILY_LIMIT = 3;
export const GAME_MONTHLY_LIMIT = 10;
export const GAME_ANSWER_TIMEOUT_MS = 120_000;
/** 문제로 보여줄 일봉 수 */
export const GAME_WINDOW = 20;
/** 쉬움: 맞힐 기간(거래일) */
export const EASY_PERIOD = 20;
/** 보통: 몇 거래일 뒤 종가를 맞히는지 */
export const NORMAL_HORIZON = 5;

export const GAME_CHOICES: Record<GameDifficulty, GameChoice[]> = {
  easy: [
    { id: "up", label: "올랐다 ▲" },
    { id: "down", label: "내렸다 ▼" },
  ],
  normal: [
    { id: "big_up", label: "+3% 이상 상승" },
    { id: "flat", label: "-3% ~ +3% 사이" },
    { id: "big_down", label: "-3% 이하 하락" },
  ],
  hard: [
    { id: "up2", label: "+2% 이상" },
    { id: "up", label: "0% ~ +2%" },
    { id: "down", label: "-2% ~ 0% (보합 포함)" },
    { id: "down2", label: "-2% 이하" },
  ],
};

/** 등락률(%)을 난이도별 정답 선택지로 분류한다. */
export function classifyMove(difficulty: GameDifficulty, ratePct: number): string {
  switch (difficulty) {
    case "easy":
      return ratePct > 0 ? "up" : "down";
    case "normal":
      return ratePct >= 3 ? "big_up" : ratePct <= -3 ? "big_down" : "flat";
    case "hard":
      return ratePct >= 2 ? "up2" : ratePct > 0 ? "up" : ratePct > -2 ? "down" : "down2";
  }
}

export function isBankruptTotal(totalAssets: number): boolean {
  return totalAssets < BANKRUPT_FLOOR;
}

export function canRecover(cash: number): boolean {
  return cash >= RECOVERY_CASH;
}

// ---- 유저 간 상호작용 ----

/** 받은 요청이 자동으로 만료되기까지 */
export const INTERACTION_TTL_MS = 24 * 60 * 60 * 1000;
/** 종류별로 하루에 보낼 수 있는 요청 수 */
export const INTERACTION_DAILY_LIMIT = 1;
/** 동시에 진행할 수 있는 맞짱 수 */
export const DUEL_MAX_ACTIVE = 3;
export const DUEL_DAYS = 7;
export const STAKE_MIN = 100_000;
export const STAKE_MAX = 1_000_000;

export interface Settlement {
  amount: number;
  fee: number;
  tax: number;
  /** 매수: 차감될 총액 / 매도: 입금될 총액 */
  total: number;
}

export function buySettlement(price: number, quantity: number): Settlement {
  const amount = price * quantity;
  const fee = Math.floor(amount * FEE_RATE);
  return { amount, fee, tax: 0, total: amount + fee };
}

export function sellSettlement(price: number, quantity: number): Settlement {
  const amount = price * quantity;
  const fee = Math.floor(amount * FEE_RATE);
  const tax = Math.floor(amount * SELL_TAX_RATE);
  return { amount, fee, tax, total: amount - fee - tax };
}

/** 현금으로 살 수 있는 최대 수량 (수수료 포함) */
export function maxBuyQuantity(cash: number, price: number): number {
  if (price <= 0) return 0;
  let q = Math.floor(cash / (price * (1 + FEE_RATE)));
  while (q > 0 && buySettlement(price, q).total > cash) q--;
  return Math.min(q, MAX_ORDER_QUANTITY);
}
