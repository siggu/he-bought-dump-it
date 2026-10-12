// 숨겨진 배지(업적).
// 조건(condition)은 서버에만 있고, 본인이 획득한 배지에 한해서만 조건을 내려준다.
// 다른 사람에게는 이름·등급·한 줄 설명(flavor)만 보인다.

import type { BadgeTier, OwnedBadge, PublicBadge, Quote } from "../shared/protocol";
import type { Env } from "./env";
import { isTradingDay, kst, kstDayStart, parseHolidays } from "./market";
import { SALARY_AMOUNT } from "./rules";

interface BadgeDef {
  id: string;
  name: string;
  tier: BadgeTier;
  flavor: string;
  condition: string;
}

export const BADGES: BadgeDef[] = [
  // 매매 입문
  { id: "first_buy", name: "주린이", tier: "common", flavor: "누구에게나 처음은 있다.", condition: "첫 매수" },
  { id: "first_sell", name: "첫 탈출", tier: "common", flavor: "들어갔으면 나와야지.", condition: "첫 매도" },
  { id: "first_profit", name: "익절의 맛", tier: "common", flavor: "이 맛에 주식한다.", condition: "처음으로 수익을 내고 매도" },
  { id: "first_loss", name: "손절도 실력이다", tier: "common", flavor: "아픈 만큼 성숙해진다.", condition: "처음으로 손실을 보고 매도" },
  { id: "buy_streak_3", name: "개근 개미", tier: "rare", flavor: "오늘도 출근 도장 쾅.", condition: "3거래일 연속 매수" },
  { id: "buy_streak_7", name: "출석왕 개미", tier: "epic", flavor: "개근상은 따로 없습니다.", condition: "7거래일 연속 매수" },
  { id: "buy_streak_20", name: "여의도 출근러", tier: "legendary", flavor: "사원증은 없지만 마음만은 증권맨.", condition: "20거래일 연속 매수" },
  // 타이밍
  { id: "peak_buyer", name: "그가 샀습니다", tier: "epic", flavor: "그가 사면, 떨어진다.", condition: "당일 최고가에 매수했는데 그날 매수가보다 5% 이상 하락" },
  { id: "bottom_buyer", name: "바닥 탐지기", tier: "rare", flavor: "바닥인 줄 어떻게 알았지?", condition: "당일 최저가에 매수" },
  { id: "open_run", name: "오픈런", tier: "common", flavor: "종 치자마자 달려왔다.", condition: "09:00~09:01에 매수" },
  { id: "last_train", name: "막차 탑승", tier: "common", flavor: "문 닫히기 직전에 겨우.", condition: "15:29에 매매" },
  { id: "moth", name: "불나방", tier: "rare", flavor: "뜨거운 걸 알면서도.", condition: "전일 대비 +20% 이상 오른 날 매수" },
  { id: "falling_knife", name: "떨어지는 칼날", tier: "rare", flavor: "손바닥 조심하세요.", condition: "전일 대비 -20% 이상 내린 날 매수" },
  { id: "scalper", name: "초단타 스캘퍼", tier: "rare", flavor: "숨 쉴 틈도 없었다.", condition: "매수 후 1분 안에 전량 매도" },
  { id: "finger_workout", name: "손가락 운동", tier: "rare", flavor: "검지가 뻐근하다.", condition: "하루에 20번 이상 매매" },
  // 몰빵 · 존버
  { id: "all_in", name: "영끌러", tier: "common", flavor: "영혼까지 끌어모았다.", condition: "현금의 99% 이상을 한 번에 매수" },
  { id: "diamond_hands", name: "존버는 승리한다", tier: "epic", flavor: "버티는 자가 이긴다.", condition: "30일 동안 매도 없이 보유" },
  { id: "half_cut", name: "반토막 장인", tier: "rare", flavor: "반은 남았다, 반이나.", condition: "보유 종목 평가수익률 -50% 이하" },
  { id: "double_up", name: "더블 업", tier: "epic", flavor: "두 배로 돌려받았다.", condition: "총자산 2,000만원 이상 (초기 자금의 2배)" },
  { id: "ten_bagger", name: "텐배거", tier: "legendary", flavor: "전설의 열 배.", condition: "보유 종목 평가수익률 +900% 이상" },
  { id: "billionaire", name: "억대 개미", tier: "epic", flavor: "개미 중의 개미.", condition: "총자산 1억원 이상" },
  // 파산
  { id: "first_bankrupt", name: "깡통", tier: "common", flavor: "텅 빈 소리가 난다.", condition: "첫 파산" },
  { id: "speed_bankrupt", name: "광속 파산", tier: "rare", flavor: "온 지 하루도 안 됐는데.", condition: "가입한 날 파산" },
  { id: "bankrupt_streak_3", name: "상습 파산범", tier: "epic", flavor: "이쯤 되면 습관.", condition: "3거래일 연속 파산" },
  { id: "bankrupt_streak_7", name: "전설의 깡통", tier: "legendary", flavor: "깡통계의 살아있는 전설.", condition: "7거래일 연속 파산" },
  { id: "pro_bankrupt", name: "프로 파산러", tier: "epic", flavor: "파산도 경력이다.", condition: "누적 파산 10회" },
  { id: "revived", name: "부활", tier: "common", flavor: "다시 일어섰다.", condition: "파산 후 재기" },
  { id: "phoenix", name: "불사조", tier: "legendary", flavor: "잿더미에서 날아올랐다.", condition: "재기한 뒤 총자산이 재기 시점 현금의 1.5배 이상" },
  { id: "no_learning", name: "학습 불가", tier: "rare", flavor: "어제의 나와 다를 게 없다.", condition: "재기한 날 다시 파산" },
  // 미니게임 · 월급
  { id: "first_correct", name: "점쟁이 견습생", tier: "common", flavor: "촉이 왔다.", condition: "미니게임 첫 정답" },
  { id: "chart_shaman", name: "차트 무당", tier: "rare", flavor: "차트가 말을 걸어온다.", condition: "어려움 난이도 정답" },
  { id: "time_traveler", name: "미래에서 온 자", tier: "legendary", flavor: "혹시 내일 신문 보셨어요?", condition: "어려움 난이도 3연속 정답" },
  { id: "you_dont_know", name: "그것도 몰라?", tier: "common", flavor: "…그럴 수 있어요.", condition: "쉬움 난이도 오답" },
  { id: "loyal_salaryman", name: "성실한 월급쟁이", tier: "epic", flavor: "꼬박꼬박이 제일 무섭다.", condition: "월급 6개월 연속 수령" },
  { id: "salary_gone", name: "월급 순삭", tier: "rare", flavor: "통장을 스쳐 지나갔다.", condition: "월급을 받고 1분 안에 월급 이상 금액을 매수" },
  // 이스터에그
  { id: "migratory", name: "철새 개미", tier: "rare", flavor: "이 종목 저 종목.", condition: "메인 종목 5번 변경" },
  { id: "broker_vip", name: "증권사 VIP", tier: "epic", flavor: "증권사가 고마워합니다.", condition: "누적 수수료 100만원 이상" },
  { id: "taxpayer", name: "애국 납세자", tier: "epic", flavor: "나라 살림에 보탬이.", condition: "누적 거래세 100만원 이상" },
  { id: "lucky_seven", name: "럭키 세븐", tier: "rare", flavor: "7 7 7 잭팟?", condition: "정확히 777주 매수" },
  { id: "non_possession", name: "무소유", tier: "legendary", flavor: "가진 것이 없으니 잃을 것도 없다.", condition: "총자산 정확히 0원" },
  { id: "night_owl", name: "올빼미 개미", tier: "common", flavor: "장은 아직 안 열었어요.", condition: "새벽 3~4시 접속" },
];

const BY_ID = new Map(BADGES.map((b) => [b.id, b]));

export function isBadgeId(id: string): boolean {
  return BY_ID.has(id);
}

export function publicBadge(id: string): PublicBadge | null {
  const b = BY_ID.get(id);
  return b ? { id: b.id, name: b.name, tier: b.tier, flavor: b.flavor } : null;
}

export function ownedBadge(id: string, earnedAt: number): OwnedBadge | null {
  const b = BY_ID.get(id);
  return b ? { ...publicBadge(id)!, condition: b.condition, earnedAt } : null;
}

async function award(env: Env, userId: number, ids: string[], now: number): Promise<void> {
  const valid = [...new Set(ids)].filter(isBadgeId);
  if (valid.length === 0) return;
  await env.DB.batch(
    valid.map((id) =>
      env.DB.prepare("INSERT OR IGNORE INTO user_badges (user_id, badge_id, earned_at) VALUES (?, ?, ?)").bind(
        userId,
        id,
        now,
      ),
    ),
  );
}

/**
 * 오늘(from)부터 거꾸로 세어 연속된 거래일 수.
 * 주말·휴장일은 건너뛰며(연속이 끊기지 않음), 기록이 없는 거래일을 만나면 멈춘다.
 */
export function tradingStreak(dates: Set<string>, from: number, holidays: Set<string>, maxDays = 60): number {
  let streak = 0;
  for (let i = 0; i < maxDays; i++) {
    const t = from - i * 86_400_000;
    const day = kst(t).date;
    if (!isTradingDay(t, holidays)) {
      if (dates.has(day)) streak++; // 모의 시세(주말 매매)도 연속으로 인정
      continue;
    }
    if (!dates.has(day)) break;
    streak++;
  }
  return streak;
}

/** 오늘부터 거꾸로 이어진 연속 월 수 (YYYY-MM 목록) */
export function monthStreak(months: Set<string>, from: number): number {
  const d = new Date(from + 9 * 3_600_000);
  let y = d.getUTCFullYear();
  let m = d.getUTCMonth() + 1;
  let streak = 0;
  while (months.has(`${y}-${String(m).padStart(2, "0")}`)) {
    streak++;
    m--;
    if (m === 0) {
      m = 12;
      y--;
    }
  }
  return streak;
}

async function kstDates(env: Env, sql: string, ...binds: unknown[]): Promise<Set<string>> {
  const { results } = await env.DB.prepare(sql)
    .bind(...binds)
    .all<{ created_at: number }>();
  return new Set(results.map((r) => kst(r.created_at).date));
}

export interface OrderContext {
  side: "buy" | "sell";
  quantity: number;
  price: number;
  total: number;
  cashBefore: number;
  avgPriceBefore: number;
  holdingAfter: number;
  quote: Quote;
  now: number;
}

/** 체결 직후 */
export async function checkOrderBadges(env: Env, userId: number, o: OrderContext): Promise<void> {
  const ids: string[] = [];
  const minutes = kst(o.now).minutes;
  const dayStart = kstDayStart(o.now);
  const holidays = parseHolidays(env.MARKET_HOLIDAYS);

  if (minutes === 15 * 60 + 29) ids.push("last_train");

  if (o.side === "buy") {
    ids.push("first_buy");
    if (o.quantity === 777) ids.push("lucky_seven");
    if (o.total >= o.cashBefore * 0.99) ids.push("all_in");
    if (o.price <= o.quote.low) ids.push("bottom_buyer");
    if (minutes >= 9 * 60 && minutes < 9 * 60 + 2) ids.push("open_run");
    if (o.quote.rate >= 20) ids.push("moth");
    if (o.quote.rate <= -20) ids.push("falling_knife");

    const buyDays = await kstDates(
      env,
      "SELECT created_at FROM orders WHERE user_id = ? AND side = 'buy' AND created_at >= ?",
      userId,
      o.now - 60 * 86_400_000,
    );
    const streak = tradingStreak(buyDays, o.now, holidays);
    if (streak >= 3) ids.push("buy_streak_3");
    if (streak >= 7) ids.push("buy_streak_7");
    if (streak >= 20) ids.push("buy_streak_20");

    if (o.total >= SALARY_AMOUNT) {
      const salary = await env.DB.prepare(
        "SELECT 1 FROM cash_events WHERE user_id = ? AND type = 'salary' AND created_at >= ? LIMIT 1",
      )
        .bind(userId, o.now - 60_000)
        .first();
      if (salary) ids.push("salary_gone");
    }
  } else {
    ids.push("first_sell");
    if (o.price > o.avgPriceBefore) ids.push("first_profit");
    if (o.price < o.avgPriceBefore) ids.push("first_loss");
    if (o.holdingAfter === 0) {
      const recentBuy = await env.DB.prepare(
        "SELECT 1 FROM orders WHERE user_id = ? AND side = 'buy' AND created_at >= ? LIMIT 1",
      )
        .bind(userId, o.now - 60_000)
        .first();
      if (recentBuy) ids.push("scalper");
    }
  }

  const sums = await env.DB.prepare(
    `SELECT COALESCE(SUM(fee), 0) AS fee, COALESCE(SUM(tax), 0) AS tax,
            COUNT(CASE WHEN created_at >= ?2 AND side IN ('buy', 'sell') THEN 1 END) AS today
       FROM orders WHERE user_id = ?1`,
  )
    .bind(userId, dayStart)
    .first<{ fee: number; tax: number; today: number }>();
  if ((sums?.fee ?? 0) >= 1_000_000) ids.push("broker_vip");
  if ((sums?.tax ?? 0) >= 1_000_000) ids.push("taxpayer");
  if ((sums?.today ?? 0) >= 20) ids.push("finger_workout");

  await award(env, userId, ids, o.now);
}

export interface AccountContext {
  cash: number;
  isBankrupt: boolean;
  symbol: string | null;
  quantity: number;
  avgPrice: number;
  quote: Quote | null;
  now: number;
}

/** 계좌 조회(/me) 때: 자산 규모, 보유 기간 등 시간이 지나야 판정되는 배지 */
export async function checkAccountBadges(env: Env, userId: number, a: AccountContext): Promise<void> {
  const ids: string[] = [];
  const minutes = kst(a.now).minutes;
  if (minutes >= 3 * 60 && minutes < 4 * 60) ids.push("night_owl");

  const price = a.quote?.price ?? 0;
  const total = a.cash + a.quantity * price;
  if (a.quote) {
    if (total >= 20_000_000) ids.push("double_up");
    if (total >= 100_000_000) ids.push("billionaire");
    if (total === 0 && a.quantity === 0) ids.push("non_possession");
    if (a.quantity > 0 && a.avgPrice > 0) {
      const rate = (price - a.avgPrice) / a.avgPrice;
      if (rate <= -0.5) ids.push("half_cut");
      if (rate >= 9) ids.push("ten_bagger");
    }
  }

  if (a.symbol && a.quote) {
    // 그가 샀습니다: 오늘 당일 고가에 산 주문이 있고, 지금 가격이 그보다 5% 이상 낮다.
    const peak = await env.DB.prepare(
      `SELECT 1 FROM orders
        WHERE user_id = ? AND symbol = ? AND side = 'buy' AND created_at >= ?
          AND day_high IS NOT NULL AND price >= day_high AND price * 0.95 >= ?
        LIMIT 1`,
    )
      .bind(userId, a.symbol, kstDayStart(a.now), a.quote.price)
      .first();
    if (peak) ids.push("peak_buyer");
  }

  if (a.quantity > 0) {
    // 존버: 마지막 매도(또는 청산) 이후 첫 매수가 30일 이상 지났다.
    const row = await env.DB.prepare(
      `SELECT MIN(created_at) AS since FROM orders
        WHERE user_id = ?1 AND side = 'buy'
          AND created_at > COALESCE((SELECT MAX(created_at) FROM orders
                                      WHERE user_id = ?1 AND side IN ('sell', 'liquidation')), 0)`,
    )
      .bind(userId)
      .first<{ since: number | null }>();
    if (row?.since && a.now - row.since >= 30 * 86_400_000) ids.push("diamond_hands");
  }

  if (!a.isBankrupt && a.quote) {
    // 불사조: 마지막 재기 이후 다시 파산하지 않았고, 총자산이 재기 시점 현금의 1.5배 이상
    const rec = await env.DB.prepare(
      `SELECT value, created_at FROM user_events WHERE user_id = ? AND type = 'recover'
        ORDER BY created_at DESC LIMIT 1`,
    )
      .bind(userId)
      .first<{ value: number; created_at: number }>();
    if (rec && rec.value > 0 && total >= rec.value * 1.5) {
      const again = await env.DB.prepare(
        "SELECT 1 FROM user_events WHERE user_id = ? AND type = 'bankrupt' AND created_at > ? LIMIT 1",
      )
        .bind(userId, rec.created_at)
        .first();
      if (!again) ids.push("phoenix");
    }
  }

  await award(env, userId, ids, a.now);
}

/** 파산 처리 직후 */
export async function onBankrupt(env: Env, userId: number, now: number): Promise<void> {
  await env.DB.prepare("INSERT INTO user_events (user_id, type, created_at) VALUES (?, 'bankrupt', ?)")
    .bind(userId, now)
    .run();
  const ids = ["first_bankrupt"];
  const user = await env.DB.prepare("SELECT created_at, bankrupt_count FROM users WHERE id = ?")
    .bind(userId)
    .first<{ created_at: number; bankrupt_count: number }>();
  if (user && kst(user.created_at).date === kst(now).date) ids.push("speed_bankrupt");
  if ((user?.bankrupt_count ?? 0) >= 10) ids.push("pro_bankrupt");

  const days = await kstDates(
    env,
    "SELECT created_at FROM user_events WHERE user_id = ? AND type = 'bankrupt' AND created_at >= ?",
    userId,
    now - 30 * 86_400_000,
  );
  const streak = tradingStreak(days, now, parseHolidays(env.MARKET_HOLIDAYS));
  if (streak >= 3) ids.push("bankrupt_streak_3");
  if (streak >= 7) ids.push("bankrupt_streak_7");

  const recoveredToday = await env.DB.prepare(
    "SELECT 1 FROM user_events WHERE user_id = ? AND type = 'recover' AND created_at >= ? LIMIT 1",
  )
    .bind(userId, kstDayStart(now))
    .first();
  if (recoveredToday) ids.push("no_learning");
  await award(env, userId, ids, now);
}

/** 재기 직후 */
export async function onRecover(env: Env, userId: number, cash: number, now: number): Promise<void> {
  await env.DB.prepare("INSERT INTO user_events (user_id, type, value, created_at) VALUES (?, 'recover', ?, ?)")
    .bind(userId, cash, now)
    .run();
  await award(env, userId, ["revived"], now);
}

/** 미니게임 답안 제출 직후 */
export async function onGameAnswered(
  env: Env,
  userId: number,
  difficulty: string,
  correct: boolean,
  now: number,
): Promise<void> {
  const ids: string[] = [];
  if (correct) ids.push("first_correct");
  if (difficulty === "hard" && correct) {
    ids.push("chart_shaman");
    const { results } = await env.DB.prepare(
      `SELECT correct FROM game_sessions WHERE user_id = ? AND difficulty = 'hard' AND answered_at IS NOT NULL
        ORDER BY answered_at DESC LIMIT 3`,
    )
      .bind(userId)
      .all<{ correct: number }>();
    if (results.length === 3 && results.every((r) => r.correct === 1)) ids.push("time_traveler");
  }
  if (difficulty === "easy" && !correct) ids.push("you_dont_know");
  await award(env, userId, ids, now);
}

/** 월급 수령 직후 */
export async function onSalary(env: Env, userId: number, now: number): Promise<void> {
  const { results } = await env.DB.prepare(
    "SELECT created_at FROM cash_events WHERE user_id = ? AND type = 'salary' AND created_at >= ?",
  )
    .bind(userId, now - 400 * 86_400_000)
    .all<{ created_at: number }>();
  const months = new Set(results.map((r) => kst(r.created_at).month));
  if (monthStreak(months, now) >= 6) await award(env, userId, ["loyal_salaryman"], now);
}

/** 메인 종목 변경 직후 (최초 선택 제외) */
export async function onMainChange(env: Env, userId: number, now: number): Promise<void> {
  await env.DB.prepare("INSERT INTO user_events (user_id, type, created_at) VALUES (?, 'main_change', ?)")
    .bind(userId, now)
    .run();
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM user_events WHERE user_id = ? AND type = 'main_change'",
  )
    .bind(userId)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= 5) await award(env, userId, ["migratory"], now);
}

/** 아직 확인하지 않은 배지 */
export async function unseenBadges(env: Env, userId: number): Promise<OwnedBadge[]> {
  const { results } = await env.DB.prepare(
    "SELECT badge_id, earned_at FROM user_badges WHERE user_id = ? AND seen = 0 ORDER BY earned_at",
  )
    .bind(userId)
    .all<{ badge_id: string; earned_at: number }>();
  return results.map((r) => ownedBadge(r.badge_id, r.earned_at)).filter((b): b is OwnedBadge => b !== null);
}

export async function ownedBadges(env: Env, userId: number): Promise<OwnedBadge[]> {
  const { results } = await env.DB.prepare(
    "SELECT badge_id, earned_at FROM user_badges WHERE user_id = ? ORDER BY earned_at DESC",
  )
    .bind(userId)
    .all<{ badge_id: string; earned_at: number }>();
  return results.map((r) => ownedBadge(r.badge_id, r.earned_at)).filter((b): b is OwnedBadge => b !== null);
}
