// KIS 앱키가 없을 때 쓰는 모의 시세. 종목코드로 시드를 만들어 종목별로 일관된 가격을 낸다.

import type { Candle, Quote } from "../../shared/protocol";
import { kst, roundToTick } from "../market";

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function basePrice(symbol: string): number {
  const r = seededRandom(hash(symbol))();
  // 3,000원 ~ 300,000원 사이 로그 균등 분포
  return roundToTick(Math.exp(Math.log(3_000) + r * Math.log(100)));
}

/** 오늘을 마지막 날로 하는 가상의 일봉 */
export function mockDailyCandles(symbol: string, days = 100, now = Date.now()): Candle[] {
  const rand = seededRandom(hash(`${symbol}:${kst(now).date}`));
  const candles: Candle[] = [];
  let close = basePrice(symbol);
  const dayMs = 24 * 60 * 60 * 1000;
  let cursor = now;
  const dates: string[] = [];
  while (dates.length < days) {
    const p = kst(cursor);
    if (p.weekday !== 0 && p.weekday !== 6) dates.unshift(p.date);
    cursor -= dayMs;
  }
  // 마지막 종가가 기준가 근처가 되도록 거꾸로 생성한 뒤 뒤집는다.
  const reversed: Candle[] = [];
  for (let i = dates.length - 1; i >= 0; i--) {
    const drift = (rand() - 0.5) * 0.06;
    const open = roundToTick(close / (1 + drift));
    const high = roundToTick(Math.max(open, close) * (1 + rand() * 0.02));
    const low = roundToTick(Math.min(open, close) * (1 - rand() * 0.02));
    reversed.push({ date: dates[i], open, high, low, close, volume: Math.floor(rand() * 5_000_000) });
    close = roundToTick(open * (1 + (rand() - 0.5) * 0.01));
  }
  for (let i = reversed.length - 1; i >= 0; i--) candles.push(reversed[i]);
  return candles;
}

/** 랜덤 워크 시세 발생기 */
export class MockMarket {
  private quotes = new Map<string, Quote>();

  quote(symbol: string): Quote {
    let q = this.quotes.get(symbol);
    if (!q) {
      const daily = mockDailyCandles(symbol, 2);
      const prev = daily[0].close;
      const today = daily[1];
      q = {
        symbol,
        price: today.close,
        change: today.close - prev,
        rate: round2(((today.close - prev) / prev) * 100),
        open: today.open,
        high: Math.max(today.high, today.close),
        low: Math.min(today.low, today.close),
        volume: today.volume,
        at: Date.now(),
      };
      this.quotes.set(symbol, q);
    }
    return q;
  }

  /** 한 틱 진행 */
  step(symbol: string): Quote {
    const q = this.quote(symbol);
    const prevClose = q.price - q.change;
    const move = (Math.random() - 0.5) * 0.004 * q.price;
    // 전일 대비 ±30% (상/하한가) 안에서만 움직인다.
    const price = roundToTick(
      Math.min(prevClose * 1.3, Math.max(prevClose * 0.7, q.price + move)),
    );
    const next: Quote = {
      symbol,
      price,
      change: price - prevClose,
      rate: round2(((price - prevClose) / prevClose) * 100),
      open: q.open,
      high: Math.max(q.high, price),
      low: Math.min(q.low, price),
      volume: q.volume + Math.floor(Math.random() * 500),
      at: Date.now(),
    };
    this.quotes.set(symbol, next);
    return next;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
