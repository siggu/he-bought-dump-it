// 실시간 시세 WebSocket 클라이언트 (앱 전체에서 연결 1개를 공유).
// - 화면에서 쓰는 종목만 구독하고, 화면을 떠나면 바로 해제한다.
// - 탭이 숨겨진 채 15초가 지나면 연결을 끊고, 다시 보이면 재연결해 스냅샷부터 받는다.

import { useEffect, useState } from "react";
import type { FeedKind, Quote, ServerMessage, TickPoint } from "../../shared/protocol";

export interface SymbolState {
  quote: Quote | null;
  ticks: TickPoint[];
  live: boolean;
}

interface Status {
  market: "open" | "closed" | null;
  feed: FeedKind | null;
  connected: boolean;
  error: string | null;
}

type Listener = () => void;

const HIDDEN_DISCONNECT_MS = 15_000;
const MAX_TICKS = 600;

class RealtimeClient {
  private ws: WebSocket | null = null;
  private refs = new Map<string, number>();
  private states = new Map<string, SymbolState>();
  private listeners = new Set<Listener>();
  private retry = 0;
  private retryTimer: number | null = null;
  private hiddenTimer: number | null = null;
  status: Status = { market: null, feed: null, connected: false, error: null };

  constructor() {
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        this.hiddenTimer = window.setTimeout(() => this.disconnect(), HIDDEN_DISCONNECT_MS);
      } else {
        if (this.hiddenTimer) window.clearTimeout(this.hiddenTimer);
        this.hiddenTimer = null;
        if (this.refs.size > 0) this.connect();
      }
    });
  }

  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  state(symbol: string): SymbolState {
    return this.states.get(symbol) ?? { quote: null, ticks: [], live: false };
  }

  subscribe(symbol: string): () => void {
    const n = this.refs.get(symbol) ?? 0;
    this.refs.set(symbol, n + 1);
    if (n === 0) {
      if (this.ws?.readyState === WebSocket.OPEN) this.send({ op: "sub", symbol });
      else this.connect();
    }
    return () => {
      const left = (this.refs.get(symbol) ?? 1) - 1;
      if (left > 0) {
        this.refs.set(symbol, left);
        return;
      }
      this.refs.delete(symbol);
      this.states.delete(symbol);
      this.send({ op: "unsub", symbol });
      if (this.refs.size === 0) this.disconnect();
    };
  }

  private send(msg: { op: "sub" | "unsub"; symbol: string }): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect(): void {
    if (this.ws || document.hidden) return;
    if (this.retryTimer) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.status = { ...this.status, connected: true, error: null };
      this.refs.forEach((_, symbol) => this.send({ op: "sub", symbol }));
      this.emit();
    };
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)) as ServerMessage);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.status = { ...this.status, connected: false };
      this.emit();
      if (this.refs.size > 0 && !document.hidden) {
        const delay = Math.min(30_000, 1_000 * 2 ** this.retry++);
        this.retryTimer = window.setTimeout(() => this.connect(), delay);
      }
    };
  }

  private disconnect(): void {
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.status = { ...this.status, connected: false };
    this.emit();
  }

  private handle(msg: ServerMessage): void {
    switch (msg.type) {
      case "status":
        this.status = { ...this.status, market: msg.market, feed: msg.feed };
        break;
      case "snapshot":
        if (!this.refs.has(msg.quote.symbol)) return;
        this.states.set(msg.quote.symbol, { quote: msg.quote, ticks: msg.ticks, live: msg.live });
        break;
      case "tick": {
        const prev = this.states.get(msg.s);
        if (!prev) return;
        const quote: Quote = {
          symbol: msg.s,
          price: msg.p,
          change: msg.c,
          rate: msg.r,
          open: msg.o,
          high: msg.h,
          low: msg.l,
          volume: msg.v,
          at: msg.t * 1000,
        };
        const ticks = prev.ticks.slice(-MAX_TICKS + 1);
        if (ticks.length > 0 && ticks[ticks.length - 1].t >= msg.t) ticks[ticks.length - 1] = { t: ticks[ticks.length - 1].t, p: msg.p };
        else ticks.push({ t: msg.t, p: msg.p });
        this.states.set(msg.s, { ...prev, quote, ticks });
        break;
      }
      case "error":
        this.status = { ...this.status, error: msg.message };
        break;
    }
    this.emit();
  }
}

export const realtime = new RealtimeClient();

/** 종목 실시간 시세 구독 훅. symbol이 null이면 구독하지 않는다. */
export function useRealtime(symbol: string | null): SymbolState & { status: Status } {
  const [, force] = useState(0);
  useEffect(() => realtime.onChange(() => force((n) => n + 1)), []);
  useEffect(() => (symbol ? realtime.subscribe(symbol) : undefined), [symbol]);
  return { ...(symbol ? realtime.state(symbol) : { quote: null, ticks: [], live: false }), status: realtime.status };
}
