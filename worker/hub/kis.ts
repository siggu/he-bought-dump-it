// 한국투자증권(KIS) Open API 클라이언트.
// 엔드포인트/메시지 형식은 공식 샘플(github.com/koreainvestment/open-trading-api)의
// kis_auth.py, ccnl_krx.py, inquire_price.py, inquire_daily_itemchartprice.py 를 따른다.

import type { Candle, Quote } from "../../shared/protocol";

export type KisEnv = "real" | "demo";

const REST_BASE: Record<KisEnv, string> = {
  real: "https://openapi.koreainvestment.com:9443",
  demo: "https://openapivts.koreainvestment.com:29443",
};

// Workers의 fetch는 ws:// 스킴을 받지 않으므로 http:// + Upgrade 헤더로 연결한다.
const WS_URL: Record<KisEnv, string> = {
  real: "http://ops.koreainvestment.com:21000/tryitout",
  demo: "http://ops.koreainvestment.com:31000/tryitout",
};

/** 국내주식 실시간체결가(KRX) */
export const TR_REALTIME_TRADE = "H0STCNT0";
/** KIS 웹소켓 1세션당 실시간 등록 가능 종목 수 (공식 샘플 기준 40) */
export const MAX_REALTIME_SUBSCRIPTIONS = 40;

// H0STCNT0 응답 필드 순서 (ccnl_krx.py columns)
const F_SYMBOL = 0;
const F_TIME = 1; // HHMMSS
const F_PRICE = 2;
const F_CHANGE = 4;
const F_RATE = 5;
const F_OPEN = 7;
const F_HIGH = 8;
const F_LOW = 9;
const F_ACML_VOL = 13;

export interface RealtimeTrade {
  symbol: string;
  time: string;
  price: number;
  change: number;
  rate: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export type KisMessage =
  | { kind: "trades"; trades: RealtimeTrade[] }
  | { kind: "pingpong" }
  | { kind: "system"; trId: string; ok: boolean; message: string }
  | { kind: "unknown" };

/**
 * KIS 웹소켓 수신 메시지 파싱.
 * - 실시간 데이터: `0|H0STCNT0|003|005930^093001^71200^...` (암호화 여부|TR|건수|데이터)
 *   건수가 2 이상이면 ^ 로 이어진 필드가 건수만큼 반복된다.
 * - 시스템 메시지: JSON (구독 응답, PINGPONG)
 */
export function parseKisMessage(raw: string): KisMessage {
  if (raw.length === 0) return { kind: "unknown" };
  if (raw[0] === "0" || raw[0] === "1") {
    const parts = raw.split("|");
    if (parts.length < 4) return { kind: "unknown" };
    // 암호화(1)는 체결통보 등 계좌 TR에서만 쓰이고 시세 TR은 평문(0)이다.
    if (parts[0] !== "0" || parts[1] !== TR_REALTIME_TRADE) return { kind: "unknown" };
    const count = Math.max(1, Number.parseInt(parts[2], 10) || 1);
    const fields = parts.slice(3).join("|").split("^");
    const per = Math.floor(fields.length / count);
    const trades: RealtimeTrade[] = [];
    for (let i = 0; i < count; i++) {
      const f = fields.slice(i * per, (i + 1) * per);
      const price = Number(f[F_PRICE]);
      if (!f[F_SYMBOL] || !Number.isFinite(price)) continue;
      trades.push({
        symbol: f[F_SYMBOL],
        time: f[F_TIME],
        price,
        change: Number(f[F_CHANGE]) || 0,
        rate: Number(f[F_RATE]) || 0,
        open: Number(f[F_OPEN]) || price,
        high: Number(f[F_HIGH]) || price,
        low: Number(f[F_LOW]) || price,
        volume: Number(f[F_ACML_VOL]) || 0,
      });
    }
    return { kind: "trades", trades };
  }
  try {
    const json = JSON.parse(raw) as {
      header?: { tr_id?: string };
      body?: { rt_cd?: string; msg1?: string };
    };
    const trId = json.header?.tr_id ?? "";
    if (trId === "PINGPONG") return { kind: "pingpong" };
    return {
      kind: "system",
      trId,
      ok: json.body?.rt_cd === "0",
      message: json.body?.msg1 ?? "",
    };
  } catch {
    return { kind: "unknown" };
  }
}

/** 실시간 등록(tr_type "1") / 해제("2") 요청 메시지 */
export function subscriptionMessage(approvalKey: string, symbol: string, subscribe: boolean): string {
  return JSON.stringify({
    header: {
      approval_key: approvalKey,
      custtype: "P",
      tr_type: subscribe ? "1" : "2",
      "content-type": "utf-8",
    },
    body: { input: { tr_id: TR_REALTIME_TRADE, tr_key: symbol } },
  });
}

interface CachedValue {
  value: string;
  expiresAt: number;
}

/** 토큰 캐시 저장소 (Durable Object storage) */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}

export class KisError extends Error {}

/** KIS 응답을 기다리는 최대 시간 */
const REST_TIMEOUT_MS = 5_000;
const WS_CONNECT_TIMEOUT_MS = 5_000;

export class KisClient {
  /** 다음 호출을 보낼 수 있는 가장 이른 시각 (호출 간격 제한용) */
  private nextSlotAt = 0;
  /** 토큰·접속키: 메모리 캐시와 발급 중인 요청 (동시에 여러 번 발급하지 않도록) */
  private memo = new Map<string, CachedValue>();
  private issuing = new Map<string, Promise<string>>();

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private readonly env: KisEnv,
    private readonly store: KeyValueStore,
  ) {}

  /** 실전 초당 20건, 모의 초당 2건 제한에 여유를 두고 호출 간격을 둔다. */
  private get minIntervalMs(): number {
    return this.env === "real" ? 70 : 600;
  }

  /**
   * 호출 "시작" 간격만 지킨다. 앞 호출의 응답을 기다리지 않으므로 여러 종목을 동시에 조회할 수 있다.
   */
  private async throttle<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.minIntervalMs;
    if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
    return fn();
  }

  private async cached(key: string, issue: () => Promise<CachedValue>): Promise<string> {
    const valid = (v: CachedValue | undefined) => v && v.expiresAt > Date.now() + 60_000;
    const mem = this.memo.get(key);
    if (valid(mem)) return mem!.value;
    const pending = this.issuing.get(key);
    if (pending) return pending;
    const task = (async () => {
      const stored = await this.store.get<CachedValue>(key);
      if (valid(stored)) {
        this.memo.set(key, stored!);
        return stored!.value;
      }
      const fresh = await issue();
      this.memo.set(key, fresh);
      await this.store.put(key, fresh);
      return fresh.value;
    })().finally(() => this.issuing.delete(key));
    this.issuing.set(key, task);
    return task;
  }

  /** 접근 토큰. 유효기간 1일, 재발급 시 알림톡이 가므로 반드시 캐시해서 쓴다. */
  private accessToken(): Promise<string> {
    return this.cached(`kis:token:${this.env}`, async () => {
      const res = await fetch(`${REST_BASE[this.env]}/oauth2/tokenP`, {
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: this.appKey,
          appsecret: this.appSecret,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        expires_in?: number;
        error_description?: string;
      };
      if (!res.ok || !body.access_token) {
        throw new KisError(`토큰 발급 실패 (${res.status}) ${body.error_description ?? ""}`.trim());
      }
      return {
        value: body.access_token,
        expiresAt: Date.now() + (body.expires_in ?? 86_400) * 1000,
      };
    });
  }

  /** 웹소켓 접속키 */
  approvalKey(): Promise<string> {
    return this.cached(`kis:approval:${this.env}`, async () => {
      const res = await fetch(`${REST_BASE[this.env]}/oauth2/Approval`, {
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          appkey: this.appKey,
          secretkey: this.appSecret,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { approval_key?: string };
      if (!res.ok || !body.approval_key) {
        throw new KisError(`웹소켓 접속키 발급 실패 (${res.status})`);
      }
      // 접속키 유효기간은 24시간. 여유 있게 12시간마다 재발급한다.
      return { value: body.approval_key, expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
    });
  }

  private async get<T>(path: string, trId: string, params: Record<string, string>): Promise<T> {
    const token = await this.accessToken();
    return this.throttle(async () => {
      const url = `${REST_BASE[this.env]}${path}?${new URLSearchParams(params)}`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(REST_TIMEOUT_MS),
        headers: {
          "content-type": "application/json; charset=utf-8",
          authorization: `Bearer ${token}`,
          appkey: this.appKey,
          appsecret: this.appSecret,
          tr_id: trId,
          custtype: "P",
        },
      });
      const body = (await res.json().catch(() => ({}))) as T & { rt_cd?: string; msg1?: string };
      if (!res.ok || body.rt_cd !== "0") {
        throw new KisError(`${trId} 조회 실패 (${res.status}) ${body.msg1 ?? ""}`.trim());
      }
      return body;
    });
  }

  /** 주식현재가 시세 [FHKST01010100] */
  async quote(symbol: string): Promise<Quote> {
    const body = await this.get<{ output: Record<string, string> }>(
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: symbol },
    );
    const o = body.output;
    const price = Number(o.stck_prpr);
    return {
      symbol,
      price,
      change: Number(o.prdy_vrss) || 0,
      rate: Number(o.prdy_ctrt) || 0,
      open: Number(o.stck_oprc) || price,
      high: Number(o.stck_hgpr) || price,
      low: Number(o.stck_lwpr) || price,
      volume: Number(o.acml_vol) || 0,
      at: Date.now(),
    };
  }

  /** 기간별 일봉 [FHKST03010100] — 최대 100건, 오래된 순으로 정렬해서 반환 */
  async dailyCandles(symbol: string, from: string, to: string): Promise<Candle[]> {
    const body = await this.get<{ output2?: Record<string, string>[] }>(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      "FHKST03010100",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: symbol,
        FID_INPUT_DATE_1: from,
        FID_INPUT_DATE_2: to,
        FID_PERIOD_DIV_CODE: "D",
        FID_ORG_ADJ_PRC: "0",
      },
    );
    return (body.output2 ?? [])
      .filter((r) => r.stck_bsop_date && Number(r.stck_clpr) > 0)
      .map((r) => ({
        date: `${r.stck_bsop_date.slice(0, 4)}-${r.stck_bsop_date.slice(4, 6)}-${r.stck_bsop_date.slice(6, 8)}`,
        open: Number(r.stck_oprc),
        high: Number(r.stck_hgpr),
        low: Number(r.stck_lwpr),
        close: Number(r.stck_clpr),
        volume: Number(r.acml_vol) || 0,
      }))
      .reverse();
  }

  /** 실시간 시세 웹소켓 연결 */
  async connectRealtime(): Promise<WebSocket> {
    const res = await fetch(WS_URL[this.env], {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(WS_CONNECT_TIMEOUT_MS),
    });
    const ws = res.webSocket;
    if (!ws) throw new KisError(`실시간 시세 서버 연결 실패 (${res.status})`);
    ws.accept();
    return ws;
  }
}
