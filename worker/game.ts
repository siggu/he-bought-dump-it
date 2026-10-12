// 파산자 전용 미니게임: 실제 과거 일봉으로 만드는 주가 맞히기.
//
// - 쉬움  : 인기 종목 + 실제 날짜 공개. 20거래일 동안 올랐나/내렸나 (2지선다)
// - 보통  : 종목·날짜 비공개. 5거래일 뒤 종가 등락 구간 (3지선다)
// - 어려움: 종목·날짜 비공개. 다음 날 등락률 구간 (4지선다)
//
// 정답은 서버만 알고 있으므로 클라이언트 조작으로 점수를 만들 수 없다.
// 문제를 받는 순간 1회가 차감되며 하루 3회, 한 달 10회까지만 할 수 있다.

import type { Candle, GameDifficulty, GameQuestion, GameResult, GameStatus } from "../shared/protocol";
import { evaluateAccount, loadUser, UserError } from "./account";
import { onGameAnswered } from "./badges";
import { type Env, priceHub } from "./env";
import { kstDayStart, kstMonthStart } from "./market";
import {
  EASY_PERIOD,
  GAME_ANSWER_TIMEOUT_MS,
  GAME_CHOICES,
  GAME_DAILY_LIMIT,
  GAME_MONTHLY_LIMIT,
  GAME_REWARDS,
  GAME_WINDOW,
  NORMAL_HORIZON,
  classifyMove,
  RECOVERY_CASH,
} from "./rules";

/** 쉬움 난이도에 나오는 인기 종목 */
export const POPULAR_SYMBOLS = [
  "005930", "000660", "373220", "207940", "005380", "000270", "068270", "035420",
  "035720", "105560", "005490", "051910", "006400", "012450", "247540",
];

export const DIFFICULTIES: GameDifficulty[] = ["easy", "normal", "hard"];

/** 정답까지 몇 거래일 뒤를 보는지 */
export function horizonOf(difficulty: GameDifficulty): number {
  return difficulty === "easy" ? EASY_PERIOD : difficulty === "normal" ? NORMAL_HORIZON : 1;
}

/** 기준 종가 대비 등락률(%) */
export function changePct(base: number, target: number): number {
  return Math.round(((target - base) / base) * 10_000) / 100;
}

/**
 * 문제로 쓸 "마지막으로 보여주는 봉"의 위치를 고른다.
 * 앞으로 GAME_WINDOW개, 뒤로 horizon개가 있어야 하고, 쉬움은 보합(등락 0)을 피한다.
 */
export function pickIndex(
  candles: Candle[],
  difficulty: GameDifficulty,
  random = Math.random,
): number | null {
  const horizon = horizonOf(difficulty);
  const candidates: number[] = [];
  for (let i = GAME_WINDOW - 1; i + horizon < candles.length; i++) {
    if (difficulty === "easy" && candles[i + horizon].close === candles[i].close) continue;
    candidates.push(i);
  }
  if (candidates.length === 0) return null;
  return candidates[Math.floor(random() * candidates.length)];
}

/** 기준 종가를 100으로 맞추고 날짜를 지워 종목을 알아보기 어렵게 만든다. */
export function normalize(candles: Candle[], base: number, startIndex = 0): Candle[] {
  const n = (v: number) => Math.round((v / base) * 10_000) / 100;
  return candles.map((c, i) => ({
    date: `D${startIndex + i + 1}`,
    open: n(c.open),
    high: n(c.high),
    low: n(c.low),
    close: n(c.close),
    volume: 0,
  }));
}

interface StoredReveal {
  name: string;
  period: string;
  ratePct: number;
  candles: Candle[];
}

async function usage(env: Env, userId: number, now: number): Promise<{ today: number; month: number }> {
  const row = await env.DB.prepare(
    `SELECT COUNT(CASE WHEN created_at >= ?2 THEN 1 END) AS today, COUNT(*) AS month
       FROM game_sessions WHERE user_id = ?1 AND created_at >= ?3`,
  )
    .bind(userId, kstDayStart(now), kstMonthStart(now))
    .first<{ today: number; month: number }>();
  return { today: row?.today ?? 0, month: row?.month ?? 0 };
}

export async function gameStatus(env: Env, userId: number): Promise<GameStatus> {
  const now = Date.now();
  const { user } = await evaluateAccount(env, userId);
  const used = await usage(env, userId, now);
  const open = await env.DB.prepare(
    `SELECT question FROM game_sessions
      WHERE user_id = ? AND answered_at IS NULL AND created_at > ?
      ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(userId, now - GAME_ANSWER_TIMEOUT_MS)
    .first<{ question: string }>();
  return {
    isBankrupt: user.is_bankrupt === 1,
    usedToday: used.today,
    usedThisMonth: used.month,
    dailyLimit: GAME_DAILY_LIMIT,
    monthlyLimit: GAME_MONTHLY_LIMIT,
    rewards: GAME_REWARDS,
    cash: user.cash,
    recoveryTarget: RECOVERY_CASH,
    current: open ? (JSON.parse(open.question) as GameQuestion) : null,
  };
}

function limitError(used: { today: number; month: number }): UserError | null {
  if (used.month >= GAME_MONTHLY_LIMIT) {
    return new UserError(`이번 달 미니게임 기회(${GAME_MONTHLY_LIMIT}회)를 모두 썼습니다. 월급을 기다려 보세요!`, 409);
  }
  if (used.today >= GAME_DAILY_LIMIT) {
    return new UserError(`오늘 미니게임 기회(${GAME_DAILY_LIMIT}회)를 모두 썼습니다. 내일 다시 오세요!`, 409);
  }
  return null;
}

export interface Built {
  symbol: string;
  question: Omit<GameQuestion, "gameId" | "expiresAt">;
  answer: string;
  reveal: StoredReveal;
}

export async function buildQuestion(env: Env, difficulty: GameDifficulty): Promise<Built | null> {
  const stock =
    difficulty === "easy"
      ? await env.DB.prepare(
          `SELECT symbol, name FROM stocks WHERE symbol IN (${POPULAR_SYMBOLS.map(() => "?").join(",")})
            ORDER BY RANDOM() LIMIT 1`,
        )
          .bind(...POPULAR_SYMBOLS)
          .first<{ symbol: string; name: string }>()
      : await env.DB.prepare("SELECT symbol, name FROM stocks ORDER BY RANDOM() LIMIT 1").first<{
          symbol: string;
          name: string;
        }>();
  if (!stock) return null;

  const candles = await priceHub(env).getDailyCandles(stock.symbol);
  const i = pickIndex(candles, difficulty);
  if (i === null) return null;

  const horizon = horizonOf(difficulty);
  const window = candles.slice(i - GAME_WINDOW + 1, i + 1);
  const last = candles[i];
  const target = candles[i + horizon];
  const future = candles.slice(i + 1, i + horizon + 1);
  const ratePct = changePct(last.close, target.close);
  const answer = classifyMove(difficulty, ratePct);
  const period = `${last.date} → ${target.date}`;

  if (difficulty === "easy") {
    return {
      symbol: stock.symbol,
      answer,
      reveal: { name: stock.name, period, ratePct, candles: future },
      question: {
        difficulty,
        prompt: `${stock.name}의 주가는 ${last.date} 종가 대비 ${EASY_PERIOD}거래일 뒤인 ${target.date} 종가가 올랐을까요, 내렸을까요?`,
        stockName: stock.name,
        candles: window,
        datesVisible: true,
        choices: GAME_CHOICES.easy,
        reward: GAME_REWARDS.easy,
      },
    };
  }

  const base = last.close;
  return {
    symbol: stock.symbol,
    answer,
    reveal: { name: stock.name, period, ratePct, candles: normalize(future, base, GAME_WINDOW) },
    question: {
      difficulty,
      prompt:
        difficulty === "normal"
          ? `어떤 종목의 최근 ${GAME_WINDOW}거래일 차트입니다(마지막 종가 = 100). ${NORMAL_HORIZON}거래일 뒤 종가는 어떻게 됐을까요?`
          : `어떤 종목의 최근 ${GAME_WINDOW}거래일 차트입니다(마지막 종가 = 100). 바로 다음 날 종가 등락률은?`,
      stockName: null,
      candles: normalize(window, base),
      datesVisible: false,
      choices: GAME_CHOICES[difficulty],
      reward: GAME_REWARDS[difficulty],
    },
  };
}

export async function startGame(env: Env, userId: number, difficulty: GameDifficulty): Promise<GameQuestion> {
  const user = await loadUser(env, userId);
  if (!user.is_bankrupt) throw new UserError("미니게임은 파산했을 때만 할 수 있습니다.", 403);

  const now = Date.now();
  const status = await gameStatus(env, userId);
  if (status.current) throw new UserError("풀고 있는 문제가 있습니다. 먼저 답을 골라 주세요.", 409);
  const limited = limitError({ today: status.usedToday, month: status.usedThisMonth });
  if (limited) throw limited;

  let built: Built | null = null;
  for (let attempt = 0; attempt < 3 && !built; attempt++) built = await buildQuestion(env, difficulty);
  if (!built) throw new UserError("문제를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 409);

  const gameId = crypto.randomUUID();
  const question: GameQuestion = { ...built.question, gameId, expiresAt: now + GAME_ANSWER_TIMEOUT_MS };

  // 횟수 제한과 "동시에 한 문제" 조건을 INSERT 한 문장 안에서 확인해 동시 요청에도 초과되지 않게 한다.
  const res = await env.DB.prepare(
    `INSERT INTO game_sessions (id, user_id, difficulty, symbol, question, answer, reveal, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
      WHERE (SELECT COUNT(*) FROM game_sessions WHERE user_id = ?2 AND created_at >= ?9) < ?10
        AND (SELECT COUNT(*) FROM game_sessions WHERE user_id = ?2 AND created_at >= ?11) < ?12
        AND NOT EXISTS (SELECT 1 FROM game_sessions
                         WHERE user_id = ?2 AND answered_at IS NULL AND created_at > ?13)`,
  )
    .bind(
      gameId,
      userId,
      difficulty,
      built.symbol,
      JSON.stringify(question),
      built.answer,
      JSON.stringify(built.reveal),
      now,
      kstDayStart(now),
      GAME_DAILY_LIMIT,
      kstMonthStart(now),
      GAME_MONTHLY_LIMIT,
      now - GAME_ANSWER_TIMEOUT_MS,
    )
    .run();
  if (res.meta.changes !== 1) {
    throw limitError(await usage(env, userId, now)) ?? new UserError("풀고 있는 문제가 있습니다.", 409);
  }
  return question;
}

export async function answerGame(env: Env, userId: number, gameId: string, choice: string): Promise<GameResult> {
  const game = await env.DB.prepare(
    `SELECT difficulty, answer, reveal, created_at FROM game_sessions
      WHERE id = ? AND user_id = ? AND answered_at IS NULL`,
  )
    .bind(gameId, userId)
    .first<{ difficulty: GameDifficulty; answer: string; reveal: string; created_at: number }>();
  if (!game) throw new UserError("이미 끝났거나 없는 문제입니다.", 404);

  const choices = GAME_CHOICES[game.difficulty];
  if (!choices.some((c) => c.id === choice)) throw new UserError("잘못된 선택지입니다.");
  const now = Date.now();
  if (now - game.created_at > GAME_ANSWER_TIMEOUT_MS) {
    throw new UserError("시간이 초과됐습니다. (기회는 이미 사용됐어요)", 409);
  }

  const correct = choice === game.answer;
  const reward = correct ? GAME_REWARDS[game.difficulty] : 0;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE game_sessions SET guess = ?1, correct = ?2, reward = ?3, answered_at = ?4
        WHERE id = ?5 AND user_id = ?6 AND answered_at IS NULL AND created_at > ?7`,
    ).bind(choice, correct ? 1 : 0, reward, now, gameId, userId, now - GAME_ANSWER_TIMEOUT_MS),
    env.DB.prepare("UPDATE users SET cash = cash + ?1 WHERE id = ?2 AND changes() = 1").bind(reward, userId),
    env.DB.prepare(
      "INSERT INTO cash_events (user_id, type, amount, created_at) SELECT ?1, 'game', ?2, ?3 WHERE changes() = 1 AND ?2 > 0",
    ).bind(userId, reward, now),
  ]);
  if (results[0].meta.changes !== 1) throw new UserError("이미 끝난 문제입니다.", 409);
  await onGameAnswered(env, userId, game.difficulty, correct, now);

  // 보상으로 복구 기준을 넘었으면 여기서 파산 해제된다.
  const { user } = await evaluateAccount(env, userId);
  const reveal = JSON.parse(game.reveal) as StoredReveal;
  return {
    correct,
    answer: game.answer,
    answerLabel: choices.find((c) => c.id === game.answer)?.label ?? game.answer,
    reward,
    stockName: reveal.name,
    period: reveal.period,
    ratePct: reveal.ratePct,
    reveal: reveal.candles,
    cash: user.cash,
    recovered: user.is_bankrupt === 0,
    recoveryTarget: RECOVERY_CASH,
  };
}
