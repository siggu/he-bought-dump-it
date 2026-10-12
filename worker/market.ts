// 한국 증시(KRX) 시간 계산. 모든 계산은 KST(UTC+9) 기준.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const OPEN_MINUTES = 9 * 60; // 09:00
const CLOSE_MINUTES = 15 * 60 + 30; // 15:30

export interface KstParts {
  /** YYYY-MM-DD */
  date: string;
  /** YYYY-MM */
  month: string;
  /** 0=일 ~ 6=토 */
  weekday: number;
  /** 자정 이후 분 */
  minutes: number;
}

export function kst(now = Date.now()): KstParts {
  const d = new Date(now + KST_OFFSET_MS);
  const date = d.toISOString().slice(0, 10);
  return {
    date,
    month: date.slice(0, 7),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

/** KST 기준 오늘 0시 (epoch ms) */
export function kstDayStart(now = Date.now()): number {
  return Math.floor((now + KST_OFFSET_MS) / 86_400_000) * 86_400_000 - KST_OFFSET_MS;
}

/** KST 기준 이번 달 1일 0시 (epoch ms) */
export function kstMonthStart(now = Date.now()): number {
  const d = new Date(now + KST_OFFSET_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - KST_OFFSET_MS;
}

export function parseHolidays(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
  );
}

export function isTradingDay(now: number, holidays: Set<string>): boolean {
  const p = kst(now);
  return p.weekday !== 0 && p.weekday !== 6 && !holidays.has(p.date);
}

/** 정규장(09:00~15:30) 여부 */
export function isMarketOpen(now: number, holidays: Set<string>): boolean {
  if (!isTradingDay(now, holidays)) return false;
  const { minutes } = kst(now);
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES;
}

/** YYYYMMDD (KIS API 날짜 형식) */
export function kisDate(now: number): string {
  return kst(now).date.replaceAll("-", "");
}

/** KRX 호가 단위 (2023년 개편 기준) */
export function tickSize(price: number): number {
  if (price < 2_000) return 1;
  if (price < 5_000) return 5;
  if (price < 20_000) return 10;
  if (price < 50_000) return 50;
  if (price < 200_000) return 100;
  if (price < 500_000) return 500;
  return 1_000;
}

export function roundToTick(price: number): number {
  const t = tickSize(price);
  return Math.max(t, Math.round(price / t) * t);
}
