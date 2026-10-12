// 계좌 조회, 파산/재기 판정, 매매 체결.
//
// D1은 대화형 트랜잭션이 없으므로 batch(원자적 실행) + 조건부 UPDATE로 동시성을 처리한다.
// 첫 문장이 조건을 만족해 1행을 바꿨을 때만 이어지는 문장이 실행되도록 `changes() = 1`로 엮는다.

import type { HoldingView, MeResponse, Quote } from "../shared/protocol";
import {
  checkAccountBadges,
  checkOrderBadges,
  onBankrupt,
  onRecover,
  onSalary,
  publicBadge,
  unseenBadges,
} from "./badges";
import { type Env, feedKind, marketOpen, priceHub } from "./env";
import { kst } from "./market";
import {
  BANKRUPT_FLOOR,
  MAX_HOLDINGS,
  MAX_ORDER_QUANTITY,
  RECOVERY_CASH,
  SALARY_AMOUNT,
  buySettlement,
  canRecover,
  isBankruptTotal,
  sellSettlement,
} from "./rules";

export interface UserRow {
  id: number;
  email: string;
  nickname: string;
  cash: number;
  is_bankrupt: number;
  bankrupt_count: number;
  last_salary_month: string | null;
  featured_badge: string | null;
  profile_setup_done: number;
  nickname_changed_at: number | null;
  privacy: string;
  interaction_settings: string;
  role: string;
  created_at: number;
}

export interface HoldingRow {
  symbol: string;
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
    `SELECT id, email, nickname, cash, is_bankrupt, bankrupt_count, last_salary_month, featured_badge,
            profile_setup_done, nickname_changed_at, privacy, interaction_settings, role, created_at
       FROM users WHERE id = ?`,
  )
    .bind(userId)
    .first<UserRow>();
  if (!user) throw new UserError("사용자를 찾을 수 없습니다.", 404);
  return user;
}

export async function loadHoldings(env: Env, userId: number): Promise<HoldingRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT symbol, quantity, avg_price FROM holdings WHERE user_id = ? AND quantity > 0 ORDER BY symbol",
  )
    .bind(userId)
    .all<HoldingRow>();
  return results;
}

export async function loadHolding(env: Env, userId: number, symbol: string): Promise<HoldingRow | null> {
  return env.DB.prepare("SELECT symbol, quantity, avg_price FROM holdings WHERE user_id = ? AND symbol = ?")
    .bind(userId, symbol)
    .first<HoldingRow>();
}

/**
 * 여러 종목 시세 (서버 캐시 공유, 기본 60초).
 * fresh=true면 오래된 캐시를 쓰지 않고 maxAgeMs 이내 시세를 기다려 받는다(주문 체결용).
 */
export async function quotesFor(
  env: Env,
  symbols: string[],
  maxAgeMs?: number,
  fresh = false,
): Promise<Map<string, Quote>> {
  if (symbols.length === 0) return new Map();
  try {
    return new Map(Object.entries(await priceHub(env).getQuotes(symbols, maxAgeMs, !fresh)));
  } catch (err) {
    console.error("quotes failed", err);
    return new Map();
  }
}

export function holdingsValue(holdings: HoldingRow[], quotes: Map<string, Quote>): number {
  return holdings.reduce((sum, h) => sum + h.quantity * (quotes.get(h.symbol)?.price ?? h.avg_price), 0);
}

interface Evaluated {
  user: UserRow;
  holdings: HoldingRow[];
  quotes: Map<string, Quote>;
  justBankrupted: boolean;
}

/**
 * 현재 시세로 계좌를 평가하고 필요하면 파산(강제 청산) 또는 재기 처리한다.
 * - 파산: 현금 + 보유 주식 전체 평가액 < 10만원
 * - 재기: 파산 상태에서 현금 >= 100만원
 * 보유 종목 중 하나라도 시세를 못 불러오면 파산 판정을 건너뛴다(잘못된 파산 방지).
 */
export async function evaluateAccount(env: Env, userId: number): Promise<Evaluated> {
  let user = await loadUser(env, userId);
  let holdings = await loadHoldings(env, userId);
  const quotes = await quotesFor(env, holdings.map((h) => h.symbol));
  let justBankrupted = false;

  if (!user.is_bankrupt) {
    const complete = holdings.every((h) => quotes.has(h.symbol));
    if (complete && isBankruptTotal(user.cash + holdingsValue(holdings, quotes))) {
      justBankrupted = await liquidate(env, user, holdings, quotes);
    }
  } else if (canRecover(user.cash)) {
    const res = await env.DB.prepare("UPDATE users SET is_bankrupt = 0 WHERE id = ? AND is_bankrupt = 1 AND cash >= ?")
      .bind(userId, RECOVERY_CASH)
      .run();
    if (res.meta.changes === 1) {
      await onRecover(env, userId, user.cash, Date.now());
      user = await loadUser(env, userId);
    }
  }

  if (justBankrupted) {
    user = await loadUser(env, userId);
    holdings = await loadHoldings(env, userId);
  }
  return { user, holdings, quotes, justBankrupted };
}

/** 보유 주식을 모두 현재가로 강제 매도하고 매매를 잠근다. */
async function liquidate(env: Env, user: UserRow, holdings: HoldingRow[], quotes: Map<string, Quote>): Promise<boolean> {
  const now = Date.now();
  const nonce = crypto.randomUUID();
  const sales = holdings.map((h) => ({ h, price: quotes.get(h.symbol)!.price, s: sellSettlement(quotes.get(h.symbol)!.price, h.quantity) }));
  const proceeds = sales.reduce((sum, x) => sum + x.s.total, 0);
  // 다른 요청이 그사이 현금이나 보유 주식을 바꿨으면 실행하지 않는다.
  const signature = holdings.map((h) => `${h.symbol}:${h.quantity}`).join(",");
  const inThisBatch = "(SELECT liquidation_id FROM users WHERE id = ?1) = ?2";

  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE users SET cash = cash + ?3, is_bankrupt = 1, bankrupt_count = bankrupt_count + 1, liquidation_id = ?2
        WHERE id = ?1 AND is_bankrupt = 0 AND cash = ?4
          AND COALESCE((SELECT group_concat(symbol || ':' || quantity, ',')
                          FROM (SELECT symbol, quantity FROM holdings
                                 WHERE user_id = ?1 AND quantity > 0 ORDER BY symbol)), '') = ?5`,
    ).bind(user.id, nonce, proceeds, user.cash, signature),
    ...sales.map(({ h, price, s }) =>
      env.DB.prepare(
        `INSERT INTO orders (user_id, symbol, side, quantity, price, amount, fee, tax, created_at)
         SELECT ?1, ?3, 'liquidation', ?4, ?5, ?6, ?7, ?8, ?9 WHERE ${inThisBatch}`,
      ).bind(user.id, nonce, h.symbol, h.quantity, price, s.amount, s.fee, s.tax, now),
    ),
    env.DB.prepare(`DELETE FROM holdings WHERE user_id = ?1 AND ${inThisBatch}`).bind(user.id, nonce),
  ]);
  const bankrupted = results[0].meta.changes === 1;
  if (bankrupted) await onBankrupt(env, user.id, now);
  return bankrupted;
}

export async function stockNames(env: Env, symbols: string[]): Promise<Map<string, string>> {
  if (symbols.length === 0) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT symbol, name FROM stocks WHERE symbol IN (${symbols.map(() => "?").join(",")})`,
  )
    .bind(...symbols)
    .all<{ symbol: string; name: string }>();
  return new Map(results.map((r) => [r.symbol, r.name]));
}

export function toHoldingViews(holdings: HoldingRow[], quotes: Map<string, Quote>, names: Map<string, string>): HoldingView[] {
  return holdings.map((h) => {
    const q = quotes.get(h.symbol);
    const price = q?.price ?? null;
    const evaluation = h.quantity * (price ?? h.avg_price);
    const cost = h.quantity * h.avg_price;
    return {
      symbol: h.symbol,
      name: names.get(h.symbol) ?? h.symbol,
      quantity: h.quantity,
      avgPrice: h.avg_price,
      price,
      rate: q?.rate ?? null,
      evaluation,
      profit: evaluation - cost,
      profitRate: cost > 0 ? Math.round(((evaluation - cost) / cost) * 10_000) / 100 : 0,
    };
  });
}

export async function buildMe(env: Env, userId: number): Promise<MeResponse> {
  const { user, holdings, quotes, justBankrupted } = await evaluateAccount(env, userId);
  await checkAccountBadges(env, userId, { cash: user.cash, isBankrupt: user.is_bankrupt === 1, holdings, quotes, now: Date.now() });

  const views = toHoldingViews(holdings, quotes, await stockNames(env, holdings.map((h) => h.symbol)));
  const evaluation = views.reduce((s, v) => s + v.evaluation, 0);
  const cost = holdings.reduce((s, h) => s + h.quantity * h.avg_price, 0);

  return {
    user: {
      email: user.email,
      nickname: user.nickname,
      cash: user.cash,
      isBankrupt: user.is_bankrupt === 1,
      bankruptCount: user.bankrupt_count,
      salaryAvailable: user.last_salary_month !== kst().month,
      salaryAmount: SALARY_AMOUNT,
      featuredBadge: user.featured_badge ? publicBadge(user.featured_badge) : null,
      profileSetupDone: user.profile_setup_done === 1,
      isAdmin: user.role === "admin",
    },
    holdings: views,
    favorites: (
      await env.DB.prepare("SELECT symbol FROM favorites WHERE user_id = ? ORDER BY created_at").bind(userId).all<{ symbol: string }>()
    ).results.map((r) => r.symbol),
    totals: {
      evaluation,
      total: user.cash + evaluation,
      profit: evaluation - cost,
      profitRate: cost > 0 ? Math.round(((evaluation - cost) / cost) * 10_000) / 100 : 0,
    },
    thresholds: { bankrupt: BANKRUPT_FLOOR, recovery: RECOVERY_CASH },
    market: { open: marketOpen(env), feed: feedKind(env) },
    justBankrupted,
    newBadges: await unseenBadges(env, userId),
  };
}

export async function placeOrder(
  env: Env,
  userId: number,
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
): Promise<{ price: number; quantity: number; total: number }> {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_ORDER_QUANTITY) {
    throw new UserError("주문 수량이 올바르지 않습니다.");
  }
  const stock = await env.DB.prepare("SELECT 1 FROM stocks WHERE symbol = ?").bind(symbol).first();
  if (!stock) throw new UserError("존재하지 않는 종목입니다.", 404);
  if (!marketOpen(env)) {
    throw new UserError("장 운영 시간(평일 09:00~15:30)에만 주문할 수 있습니다.", 409);
  }
  const { user, holdings } = await evaluateAccount(env, userId);
  if (user.is_bankrupt) throw new UserError("파산 상태에서는 매매할 수 없습니다. 미니게임이나 월급으로 재기하세요!", 403);

  const before = holdings.find((h) => h.symbol === symbol) ?? null;
  if (side === "buy" && !before && holdings.length >= MAX_HOLDINGS) {
    throw new UserError(`최대 ${MAX_HOLDINGS}종목까지 보유할 수 있습니다. 다른 종목을 정리한 뒤 매수해 주세요.`, 409);
  }

  // 체결가는 서버가 가진 최신 시세로 정한다(클라이언트 가격은 받지 않는다).
  const quote = (await quotesFor(env, [symbol], 5_000, true)).get(symbol);
  if (!quote) throw new UserError("시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 409);
  const now = Date.now();

  if (side === "buy") {
    const s = buySettlement(quote.price, quantity);
    const results = await env.DB.batch([
      env.DB.prepare("UPDATE users SET cash = cash - ?1 WHERE id = ?2 AND is_bankrupt = 0 AND cash >= ?1").bind(
        s.total,
        userId,
      ),
      env.DB.prepare(
        `INSERT INTO holdings (user_id, symbol, quantity, avg_price)
         SELECT ?1, ?2, ?3, ?4 WHERE changes() = 1
         ON CONFLICT(user_id, symbol) DO UPDATE SET
           avg_price = (holdings.quantity * holdings.avg_price + excluded.quantity * excluded.avg_price)
                       / (holdings.quantity + excluded.quantity),
           quantity  = holdings.quantity + excluded.quantity`,
      ).bind(userId, symbol, quantity, quote.price),
      env.DB.prepare(
        `INSERT INTO orders (user_id, symbol, side, quantity, price, amount, fee, tax, created_at,
                             day_high, day_low, day_rate)
         SELECT ?1, ?2, 'buy', ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10 WHERE changes() = 1`,
      ).bind(userId, symbol, quantity, quote.price, s.amount, s.fee, now, quote.high, quote.low, quote.rate),
    ]);
    if (results[0].meta.changes !== 1) throw new UserError("잔액이 부족합니다.", 409);
    await checkOrderBadges(env, userId, {
      side,
      symbol,
      quantity,
      price: quote.price,
      total: s.total,
      cashBefore: user.cash,
      avgPriceBefore: before?.avg_price ?? 0,
      holdingAfter: (before?.quantity ?? 0) + quantity,
      quote,
      now,
    });
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
      `INSERT INTO orders (user_id, symbol, side, quantity, price, amount, fee, tax, created_at,
                           day_high, day_low, day_rate)
       SELECT ?1, ?2, 'sell', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11 WHERE changes() = 1`,
    ).bind(userId, symbol, quantity, quote.price, s.amount, s.fee, s.tax, now, quote.high, quote.low, quote.rate),
    env.DB.prepare("DELETE FROM holdings WHERE user_id = ? AND quantity = 0").bind(userId),
  ]);
  if (results[0].meta.changes !== 1) throw new UserError("보유 수량이 부족합니다.", 409);
  await checkOrderBadges(env, userId, {
    side,
    symbol,
    quantity,
    price: quote.price,
    total: s.total,
    cashBefore: user.cash,
    avgPriceBefore: before?.avg_price ?? 0,
    holdingAfter: (before?.quantity ?? 0) - quantity,
    quote,
    now,
  });
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
  await onSalary(env, userId, Date.now());
}
