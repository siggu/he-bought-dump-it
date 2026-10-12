import { useEffect, useState } from "react";
import type { Candle, Quote, TickPoint } from "../../../shared/protocol";
import { api } from "../api";
import { DailyChart, TickChart } from "./PriceChart";

export function ChartPanel({
  symbol,
  quote,
  ticks,
  marketOpen,
}: {
  symbol: string;
  quote: Quote | null;
  ticks: TickPoint[];
  marketOpen: boolean;
}) {
  const [mode, setMode] = useState<"tick" | "daily">("tick");
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCandles(null);
    setError(null);
    api
      .daily(symbol)
      .then((r) => setCandles(r.candles))
      .catch((e: Error) => setError(e.message));
  }, [symbol]);

  return (
    <section className="card chart-card">
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={mode === "tick"} onClick={() => setMode("tick")}>
          실시간
        </button>
        <button type="button" role="tab" aria-selected={mode === "daily"} onClick={() => setMode("daily")}>
          일봉
        </button>
      </div>
      {mode === "tick" ? (
        <TickChart ticks={ticks} up={(quote?.change ?? 0) >= 0} />
      ) : candles ? (
        <DailyChart candles={candles} quote={quote} marketOpen={marketOpen} />
      ) : (
        <div className="chart chart-empty">{error ?? "차트 불러오는 중…"}</div>
      )}
    </section>
  );
}
