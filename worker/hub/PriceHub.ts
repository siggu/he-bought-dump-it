// 시세 허브 (Durable Object, 전체 서비스에 1개).
//
// - 브라우저 WebSocket을 모두 이 객체가 받는다(Hibernation API).
// - 브라우저들이 구독 중인 종목의 합집합만 KIS 실시간 웹소켓에 등록한다(서버 측 팬아웃).
//   사용자가 몇 명이든 KIS 쪽 구독은 "지금 누군가 보고 있는 종목 수"만큼만 생긴다.
// - 브라우저 전송은 종목당 최대 1초 1회로 묶어서 보낸다(스로틀링).

import { DurableObject } from "cloudflare:workers";
import type { Candle, ClientMessage, FeedKind, Quote, ServerMessage, TickPoint } from "../../shared/protocol";
import { type Env, feedKind, marketOpen } from "../env";
import { kisDate } from "../market";
import {
  KisClient,
  type KisEnv,
  MAX_REALTIME_SUBSCRIPTIONS,
  parseKisMessage,
  subscriptionMessage,
} from "./kis";
import { MockMarket, mockDailyCandles } from "./mock";

interface ClientAttachment {
  userId: number;
  symbols: string[];
}

/** 연결 1개당 동시 구독 수: 메인 종목 1 + 조회 중인 종목 1 */
export const MAX_SYMBOLS_PER_CLIENT = 2;
const FLUSH_INTERVAL_MS = 1_000;
const TICK_HISTORY = 600;
const RECONCILE_INTERVAL_MS = 30_000;
const DAILY_CACHE_MS = 60 * 60 * 1000;
const SYMBOL_RE = /^[0-9A-Z]{6}$/;

export class PriceHub extends DurableObject<Env> {
  private readonly feed: FeedKind;
  private readonly kis: KisClient | null;
  private readonly mock = new MockMarket();

  private quotes = new Map<string, Quote>();
  private ticks = new Map<string, TickPoint[]>();
  private active = new Set<string>();

  private dirty = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFlushAt = 0;

  private upstream: WebSocket | null = null;
  private upstreamConnecting: Promise<void> | null = null;
  private upstreamSymbols = new Set<string>();
  private approvalKey = "";

  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private lastOpen: boolean | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.feed = feedKind(env);
    this.kis =
      this.feed === "kis"
        ? new KisClient(
            env.KIS_APP_KEY!,
            env.KIS_APP_SECRET!,
            (env.KIS_ENV === "demo" ? "demo" : "real") satisfies KisEnv,
            ctx.storage,
          )
        : null;
  }

  // ---------------------------------------------------------------- RPC

  /**
   * 최신 시세. 실시간 구독 중인 종목은 메모리 값을 그대로 쓰고,
   * 아니면 maxAgeMs 이내 캐시가 없을 때 KIS REST로 조회한다.
   */
  async getQuote(symbol: string, maxAgeMs = 60_000): Promise<Quote> {
    if (this.feed === "mock") return this.quotes.get(symbol) ?? this.mock.quote(symbol);
    const cached = this.quotes.get(symbol);
    if (cached && (this.isLive(symbol) || Date.now() - cached.at < maxAgeMs)) return cached;
    const fresh = await this.kis!.quote(symbol);
    this.quotes.set(symbol, fresh);
    return fresh;
  }

  /** 최근 일봉(오래된 순) */
  async getDailyCandles(symbol: string): Promise<Candle[]> {
    if (this.feed === "mock") return mockDailyCandles(symbol);
    const key = `daily:${symbol}`;
    const hit = await this.ctx.storage.get<{ at: number; candles: Candle[] }>(key);
    if (hit && Date.now() - hit.at < DAILY_CACHE_MS) return hit.candles;
    const now = Date.now();
    const candles = await this.kis!.dailyCandles(
      symbol,
      kisDate(now - 150 * 24 * 60 * 60 * 1000),
      kisDate(now),
    );
    await this.ctx.storage.put(key, { at: now, candles });
    return candles;
  }

  // ---------------------------------------------------------- WebSocket

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const userId = Number(request.headers.get("X-User-Id"));
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, symbols: [] } satisfies ClientAttachment);
    this.send(server, this.statusMessage());
    await this.ensureAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string" || message.length > 200) return;
    let msg: ClientMessage;
    try {
      msg = JSON.parse(message) as ClientMessage;
    } catch {
      return;
    }
    const symbol = typeof msg.symbol === "string" ? msg.symbol.toUpperCase() : "";
    if (!SYMBOL_RE.test(symbol)) {
      this.send(ws, { type: "error", message: "잘못된 종목코드입니다." });
      return;
    }
    const att = ws.deserializeAttachment() as ClientAttachment;

    if (msg.op === "sub") {
      if (!att.symbols.includes(symbol)) {
        if (att.symbols.length >= MAX_SYMBOLS_PER_CLIENT) {
          this.send(ws, {
            type: "error",
            message: `실시간 시세는 동시에 ${MAX_SYMBOLS_PER_CLIENT}종목까지만 볼 수 있습니다.`,
          });
          return;
        }
        att.symbols.push(symbol);
        ws.serializeAttachment(att);
        await this.reconcile();
      }
      await this.sendSnapshot(ws, symbol);
    } else if (msg.op === "unsub") {
      att.symbols = att.symbols.filter((s) => s !== symbol);
      ws.serializeAttachment(att);
      await this.reconcile();
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // 이미 닫힘
    }
    await this.reconcile(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.reconcile(ws);
  }

  async alarm(): Promise<void> {
    await this.reconcile();
    await this.refreshNonLive();
    if (this.ctx.getWebSockets().length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
    }
  }

  // ----------------------------------------------------------- 내부 처리

  private async ensureAlarm(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + RECONCILE_INTERVAL_MS);
    }
  }

  private isLive(symbol: string): boolean {
    if (this.feed === "mock") return this.active.has(symbol);
    return this.upstream !== null && this.upstreamSymbols.has(symbol);
  }

  private statusMessage(): ServerMessage {
    return { type: "status", market: marketOpen(this.env) ? "open" : "closed", feed: this.feed };
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // 닫히는 중인 소켓
    }
  }

  private clients(except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws !== except);
  }

  /** 브라우저 구독 상태에 맞춰 상류(KIS/모의) 구독을 맞춘다. */
  private async reconcile(except?: WebSocket): Promise<void> {
    const desired = new Set<string>();
    for (const ws of this.clients(except)) {
      const att = ws.deserializeAttachment() as ClientAttachment | null;
      att?.symbols.forEach((s) => desired.add(s));
    }
    this.active = desired;

    const open = marketOpen(this.env);
    // 장 시작/마감이 바뀌면 알린다. (새 연결에는 fetch()에서 이미 상태를 보냈다)
    if (open !== this.lastOpen) {
      const changed = this.lastOpen !== null;
      this.lastOpen = open;
      if (changed) {
        const status = this.statusMessage();
        this.clients(except).forEach((ws) => this.send(ws, status));
      }
    }

    if (this.feed === "mock") {
      if (desired.size > 0 && !this.mockTimer) {
        this.mockTimer = setInterval(() => {
          this.active.forEach((s) => this.onQuote(this.mock.step(s)));
        }, 1_000);
      } else if (desired.size === 0 && this.mockTimer) {
        clearInterval(this.mockTimer);
        this.mockTimer = null;
      }
      return;
    }

    if (!open || desired.size === 0) {
      this.closeUpstream();
      return;
    }
    try {
      await this.ensureUpstream();
    } catch (err) {
      console.error("KIS realtime connect failed", err);
      return;
    }
    const ws = this.upstream!;
    for (const s of [...this.upstreamSymbols]) {
      if (!desired.has(s)) {
        ws.send(subscriptionMessage(this.approvalKey, s, false));
        this.upstreamSymbols.delete(s);
      }
    }
    for (const s of desired) {
      if (this.upstreamSymbols.has(s)) continue;
      if (this.upstreamSymbols.size >= MAX_REALTIME_SUBSCRIPTIONS) break;
      ws.send(subscriptionMessage(this.approvalKey, s, true));
      this.upstreamSymbols.add(s);
    }
  }

  private ensureUpstream(): Promise<void> {
    if (this.upstream) return Promise.resolve();
    if (this.upstreamConnecting) return this.upstreamConnecting;
    this.upstreamConnecting = (async () => {
      this.approvalKey = await this.kis!.approvalKey();
      const ws = await this.kis!.connectRealtime();
      ws.addEventListener("message", (e) => {
        if (typeof e.data === "string") this.onUpstreamMessage(ws, e.data);
      });
      const onGone = () => {
        if (this.upstream === ws) {
          this.upstream = null;
          this.upstreamSymbols.clear();
        }
      };
      ws.addEventListener("close", onGone);
      ws.addEventListener("error", onGone);
      this.upstream = ws;
      this.upstreamSymbols.clear();
    })().finally(() => {
      this.upstreamConnecting = null;
    });
    return this.upstreamConnecting;
  }

  private closeUpstream(): void {
    if (!this.upstream) return;
    try {
      this.upstream.close(1000, "idle");
    } catch {
      // ignore
    }
    this.upstream = null;
    this.upstreamSymbols.clear();
  }

  private onUpstreamMessage(ws: WebSocket, raw: string): void {
    const msg = parseKisMessage(raw);
    switch (msg.kind) {
      case "trades":
        for (const t of msg.trades) {
          this.onQuote({
            symbol: t.symbol,
            price: t.price,
            change: t.change,
            rate: t.rate,
            open: t.open,
            high: t.high,
            low: t.low,
            volume: t.volume,
            at: Date.now(),
          });
        }
        break;
      case "pingpong":
        // 공식 샘플과 같이 받은 PINGPONG 메시지를 그대로 돌려준다.
        ws.send(raw);
        break;
      case "system":
        if (!msg.ok) console.warn("KIS realtime", msg.trId, msg.message);
        break;
    }
  }

  /** 실시간 등록이 안 된 종목(등록 한도 초과, 연결 실패)은 알람 주기로 REST 시세를 밀어 준다. */
  private async refreshNonLive(): Promise<void> {
    if (this.feed !== "kis" || !marketOpen(this.env)) return;
    const targets = [...this.active].filter((s) => !this.isLive(s)).slice(0, 10);
    for (const s of targets) {
      try {
        this.onQuote(await this.kis!.quote(s));
      } catch (err) {
        console.error("KIS quote failed", s, err);
      }
    }
  }

  private onQuote(q: Quote): void {
    this.quotes.set(q.symbol, q);
    let list = this.ticks.get(q.symbol);
    if (!list) {
      list = [];
      this.ticks.set(q.symbol, list);
    }
    const t = Math.floor(q.at / 1000);
    const last = list[list.length - 1];
    if (last && last.t === t) last.p = q.price;
    else list.push({ t, p: q.price });
    if (list.length > TICK_HISTORY) list.splice(0, list.length - TICK_HISTORY);

    this.dirty.add(q.symbol);
    if (!this.flushTimer) {
      const wait = Math.max(0, this.lastFlushAt + FLUSH_INTERVAL_MS - Date.now());
      this.flushTimer = setTimeout(() => this.flush(), wait);
    }
  }

  private flush(): void {
    this.flushTimer = null;
    this.lastFlushAt = Date.now();
    if (this.dirty.size === 0) return;
    const messages = new Map<string, string>();
    for (const s of this.dirty) {
      const q = this.quotes.get(s);
      if (!q) continue;
      const msg: ServerMessage = {
        type: "tick",
        s,
        p: q.price,
        c: q.change,
        r: q.rate,
        o: q.open,
        h: q.high,
        l: q.low,
        v: q.volume,
        t: Math.floor(q.at / 1000),
      };
      messages.set(s, JSON.stringify(msg));
    }
    this.dirty.clear();
    for (const ws of this.clients()) {
      const att = ws.deserializeAttachment() as ClientAttachment | null;
      for (const s of att?.symbols ?? []) {
        const m = messages.get(s);
        if (m) {
          try {
            ws.send(m);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  private async sendSnapshot(ws: WebSocket, symbol: string): Promise<void> {
    try {
      const quote = await this.getQuote(symbol);
      this.send(ws, {
        type: "snapshot",
        quote,
        ticks: this.ticks.get(symbol) ?? [],
        live: this.isLive(symbol),
      });
    } catch (err) {
      console.error("snapshot failed", symbol, err);
      this.send(ws, { type: "error", message: "시세를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." });
    }
  }
}
