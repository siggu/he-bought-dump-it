// 계좌 조회, 파산/복구 판정, 매매 체결.
//
// D1은 대화형 트랜잭션이 없으므로 batch(원자적 실행) + 조건부 UPDATE로 동시성을 처리한다.
// 첫 문장이 조건을 만족해 1행을 바꿨을 때만 이어지는 문장이 실행되도록 `changes() = 1`로 엮는다.

import type { MeResponse, Quote } from "../shared/protocol";
import { type Env, feedKind, marketOpen, priceHub } from "./env";
import { kst } from "./market";
import {
  MAIN_CHANGE_COOLDOWN_MS,
  MAX_ORDER_QUANTITY,
  SALARY_AMOUNT,
  bankruptThreshold,
  buySettlement,
  recoveryTarget,
  sellSettlement,
} from "./rules";

export interface UserRow {
  id: number;
  email: string;
  nickname: string;
  main_symbol: string | null;
  main_symbol_changed_at: number | null;
  cash: number;
  is_bankrupt: number;
  bankrupt_count: number;
  last_salary_month: string | null;
}

interface HoldingRow {
  quantity: number;
  avg_price: number;
}

export class UserError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
  }
}

export async function loadUser(env: Env, userId: number): Promise<UserRow> {
  const user = await env.DB.prepare(
    `SELECT id, email, nickname, main_symbol, main_symbol_changed_at, cash,
            is_bankrupt, bankrupt_count, last_salary_month
       FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<UserRow>();
  if (!user) throw new UserError("사용자를 찾을 수 없습니다.", 404);
  return user;
}

async function loadHolding(env: Env, userId: number, symbol: string): Promise<HoldingRow | null> {
  return env.DB.prepare("SELECT quantity, avg_price FROM holdings WHERE user_id = ? AND symbol = ?")
    .bind(userId, symbol)
    .first<HoldingRow>();
}

async function mainQuote(env: Env, symbol: string, maxAgeMs?: number): Promise<Quote | null> {
  try {
    return await priceHub(env).getQuote(symbol, maxAgeMs);
  } catch (err) {
    console.error("quote failed", symbol, err);
    return null;
  }
}

interface Evaluated {
  user: UserRow;
  holding: HoldingRow | null;
  quote: Quote | null;
  justBankrupted: boolean;
}

/**
 * 현재 시세로 계좌를 평가하고 필요하면 파산(강제 청산) 또는 복구 처리한다.
 * - 파산: 현금 + 평가액 < max(1주 가격, 10만)
 * - 복구: 파산 상태에서 현금 >= max(1주 가격, 100만)
 */
export async function evaluateAccount(env: Env, userId: number): Promise<Evaluated> {
  let user = await loadUser(env, userId);
  if (!user.main_symbol) return { user, holding: null, quote: null, justBankrupted: false };

  const symbol = user.main_symbol;
  const quote = await mainQuote(env, symbol);
  let holding = await loadHolding(env, userId, symbol);
  let justBankrupted = false;
  if (!quote) return { user, holding, quote, justBankrupted };

  if (!user.is_bankrupt) {
    const total = user.cash + (holding?.quantity ?? 0) * quote.price;
    if (total < bankruptThreshold(quote.price)) {
      justBankrupted = await liquidate(env, user, holding, quote);
    }
  } else if (user.cash >= recoveryTarget(quote.price)) {
    await env.DB.prepare("UPDATE users SET is_bankrupt = 0 WHERE id = ? AND is_bankrupt = 1 AND cash >= ?")
      .bind(userId, recoveryTarget(quote.price))
      .run();
  }

  if (justBankrupted || user.is_bankrupt) {
    user = await loadUser(env, userId);
    holding = await loadHolding(env, userId, symbol);
  }
  return { user, holding, quote, justBankrupted };
}

async function liquidate(env: Env, user: UserRow, holding: HoldingRow | null, quote: Quote): Promise<boolean> {
  const now = Date.now();
  const qty = holding?.quantity ?? 0;
  const sett = qty > 0 ? sellSettlement(quote.price, qty) : null;
  const stmts = [
    env.DB.prepare(
      `UPDATE users SET cash = cash + ?1, is_bankrupt = 1, bankrupt_count = bankrupt_count + 1
        WHERE id = ?2 AND is_bankrupt = 0 AND cash = ?3`,
    ).bind(sett?.total ?? 0, user.id, user.cash),
  ];
  if (sett) {
    stmts.push(
      env.DB.prepare(
        "DELETE FROM holdings WHERE user_id = ?1 AND symbol = ?2 AND quantity = ?3 AND changes() = 1",
      ).bind(user.id, quote.symbol, qty),
      env.DB.prepare(
        `INSERT INTO orders (user_id, symbol, side, quantity, price, amount, fee, tax, created_at)
         SELECT ?1, ?2, 'liquidation', ?3, ?4, ?5, ?6, ?7, ?8 WHERE changes() = 1`,
      ).bind(user.id, quote.symbol, qty, quote.price, sett.amount, sett.fee, sett.tax, now),
    );
  }
  const results = await env.DB.batch(stmts);
  return results[0].meta.changes === 1;
}

export async function buildMe(env: Env, userId: number): Promise<MeResponse> {
  const { user, holding, quote, justBankrupted } = await evaluateAccount(env, userId);
  const main = user.main_symbol
    ? await env.DB.prepare("SELECT name FROM stocks WHERE symbol = ?").bind(user.main_symbol).first<{ name: string }>()
    : null;

  const qty = holding?.quantity ?? 0;
  const avg = holding?.avg_price ?? 0;
  const price = quote?.price ?? avg;
  const evaluation = qty * price;
  const cost = qty * avg;
  const cooldownEnd = (user.main_symbol_changed_at ?? 0) + MAIN_CHANGE_COOLDOWN_MS;

  return {
    user: {
      email: user.email,
      nickname: user.nickname,
      mainSymbol: user.main_symbol,
      mainName: main?.name ?? null,
      cash: user.cash,
      isBankrupt: user.is_bankrupt === 1,
      bankruptCount: user.bankrupt_count,
      salaryAvailable: user.last_salary_month !== kst().month,
      salaryAmount: SALARY_AMOUNT,
      mainChangeAvailableAt: user.main_symbol && cooldownEnd > Date.now() ? cooldownEnd : null,
    },
    holding: qty > 0 ? { quantity: qty, avgPrice: avg } : null,
    quote,
    totals: {
      evaluation,
      total: user.cash + evaluation,
      profit: evaluation - cost,
      profitRate: cost > 0 ? Math.round(((evaluation - cost) / cost) * 10_000) / 100 : 0,
    },
    thresholds: {
      bankrupt: bankruptThreshold(price),
      recovery: recoveryTarget(price),
    },
    market: { open: marketOpen(env), feed: feedKind(env) },
    justBankrupted,
  };
}

export async function setMainSymbol(env: Env, userId: number, symbol: string): Promise<void> {
  const stock = await env.DB.prepare("SELECT symbol FROM stocks WHERE symbol = ?").bind(symbol).first();
  if (!stock) throw new UserError("존재하지 않는 종목입니다.", 404);
  const user = await loadUser(env, userId);
  if (user.main_symbol === symbol) return;

  const now = Date.now();
  if (user.main_symbol) {
    const holding = await loadHolding(env, userId, user.main_symbol);
    if ((holding?.quantity ?? 0) > 0) {
      throw new UserError("메인 종목을 바꾸려면 보유 주식을 모두 매도해야 합니다.", 409);
    }
    if ((user.main_symbol_changed_at ?? 0) + MAIN_CHANGE_COOLDOWN_MS > now) {
      throw new UserError("메인 종목은 7일에 한 번만 바꿀 수 있습니다.", 409);
    }
  }
  const res = await env.DB.prepare(
    `UPDATE users SET main_symbol = ?1, main_symbol_changed_at = ?2
      WHERE id = ?3 AND main_symbol IS ?4
        AND NOT EXISTS (SELECT 1 FROM holdings WHERE user_id = ?3 AND quantity > 0)`,
  )
    .bind(symbol, now, userId, user.main_symbol)
    .run();
  if (res.meta.changes !== 1) throw new UserError("다시 시도해 주세요.", 409);
}

export async function placeOrder(
  env: Env,
  userId: number,
  side: "buy" | "sell",
  quantity: number,
): Promise<{ price: number; quantity: number; total: number }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) {
    throw new UserError("주문 수량이 올바르지 않습니다.");
  }
  if (!marketOpen(env)) {
    throw new UserError("장 운영 시간(평일 09:00~15:30)에만 주문할 수 있습니다.", 409);
  }
  const { user } = await evaluateAccount(env, userId);
  if (!user.main_symbol) throw new UserError("먼저 메인 종목을 선택해 주세요.", 409);
  if (user.is_bankrupt) throw new UserError("파산 상태에서는 매매할 수 없습니다. 미니게임이나 월급으로 재기하세요!", 403);

  const symbol = user.main_symbol;
  // 체결가는 서버가 가진 최신 시세로 정한다(클라이언트 가격은 받지 않는다).
  const quote = await mainQuote(env, symbol, 5_000);
  if (!quote) throw new UserError("시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 409);
  const now = Date.now();

  if (side === "buy") {
    const s = buySettlement(quote.price, quantity);
    const results = await env.DB.batch([
      env.DB.prepare(
        `UPDATE users SET cash = cash - ?1
          WHERE id = ?2 AND is_bankrupt = 0 AND main_symbol = ?3 AND cash >= ?1`,
      ).bind(s.total, userId, symbol),
      env.DB.prepare(
        `INSERT INTO holdings (user_id, symbol, quantity, avg_price)
         SELECT ?1, ?2, ?3, ?4 WHERE changes() = 1
         ON CONFLICT(user_id, symbol) DO UPDATE SET
           avg_price = (holdings.quantity * holdings.avg_price + excluded.quantity * excluded.avg_price)
                       / (holdings.quantity + excluded.quantity),
           quantity  = holdings.quantity + excluded.quantity`,
      ).bind(userId, symbol, quantity, quote.price),
      env.DB.prepare(
        `INSERT INTO orders (user_id, symbol, side, quantity, price, amount, fee, tax, created_at)
         SELECT ?1, ?2, 'buy', ?3, ?4, ?5, ?6, 0, ?7 WHERE changes() = 1`,
      ).bind(userId, symbol, quantity, quote.price, s.amount, s.fee, now),
    ]);
    if (results[0].meta.changes !== 1) throw new UserError("잔액이 부족합니다.", 409);
    return { price: quote.price, quantity, total: s.total };
  }

  const s = sellSettlement(quote.price, quantity);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE holdings SET quantity = quantity - ?1
        WHERE user_id = ?2 AND symbol = ?3 AND quantity >= ?1
          AND EXISTS (SELECT 1 FROM users WHERE id = ?2 AND is_bankrupt = 0)`,
    ).bind(quantity, userId, symbol),
    env.DB.prepare("UPDATE users SET cash = cash + ?1 WHERE id = ?2 AND changes() = 1").bind(s.total, userId),
    env.DB.prepare(
      `INSERT INTO orders (user_id, symbol, side, quantity, price, amount, fee, tax, created_at)
       SELECT ?1, ?2, 'sell', ?3, ?4, ?5, ?6, ?7, ?8 WHERE changes() = 1`,
    ).bind(userId, symbol, quantity, quote.price, s.amount, s.fee, s.tax, now),
    env.DB.prepare("DELETE FROM holdings WHERE user_id = ? AND quantity = 0").bind(userId),
  ]);
  if (results[0].meta.changes !== 1) throw new UserError("보유 수량이 부족합니다.", 409);
  return { price: quote.price, quantity, total: s.total };
}

/** 월급: KST 기준 한 달에 한 번 */
export async function claimSalary(env: Env, userId: number): Promise<void> {
  const month = kst().month;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET cash = cash + ?1, last_salary_month = ?2
        WHERE id = ?3 AND (last_salary_month IS NULL OR last_salary_month <> ?2)`,
    ).bind(SALARY_AMOUNT, month, userId),
    env.DB.prepare(
      "INSERT INTO cash_events (user_id, type, amount, created_at) SELECT ?1, 'salary', ?2, ?3 WHERE changes() = 1",
    ).bind(userId, SALARY_AMOUNT, Date.now()),
  ]);
  if (results[0].meta.changes !== 1) throw new UserError("이번 달 월급은 이미 받았습니다.", 409);
}
