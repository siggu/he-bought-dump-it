// 유저 간 상호작용 ("개미 광장")
//
// - swap  블라인드 박스 교환: 서로 보유 주식 1주씩을 종목명을 가린 채 맞교환한다.
// - raid  기습 털기: 같은 주가 맞히기 문제로 결투. 건 사람이 이기면 상대 보유 주식 1주를 무작위로 가져오고,
//         지면 판돈을 상대에게 준다. 비기면 판돈을 돌려받는다.
// - duel  1:1 수익률 맞짱: 각자 종목 하나를 고르고 판돈을 건다. 7일 뒤 수익률이 높은 쪽이 판돈을 모두 가져간다.
//
// 모든 상호작용은 받는 사람이 프로필에서 허용해 둔 경우에만 걸 수 있다(기본: 전부 거부).
// 돈·주식이 오가는 처리는 D1 batch + tx_guard로 원자적으로 실행한다. (하나라도 조건이 어긋나면 전부 롤백)

import type {
  ArenaState,
  Candle,
  GameChoice,
  InteractionStatus,
  InteractionType,
  InteractionView,
  PublicBadge,
} from "../shared/protocol";
import { loadHoldings, loadUser, quotesFor, stockNames, UserError, type UserRow } from "./account";
import { award, publicBadge } from "./badges";
import { type Env, priceHub } from "./env";
import { buildQuestion, type Built } from "./game";
import { kstDayStart } from "./market";
import { parseInteractionSettings } from "./profile";
import {
  DUEL_DAYS,
  DUEL_MAX_ACTIVE,
  GAME_ANSWER_TIMEOUT_MS,
  GAME_CHOICES,
  INTERACTION_DAILY_LIMIT,
  INTERACTION_TTL_MS,
  STAKE_MAX,
  STAKE_MIN,
} from "./rules";

const SETTING_OF: Record<InteractionType, "allowSwap" | "allowRaid" | "allowDuel"> = {
  swap: "allowSwap",
  raid: "allowRaid",
  duel: "allowDuel",
};
const TYPE_NAME: Record<InteractionType, string> = {
  swap: "블라인드 박스 교환",
  raid: "기습 털기",
  duel: "1:1 수익률 맞짱",
};

/** 블라인드 박스에서 보여주는 힌트: 1주 가격대 */
export function priceBand(price: number): string {
  if (price < 10_000) return "1만원 미만";
  if (price < 50_000) return "1만~5만원대";
  if (price < 100_000) return "5만~10만원대";
  if (price < 500_000) return "10만~50만원대";
  return "50만원 이상";
}

/** 맞짱 종료 시각: 수락한 날(KST)로부터 7일 뒤 장 마감(15:30) */
export function duelEndAt(acceptedAt: number): number {
  return kstDayStart(acceptedAt) + DUEL_DAYS * 86_400_000 + (15 * 60 + 30) * 60_000;
}

/** 일봉 중 date 이하인 마지막 종가 */
export function closeOnOrBefore(candles: Candle[], date: string): number | null {
  for (let i = candles.length - 1; i >= 0; i--) if (candles[i].date <= date) return candles[i].close;
  return null;
}

// ---------------------------------------------------------------- 공통

interface Row {
  id: string;
  type: InteractionType;
  from_user: number;
  to_user: number;
  status: InteractionStatus | "draft";
  stake: number;
  payload: string;
  result: string | null;
  created_at: number;
  expires_at: number;
}

interface SwapPayload {
  fromSymbol: string;
  fromPrice: number;
  hint: string;
}
interface RaidPayload {
  question: Omit<Built["question"], never>;
  answer: string;
  reveal: unknown;
  fromChoice?: string;
}
interface DuelPayload {
  fromSymbol: string;
  toSymbol?: string;
  startFrom?: number;
  startTo?: number;
}
interface Result {
  summary: string;
  [k: string]: unknown;
}

/** 직전 문장이 1행 이상 바꾸지 않았으면 CHECK 위반을 일으켜 batch 전체를 롤백시킨다. */
function guard(env: Env): D1PreparedStatement {
  return env.DB.prepare("UPDATE tx_guard SET ok = CASE WHEN changes() >= 1 THEN 1 ELSE 0 END WHERE id = 1");
}

async function atomic(env: Env, stmts: D1PreparedStatement[]): Promise<boolean> {
  try {
    await env.DB.batch(stmts);
    return true;
  } catch (err) {
    if (String(err).includes("CHECK constraint failed")) return false;
    throw err;
  }
}

/** 받은 주식을 보유에 더한다 (평균 단가는 받은 시점의 현재가로 계산) */
function addShare(env: Env, userId: number, symbol: string, price: number): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO holdings (user_id, symbol, quantity, avg_price) VALUES (?1, ?2, 1, ?3)
     ON CONFLICT(user_id, symbol) DO UPDATE SET
       avg_price = (holdings.quantity * holdings.avg_price + excluded.avg_price) / (holdings.quantity + 1),
       quantity  = holdings.quantity + 1`,
  ).bind(userId, symbol, price);
}

function takeShare(env: Env, userId: number, symbol: string): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE holdings SET quantity = quantity - 1
      WHERE user_id = ?1 AND symbol = ?2 AND quantity >= 1
        AND EXISTS (SELECT 1 FROM users WHERE id = ?1 AND is_bankrupt = 0)`,
  ).bind(userId, symbol);
}

function cleanupHoldings(env: Env, ...userIds: number[]): D1PreparedStatement {
  return env.DB.prepare(
    `DELETE FROM holdings WHERE quantity <= 0 AND user_id IN (${userIds.map(() => "?").join(",")})`,
  ).bind(...userIds);
}

function addCash(env: Env, userId: number, amount: number): D1PreparedStatement {
  return env.DB.prepare("UPDATE users SET cash = cash + ? WHERE id = ?").bind(amount, userId);
}

/** 상태를 바꾼다. 기대한 상태일 때만 바뀌고, 뒤에 guard를 붙여 쓴다. */
function transition(
  env: Env,
  id: string,
  from: string,
  to: string,
  result: Result | null,
  extra = "",
  binds: unknown[] = [],
): D1PreparedStatement {
  return env.DB.prepare(
    `UPDATE interactions SET status = ?, result = COALESCE(?, result), updated_at = ?
      WHERE id = ? AND status = ? ${extra}`,
  ).bind(to, result ? JSON.stringify(result) : null, Date.now(), id, from, ...binds);
}

async function loadRow(env: Env, id: string): Promise<Row> {
  const row = await env.DB.prepare("SELECT * FROM interactions WHERE id = ?").bind(id).first<Row>();
  if (!row) throw new UserError("존재하지 않는 요청입니다.", 404);
  return row;
}

async function findTarget(env: Env, me: UserRow, nickname: string, type: InteractionType): Promise<UserRow> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(nickname).first<{ id: number }>();
  if (!row) throw new UserError("존재하지 않는 사용자입니다.", 404);
  if (row.id === me.id) throw new UserError("자기 자신에게는 걸 수 없습니다.");
  const target = await loadUser(env, row.id);
  if (!parseInteractionSettings(target.interaction_settings)[SETTING_OF[type]]) {
    throw new UserError(`${target.nickname}님은 ${TYPE_NAME[type]}을(를) 받지 않습니다.`, 403);
  }
  if (target.is_bankrupt) throw new UserError("파산한 사람에게는 걸 수 없습니다.", 409);
  return target;
}

async function checkSender(env: Env, me: UserRow, type: InteractionType): Promise<void> {
  if (me.is_bankrupt) throw new UserError("파산 상태에서는 상호작용을 할 수 없습니다.", 403);
  const used = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM interactions WHERE from_user = ? AND type = ? AND created_at >= ?",
  )
    .bind(me.id, type, kstDayStart())
    .first<{ n: number }>();
  if ((used?.n ?? 0) >= INTERACTION_DAILY_LIMIT) {
    throw new UserError(`${TYPE_NAME[type]}은(는) 하루에 ${INTERACTION_DAILY_LIMIT}번만 걸 수 있습니다.`, 409);
  }
}

function checkStake(me: UserRow, stake: unknown): number {
  const n = Number(stake);
  if (!Number.isInteger(n) || n < STAKE_MIN || n > STAKE_MAX) {
    throw new UserError(`판돈은 ${STAKE_MIN.toLocaleString("ko-KR")}원 ~ ${STAKE_MAX.toLocaleString("ko-KR")}원 사이로 걸어 주세요.`);
  }
  if (me.cash < n) throw new UserError("현금이 판돈보다 적습니다.", 409);
  return n;
}

async function insertInteraction(
  env: Env,
  type: InteractionType,
  from: number,
  to: number,
  status: string,
  stake: number,
  payload: unknown,
  ttlMs: number,
  escrow: boolean,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const stmts = [
    env.DB.prepare(
      `INSERT INTO interactions (id, type, from_user, to_user, status, stake, payload, created_at, expires_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, type, from, to, status, stake, JSON.stringify(payload), now, now + ttlMs, now),
  ];
  if (escrow) {
    stmts.push(
      env.DB.prepare("UPDATE users SET cash = cash - ?1 WHERE id = ?2 AND cash >= ?1 AND is_bankrupt = 0").bind(stake, from),
      guard(env),
    );
  }
  if (!(await atomic(env, stmts))) throw new UserError("현금이 판돈보다 적습니다.", 409);
  return id;
}

// ------------------------------------------------------- 블라인드 박스

export async function createSwap(env: Env, userId: number, nickname: string, symbol: string): Promise<string> {
  const me = await loadUser(env, userId);
  await checkSender(env, me, "swap");
  const target = await findTarget(env, me, nickname, "swap");
  const mine = (await loadHoldings(env, userId)).find((h) => h.symbol === symbol);
  if (!mine) throw new UserError("보유하고 있는 종목만 상자에 넣을 수 있습니다.");
  const price = (await quotesFor(env, [symbol])).get(symbol)?.price;
  if (!price) throw new UserError("시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 409);
  const payload: SwapPayload = { fromSymbol: symbol, fromPrice: price, hint: priceBand(price) };
  return insertInteraction(env, "swap", userId, target.id, "pending", 0, payload, INTERACTION_TTL_MS, false);
}

async function acceptSwap(env: Env, row: Row, symbol: unknown): Promise<void> {
  const p = JSON.parse(row.payload) as SwapPayload;
  const mySymbol = String(symbol ?? "");
  const mine = (await loadHoldings(env, row.to_user)).find((h) => h.symbol === mySymbol);
  if (!mine) throw new UserError("상자에 넣을 내 보유 종목을 골라 주세요.");
  const quotes = await quotesFor(env, [p.fromSymbol, mySymbol]);
  const fromPrice = quotes.get(p.fromSymbol)?.price ?? p.fromPrice;
  const toPrice = quotes.get(mySymbol)?.price;
  if (!toPrice) throw new UserError("시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 409);
  const names = await stockNames(env, [p.fromSymbol, mySymbol]);
  const fromName = names.get(p.fromSymbol) ?? p.fromSymbol;
  const toName = names.get(mySymbol) ?? mySymbol;
  const result: Result = {
    summary: `교환 성사! ${fromName} 1주 ↔ ${toName} 1주`,
    fromStock: fromName,
    toStock: toName,
  };

  const ok = await atomic(env, [
    transition(env, row.id, "pending", "settled", result, "AND expires_at > ?", [Date.now()]),
    guard(env),
    takeShare(env, row.from_user, p.fromSymbol),
    guard(env),
    takeShare(env, row.to_user, mySymbol),
    guard(env),
    addShare(env, row.from_user, mySymbol, toPrice),
    addShare(env, row.to_user, p.fromSymbol, fromPrice),
    cleanupHoldings(env, row.from_user, row.to_user),
  ]);
  if (!ok) {
    await env.DB.batch([
      transition(env, row.id, "pending", "cancelled", { summary: "보유 주식이 바뀌어 교환이 취소되었습니다." }),
    ]);
    throw new UserError("상대(또는 내)가 그사이 주식을 처분해서 교환이 취소되었습니다.", 409);
  }
  await award(env, row.from_user, ["blind_date"], Date.now());
  await award(env, row.to_user, ["blind_date"], Date.now());
}

// ------------------------------------------------------- 기습 털기

/** 1단계: 상대를 정하면 문제가 나온다. (오늘 기회는 여기서 사용된다) */
export async function prepareRaid(env: Env, userId: number, nickname: string) {
  const me = await loadUser(env, userId);
  await checkSender(env, me, "raid");
  const target = await findTarget(env, me, nickname, "raid");
  let built: Built | null = null;
  for (let i = 0; i < 3 && !built; i++) built = await buildQuestion(env, "normal");
  if (!built) throw new UserError("문제를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 409);
  const payload: RaidPayload = { question: built.question, answer: built.answer, reveal: built.reveal };
  const id = await insertInteraction(env, "raid", userId, target.id, "draft", 0, payload, GAME_ANSWER_TIMEOUT_MS, false);
  return { id, question: built.question, expiresAt: Date.now() + GAME_ANSWER_TIMEOUT_MS };
}

/** 2단계: 내 답과 판돈을 걸면 상대에게 도전장이 간다. */
export async function submitRaid(env: Env, userId: number, id: string, choice: unknown, stake: unknown): Promise<void> {
  const row = await loadRow(env, id);
  if (row.type !== "raid" || row.from_user !== userId || row.status !== "draft") {
    throw new UserError("이미 끝났거나 없는 도전입니다.", 404);
  }
  if (row.expires_at <= Date.now()) throw new UserError("답안 제출 시간이 지났습니다. (오늘 기회는 사용됐어요)", 409);
  const me = await loadUser(env, userId);
  const amount = checkStake(me, stake);
  const c = String(choice ?? "");
  if (!GAME_CHOICES.normal.some((x) => x.id === c)) throw new UserError("잘못된 선택지입니다.");
  const now = Date.now();
  const ok = await atomic(env, [
    env.DB.prepare(
      `UPDATE interactions SET status = 'pending', stake = ?1, payload = json_set(payload, '$.fromChoice', ?2),
              expires_at = ?3, updated_at = ?4
        WHERE id = ?5 AND status = 'draft' AND expires_at > ?4`,
    ).bind(amount, c, now + INTERACTION_TTL_MS, now, id),
    guard(env),
    env.DB.prepare("UPDATE users SET cash = cash - ?1 WHERE id = ?2 AND cash >= ?1 AND is_bankrupt = 0").bind(amount, userId),
    guard(env),
  ]);
  if (!ok) throw new UserError("도전장을 보내지 못했습니다. 현금과 제한 시간을 확인해 주세요.", 409);
}

function label(choices: GameChoice[], id: string | undefined): string {
  return choices.find((c) => c.id === id)?.label ?? "-";
}

async function acceptRaid(env: Env, row: Row, choice: unknown): Promise<void> {
  const p = JSON.parse(row.payload) as RaidPayload;
  const c = String(choice ?? "");
  if (!GAME_CHOICES.normal.some((x) => x.id === c)) throw new UserError("잘못된 선택지입니다.");
  const attackerWins = p.fromChoice === p.answer && c !== p.answer;
  const defenderWins = c === p.answer && p.fromChoice !== p.answer;
  const [attacker, defender] = await Promise.all([loadUser(env, row.from_user), loadUser(env, row.to_user)]);
  const base = {
    answer: label(GAME_CHOICES.normal, p.answer),
    fromChoice: label(GAME_CHOICES.normal, p.fromChoice),
    toChoice: label(GAME_CHOICES.normal, c),
  };
  const now = Date.now();
  const open = [transition(env, row.id, "pending", "settled", null, "AND expires_at > ?", [now]), guard(env)];

  if (attackerWins) {
    const holdings = await loadHoldings(env, row.to_user);
    if (holdings.length > 0) {
      const target = holdings[Math.floor(Math.random() * holdings.length)];
      const price = (await quotesFor(env, [target.symbol])).get(target.symbol)?.price ?? target.avg_price;
      const name = (await stockNames(env, [target.symbol])).get(target.symbol) ?? target.symbol;
      const result: Result = { ...base, winner: "from", stolen: name, summary: `${attacker.nickname}님이 ${name} 1주를 털어 갔습니다!` };
      const ok = await atomic(env, [
        transition(env, row.id, "pending", "settled", result, "AND expires_at > ?", [now]),
        guard(env),
        takeShare(env, row.to_user, target.symbol),
        guard(env),
        addShare(env, row.from_user, target.symbol, price),
        addCash(env, row.from_user, row.stake),
        cleanupHoldings(env, row.to_user),
      ]);
      if (!ok) throw new UserError("처리 중 상태가 바뀌었습니다. 다시 시도해 주세요.", 409);
      await award(env, row.from_user, ["raider"], now);
      await award(env, row.to_user, ["got_raided"], now);
      return;
    }
    const result: Result = { ...base, winner: "from", stolen: null, summary: `${attacker.nickname}님이 이겼지만 털 주식이 없었습니다. (빈집)` };
    open[0] = transition(env, row.id, "pending", "settled", result, "AND expires_at > ?", [now]);
    if (!(await atomic(env, [...open, addCash(env, row.from_user, row.stake)]))) throw new UserError("이미 끝난 도전입니다.", 409);
    return;
  }

  const result: Result = defenderWins
    ? { ...base, winner: "to", summary: `${defender.nickname}님이 막아내고 판돈 ${row.stake.toLocaleString("ko-KR")}원을 가져갔습니다!` }
    : { ...base, winner: null, summary: "무승부! 판돈은 돌려줍니다." };
  open[0] = transition(env, row.id, "pending", "settled", result, "AND expires_at > ?", [now]);
  const payout = addCash(env, defenderWins ? row.to_user : row.from_user, row.stake);
  if (!(await atomic(env, [...open, payout]))) throw new UserError("이미 끝난 도전입니다.", 409);
}

// ------------------------------------------------------- 수익률 맞짱

export async function createDuel(env: Env, userId: number, nickname: string, symbol: string, stake: unknown): Promise<string> {
  const me = await loadUser(env, userId);
  await checkSender(env, me, "duel");
  const target = await findTarget(env, me, nickname, "duel");
  const amount = checkStake(me, stake);
  if (!(await env.DB.prepare("SELECT 1 FROM stocks WHERE symbol = ?").bind(symbol).first())) {
    throw new UserError("존재하지 않는 종목입니다.", 404);
  }
  const active = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM interactions
      WHERE type = 'duel' AND status IN ('pending', 'active') AND (from_user = ?1 OR to_user = ?1)`,
  )
    .bind(userId)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= DUEL_MAX_ACTIVE) throw new UserError(`맞짱은 동시에 ${DUEL_MAX_ACTIVE}개까지만 할 수 있습니다.`, 409);
  const payload: DuelPayload = { fromSymbol: symbol };
  return insertInteraction(env, "duel", userId, target.id, "pending", amount, payload, INTERACTION_TTL_MS, true);
}

async function acceptDuel(env: Env, row: Row, symbol: unknown): Promise<void> {
  const p = JSON.parse(row.payload) as DuelPayload;
  const mySymbol = String(symbol ?? "");
  if (!(await env.DB.prepare("SELECT 1 FROM stocks WHERE symbol = ?").bind(mySymbol).first())) {
    throw new UserError("맞짱에 쓸 종목을 골라 주세요.");
  }
  const quotes = await quotesFor(env, [p.fromSymbol, mySymbol]);
  const startFrom = quotes.get(p.fromSymbol)?.price;
  const startTo = quotes.get(mySymbol)?.price;
  if (!startFrom || !startTo) throw new UserError("시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", 409);
  const now = Date.now();
  const next: DuelPayload = { ...p, toSymbol: mySymbol, startFrom, startTo };
  const ok = await atomic(env, [
    env.DB.prepare(
      `UPDATE interactions SET status = 'active', payload = ?1, expires_at = ?2, updated_at = ?3
        WHERE id = ?4 AND status = 'pending' AND expires_at > ?3`,
    ).bind(JSON.stringify(next), duelEndAt(now), now, row.id),
    guard(env),
    env.DB.prepare("UPDATE users SET cash = cash - ?1 WHERE id = ?2 AND cash >= ?1 AND is_bankrupt = 0").bind(row.stake, row.to_user),
    guard(env),
  ]);
  if (!ok) throw new UserError("수락하지 못했습니다. 현금이 판돈보다 적은지 확인해 주세요.", 409);
}

async function endPrice(env: Env, symbol: string, endAt: number): Promise<number | null> {
  const date = new Date(endAt + 9 * 3_600_000).toISOString().slice(0, 10);
  try {
    const close = closeOnOrBefore(await priceHub(env).getDailyCandles(symbol), date);
    if (close) return close;
  } catch {
    // 아래에서 현재가로 대체
  }
  return (await quotesFor(env, [symbol])).get(symbol)?.price ?? null;
}

async function settleDuel(env: Env, row: Row): Promise<void> {
  const p = JSON.parse(row.payload) as DuelPayload;
  if (!p.toSymbol || !p.startFrom || !p.startTo) return;
  const [endFrom, endTo] = await Promise.all([endPrice(env, p.fromSymbol, row.expires_at), endPrice(env, p.toSymbol, row.expires_at)]);
  if (!endFrom || !endTo) return; // 시세를 못 불러오면 다음 조회 때 다시 정산
  const rateFrom = Math.round(((endFrom - p.startFrom) / p.startFrom) * 10_000) / 100;
  const rateTo = Math.round(((endTo - p.startTo) / p.startTo) * 10_000) / 100;
  const [a, b] = await Promise.all([loadUser(env, row.from_user), loadUser(env, row.to_user)]);
  const names = await stockNames(env, [p.fromSymbol, p.toSymbol]);
  const winner = rateFrom > rateTo ? "from" : rateTo > rateFrom ? "to" : null;
  const pot = row.stake * 2;
  const result: Result = {
    winner,
    fromStock: names.get(p.fromSymbol) ?? p.fromSymbol,
    toStock: names.get(p.toSymbol) ?? p.toSymbol,
    rateFrom,
    rateTo,
    summary: winner
      ? `${winner === "from" ? a.nickname : b.nickname}님 승리! 판돈 ${pot.toLocaleString("ko-KR")}원 획득`
      : "무승부! 판돈은 돌려줍니다.",
  };
  const payouts = winner
    ? [addCash(env, winner === "from" ? row.from_user : row.to_user, pot)]
    : [addCash(env, row.from_user, row.stake), addCash(env, row.to_user, row.stake)];
  if (await atomic(env, [transition(env, row.id, "active", "settled", result), guard(env), ...payouts]) && winner) {
    await award(env, winner === "from" ? row.from_user : row.to_user, ["duel_winner"], Date.now());
  }
}

// --------------------------------------------------- 응답 · 만료 · 조회

export async function respond(env: Env, userId: number, id: string, action: string, input: Record<string, unknown>): Promise<void> {
  await processDue(env, userId);
  const row = await loadRow(env, id);
  const isTo = row.to_user === userId;
  const isFrom = row.from_user === userId;
  if (!isTo && !isFrom) throw new UserError("존재하지 않는 요청입니다.", 404);

  if (action === "cancel") {
    if (!isFrom || row.status !== "pending") throw new UserError("취소할 수 없는 요청입니다.", 409);
    await closeWithRefund(env, row, "cancelled", "보낸 사람이 취소했습니다.");
    return;
  }
  if (!isTo || row.status !== "pending") throw new UserError("이미 끝났거나 응답할 수 없는 요청입니다.", 409);
  if (row.expires_at <= Date.now()) throw new UserError("만료된 요청입니다.", 409);
  if (action === "decline") {
    await closeWithRefund(env, row, "declined", "상대가 거절했습니다.");
    return;
  }
  if (action !== "accept") throw new UserError("잘못된 요청입니다.");
  const me = await loadUser(env, userId);
  if (me.is_bankrupt) throw new UserError("파산 상태에서는 상호작용을 할 수 없습니다.", 403);
  if (row.type === "swap") await acceptSwap(env, row, input.symbol);
  else if (row.type === "raid") await acceptRaid(env, row, input.choice);
  else await acceptDuel(env, row, input.symbol);
}

/** 거절·취소·만료: 맡겨 둔 판돈을 돌려준다. */
async function closeWithRefund(env: Env, row: Row, to: "declined" | "cancelled" | "expired", summary: string): Promise<void> {
  const stmts = [transition(env, row.id, row.status, to, { summary }), guard(env)];
  const escrowed = row.status === "pending" && (row.type === "raid" || row.type === "duel");
  if (escrowed && row.stake > 0) stmts.push(addCash(env, row.from_user, row.stake));
  await atomic(env, stmts);
}

/** 기한이 지난 요청을 만료시키고, 끝난 맞짱을 정산한다. (조회할 때 처리) */
export async function processDue(env: Env, userId: number): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM interactions
      WHERE (from_user = ?1 OR to_user = ?1) AND status IN ('draft', 'pending', 'active') AND expires_at <= ?2`,
  )
    .bind(userId, Date.now())
    .all<Row>();
  for (const row of results) {
    if (row.status === "active") await settleDuel(env, row);
    else await closeWithRefund(env, row, "expired", "응답 기한이 지나 만료되었습니다.");
  }
}

async function nicknames(env: Env, ids: number[]): Promise<Map<number, { nickname: string; badge: PublicBadge | null }>> {
  if (ids.length === 0) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT id, nickname, featured_badge FROM users WHERE id IN (${ids.map(() => "?").join(",")})`,
  )
    .bind(...ids)
    .all<{ id: number; nickname: string; featured_badge: string | null }>();
  return new Map(results.map((r) => [r.id, { nickname: r.nickname, badge: r.featured_badge ? publicBadge(r.featured_badge) : null }]));
}

/** 보는 사람 입장에서 공개해도 되는 정보만 담는다. */
async function toView(env: Env, row: Row, me: number, people: Map<number, { nickname: string; badge: PublicBadge | null }>): Promise<InteractionView> {
  const outgoing = row.from_user === me;
  const result = row.result ? (JSON.parse(row.result) as Result) : null;
  const detail: Record<string, unknown> = {};
  const done = !["draft", "pending", "active"].includes(row.status);

  if (row.type === "swap") {
    const p = JSON.parse(row.payload) as SwapPayload;
    detail.hint = p.hint;
    if (outgoing) detail.myStock = (await stockNames(env, [p.fromSymbol])).get(p.fromSymbol) ?? p.fromSymbol;
    if (result) Object.assign(detail, { fromStock: result.fromStock, toStock: result.toStock });
  } else if (row.type === "raid") {
    const p = JSON.parse(row.payload) as RaidPayload;
    if (row.status === "draft" && outgoing) {
      detail.draft = true;
      detail.question = p.question;
    }
    if (row.status === "pending" && !outgoing) detail.question = p.question;
    if (outgoing && p.fromChoice) detail.myChoice = label(GAME_CHOICES.normal, p.fromChoice);
    if (result) Object.assign(detail, result, { summary: undefined });
  } else {
    const p = JSON.parse(row.payload) as DuelPayload;
    const names = await stockNames(env, [p.fromSymbol, p.toSymbol ?? ""].filter(Boolean));
    if (outgoing || row.status !== "pending") detail.fromStock = names.get(p.fromSymbol) ?? p.fromSymbol;
    if (p.toSymbol) detail.toStock = names.get(p.toSymbol) ?? p.toSymbol;
    if (row.status === "active" && p.toSymbol && p.startFrom && p.startTo) {
      const quotes = await quotesFor(env, [p.fromSymbol, p.toSymbol]);
      const r = (now: number | undefined, start: number) => (now ? Math.round(((now - start) / start) * 10_000) / 100 : null);
      detail.rateFrom = r(quotes.get(p.fromSymbol)?.price, p.startFrom);
      detail.rateTo = r(quotes.get(p.toSymbol)?.price, p.startTo);
      detail.endAt = row.expires_at;
    }
    if (result) Object.assign(detail, result, { summary: undefined });
  }

  const other = people.get(outgoing ? row.to_user : row.from_user) ?? { nickname: "(탈퇴)", badge: null };
  return {
    id: row.id,
    type: row.type,
    status: row.status === "draft" ? "pending" : row.status,
    outgoing,
    other,
    stake: row.stake,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    detail,
    summary: done ? (result?.summary ?? null) : null,
  };
}

export async function arenaState(env: Env, userId: number, target?: string): Promise<ArenaState> {
  await processDue(env, userId);
  const me = await loadUser(env, userId);
  const { results } = await env.DB.prepare(
    `SELECT * FROM interactions WHERE (from_user = ?1 OR to_user = ?1)
      ORDER BY created_at DESC LIMIT 60`,
  )
    .bind(userId)
    .all<Row>();
  const visible = results.filter((r) => !(r.status === "draft" && r.to_user === userId));
  const people = await nicknames(env, [...new Set(visible.flatMap((r) => [r.from_user, r.to_user]))]);
  const views = await Promise.all(visible.map((r) => toView(env, r, userId, people)));

  const open = (v: InteractionView) => v.status === "pending" || v.status === "active";
  const { results: players } = await env.DB.prepare(
    `SELECT nickname, featured_badge, interaction_settings FROM users
      WHERE id <> ? AND is_bankrupt = 0
        AND (json_extract(interaction_settings, '$.allowSwap') = 1
          OR json_extract(interaction_settings, '$.allowRaid') = 1
          OR json_extract(interaction_settings, '$.allowDuel') = 1)
      ORDER BY RANDOM() LIMIT 30`,
  )
    .bind(userId)
    .all<{ nickname: string; featured_badge: string | null; interaction_settings: string }>();

  // 프로필에서 "도전하기"로 들어온 상대는 무작위 목록에 없어도 넣어 준다.
  if (target && !players.some((p) => p.nickname === target)) {
    const t = await env.DB.prepare(
      "SELECT nickname, featured_badge, interaction_settings FROM users WHERE nickname = ? AND id <> ? AND is_bankrupt = 0",
    )
      .bind(target, userId)
      .first<{ nickname: string; featured_badge: string | null; interaction_settings: string }>();
    if (t && Object.values(parseInteractionSettings(t.interaction_settings)).some(Boolean)) players.unshift(t);
  }

  const { results: used } = await env.DB.prepare(
    "SELECT type, COUNT(*) AS n FROM interactions WHERE from_user = ? AND created_at >= ? GROUP BY type",
  )
    .bind(userId, kstDayStart())
    .all<{ type: InteractionType; n: number }>();
  const usedToday = { swap: 0, raid: 0, duel: 0 };
  used.forEach((u) => (usedToday[u.type] = u.n));

  return {
    settings: parseInteractionSettings(me.interaction_settings),
    incoming: views.filter((v) => !v.outgoing && open(v)),
    outgoing: views.filter((v) => v.outgoing && open(v)),
    history: views.filter((v) => !open(v)).slice(0, 20),
    players: players.map((p) => ({
      nickname: p.nickname,
      badge: p.featured_badge ? publicBadge(p.featured_badge) : null,
      accepts: parseInteractionSettings(p.interaction_settings),
    })),
    limits: { dailyPerType: INTERACTION_DAILY_LIMIT, stakeMin: STAKE_MIN, stakeMax: STAKE_MAX, duelDays: DUEL_DAYS },
    usedToday,
  };
}
