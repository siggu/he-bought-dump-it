import type { FeedKind } from "../shared/protocol";
import type { PasswordHasher } from "./hasher";
import type { PriceHub } from "./hub/PriceHub";
import { isMarketOpen, parseHolidays } from "./market";

export interface Env {
  DB: D1Database;
  PRICE_HUB: DurableObjectNamespace<PriceHub>;
  PASSWORD_HASHER: DurableObjectNamespace<PasswordHasher>;
  ASSETS: Fetcher;
  /** 한국투자증권 앱키/시크릿 (wrangler secret). 없으면 모의 시세로 동작 */
  KIS_APP_KEY?: string;
  KIS_APP_SECRET?: string;
  /** real(실전) | demo(모의투자) — 앱키를 발급받은 환경 */
  KIS_ENV?: string;
  /** auto(키가 있으면 KIS) | mock(항상 모의 시세) */
  PRICE_FEED?: string;
  /** 휴장일 목록 YYYY-MM-DD,YYYY-MM-DD */
  MARKET_HOLIDAYS?: string;
  /** PBKDF2 반복 횟수 (기본 100000) */
  PASSWORD_ITERATIONS?: string;
}

export function feedKind(env: Env): FeedKind {
  if (env.PRICE_FEED === "mock") return "mock";
  return env.KIS_APP_KEY && env.KIS_APP_SECRET ? "kis" : "mock";
}

/** 모의 시세는 연습용이므로 24시간 열려 있다. */
export function marketOpen(env: Env, now = Date.now()): boolean {
  return feedKind(env) === "mock" || isMarketOpen(now, parseHolidays(env.MARKET_HOLIDAYS));
}

export function priceHub(env: Env) {
  // KIS 서버(한국)와 가까운 아시아·태평양 리전에 생성한다.
  return env.PRICE_HUB.get(env.PRICE_HUB.idFromName("hub"), { locationHint: "apac" });
}
