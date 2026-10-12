// 전체 종목 목록을 한 번만 받아 두고(메모리 + localStorage) 브라우저에서 바로 검색한다.

import type { StockInfo } from "../../shared/protocol";

const CACHE_KEY = "stock-catalog-v1";
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let memory: StockInfo[] | null = null;
let loading: Promise<StockInfo[]> | null = null;

function readCache(): StockInfo[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { at, stocks } = JSON.parse(raw) as { at: number; stocks: StockInfo[] };
    return Date.now() - at < CACHE_TTL_MS && Array.isArray(stocks) ? stocks : null;
  } catch {
    return null;
  }
}

function writeCache(stocks: StockInfo[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), stocks }));
  } catch {
    // 저장 공간을 못 쓰는 환경이면 메모리 캐시만 쓴다.
  }
}

/** 지금 바로 쓸 수 있는 목록 (없으면 빈 배열) */
export function catalogNow(): StockInfo[] {
  if (!memory) memory = readCache();
  return memory ?? [];
}

export function loadCatalog(): Promise<StockInfo[]> {
  if (memory && memory.length > 0) return Promise.resolve(memory);
  const cached = readCache();
  if (cached) {
    memory = cached;
    return Promise.resolve(cached);
  }
  loading ??= fetch("/api/stocks", { credentials: "same-origin" })
    .then((r) => r.json() as Promise<{ stocks: StockInfo[] }>)
    .then(({ stocks }) => {
      memory = stocks;
      writeCache(stocks);
      return stocks;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}
