import {
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  createChart,
} from "lightweight-charts";
import { useEffect, useRef } from "react";
import type { Candle, Quote, TickPoint } from "../../../shared/protocol";
import { kstToday } from "../format";

const UP = "#f04452";
const DOWN = "#3182f6";
const KST_OFFSET_SEC = 9 * 3600;

function baseOptions(el: HTMLElement) {
  const styles = getComputedStyle(el);
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "transparent" },
      textColor: styles.getPropertyValue("--muted").trim() || "#8b95a1",
      fontFamily: "inherit",
    },
    grid: {
      vertLines: { color: styles.getPropertyValue("--grid").trim() || "#2a2f36" },
      horzLines: { color: styles.getPropertyValue("--grid").trim() || "#2a2f36" },
    },
    rightPriceScale: { borderVisible: false },
    timeScale: { borderVisible: false },
    localization: { locale: "ko-KR", priceFormatter: (p: number) => Math.round(p).toLocaleString("ko-KR") },
  } as const;
}

const WON_FORMAT = { type: "price", precision: 0, minMove: 1 } as const;

function areaColors(up: boolean) {
  return up
    ? { lineColor: UP, topColor: "rgba(240, 68, 82, 0.28)", bottomColor: "rgba(240, 68, 82, 0)" }
    : { lineColor: DOWN, topColor: "rgba(49, 130, 246, 0.28)", bottomColor: "rgba(49, 130, 246, 0)" };
}

/** 일봉 차트. 실시간 시세가 오면 오늘 봉을 갱신한다. */
export function DailyChart({ candles, quote, marketOpen }: { candles: Candle[]; quote: Quote | null; marketOpen: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const last = useRef<Candle | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chart.current = createChart(ref.current, baseOptions(ref.current));
    series.current = chart.current.addCandlestickSeries({
      priceFormat: WON_FORMAT,
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    return () => {
      chart.current?.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    series.current?.setData(candles.map((c) => ({ time: c.date, open: c.open, high: c.high, low: c.low, close: c.close })));
    last.current = candles[candles.length - 1] ?? null;
    chart.current?.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    if (!quote || !series.current || !last.current) return;
    const today = kstToday();
    // 오늘 봉이 이미 있거나, 장중이라 오늘 봉을 새로 만들어야 할 때만 갱신한다.
    if (last.current.date !== today && !(marketOpen && last.current.date < today)) return;
    series.current.update({ time: today, open: quote.open, high: quote.high, low: quote.low, close: quote.price });
  }, [quote, marketOpen]);

  return <div className="chart" ref={ref} />;
}

/** 실시간 틱 라인 차트 (전일 대비 상승이면 빨강, 하락이면 파랑) */
export function TickChart({ ticks, up }: { ticks: TickPoint[]; up: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Area"> | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const opts = baseOptions(ref.current);
    chart.current = createChart(ref.current, { ...opts, timeScale: { ...opts.timeScale, timeVisible: true, secondsVisible: true } });
    series.current = chart.current.addAreaSeries({ priceFormat: WON_FORMAT, lineWidth: 2 });
    return () => {
      chart.current?.remove();
      chart.current = null;
      series.current = null;
    };
  }, []);

  useEffect(() => {
    series.current?.applyOptions(areaColors(up));
  }, [up]);

  useEffect(() => {
    // lightweight-charts는 UTC로 표시하므로 KST로 보이도록 9시간을 더한다.
    series.current?.setData(ticks.map((t) => ({ time: (t.t + KST_OFFSET_SEC) as UTCTimestamp, value: t.p })));
  }, [ticks]);

  return (
    <div className="chart-wrap">
      <div className="chart" ref={ref} />
      {ticks.length === 0 && <div className="chart-empty">실시간 체결을 기다리는 중…</div>}
    </div>
  );
}

/**
 * 미니게임용 차트. 결과가 나오면 뒤쪽 reveal개 봉(정답 구간)을 노란 테두리로 덧붙인다.
 * 날짜를 숨기는 난이도는 순서만 보이도록 가짜 시간축을 쓴다.
 */
export function GameChart({
  candles,
  reveal,
  datesVisible,
}: {
  candles: Candle[];
  reveal: number;
  datesVisible: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const opts = baseOptions(ref.current);
    const c = createChart(ref.current, {
      ...opts,
      timeScale: { ...opts.timeScale, visible: datesVisible },
      localization: datesVisible ? opts.localization : { priceFormatter: (p: number) => p.toFixed(1) },
      handleScroll: false,
      handleScale: false,
    });
    const s = c.addCandlestickSeries({
      priceFormat: datesVisible ? WON_FORMAT : { type: "price", precision: 1, minMove: 0.01 },
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
    });
    const day = 86_400;
    const timeOf = (i: number) => (datesVisible ? candles[i].date : ((946_684_800 + i * day) as UTCTimestamp));
    const revealFrom = candles.length - reveal;
    s.setData(
      candles.map((k, i) => {
        const point = { time: timeOf(i), open: k.open, high: k.high, low: k.low, close: k.close };
        return i >= revealFrom ? { ...point, borderVisible: true, borderColor: "#ffd43b" } : point;
      }),
    );
    if (reveal > 0) {
      s.setMarkers([{ time: timeOf(revealFrom), position: "aboveBar", color: "#ffd43b", shape: "arrowDown", text: "정답 구간" }]);
    }
    c.timeScale().fitContent();
    return () => c.remove();
  }, [candles, reveal, datesVisible]);

  return <div className="chart game-chart" ref={ref} />;
}
