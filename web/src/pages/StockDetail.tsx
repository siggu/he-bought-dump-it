import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MeResponse, StockInfo } from "../../../shared/protocol";
import { api } from "../api";
import { useAuth, useMe } from "../auth";
import { ChartPanel } from "../components/ChartPanel";
import { OrderPanel } from "../components/OrderPanel";
import { QuoteHeader } from "../components/QuoteHeader";
import { num, pct, signed, trend, won } from "../format";
import { useRealtime } from "../realtime";

/** 종목 화면: 이 화면에 있는 동안만 이 종목의 실시간 시세를 받는다. */
export function StockDetail() {
  const me = useMe();
  const { setMe } = useAuth();
  const symbol = (useParams().symbol ?? "").toUpperCase();
  const [stock, setStock] = useState<StockInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const rt = useRealtime(symbol);
  const holding = me.holdings.find((h) => h.symbol === symbol) ?? null;
  const price = rt.quote?.price ?? holding?.price ?? null;

  useEffect(() => {
    setStock(null);
    setError(null);
    api
      .stock(symbol)
      .then((r) => setStock(r.stock))
      .catch((e: Error) => setError(e.message));
  }, [symbol]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  if (error) {
    return (
      <main className="narrow">
        <section className="card">
          <p className="error">{error}</p>
          <Link to="/">내 계좌로</Link>
        </section>
      </main>
    );
  }

  const onDone = (next: MeResponse, message: string) => {
    setMe(next);
    setToast(message);
  };
  const evaluation = holding && price ? holding.quantity * price : 0;
  const profit = holding && price ? evaluation - holding.quantity * holding.avgPrice : 0;

  return (
    <main>
      <div className="grid">
        <div className="col-main">
          <section className="card">
            <QuoteHeader name={stock?.name ?? symbol} symbol={symbol} quote={rt.quote} live={rt.live} badge={stock?.market} />
          </section>
          <ChartPanel symbol={symbol} quote={rt.quote} ticks={rt.ticks} marketOpen={rt.status.market === "open"} />
          {rt.status.error && <p className="error">{rt.status.error}</p>}
        </div>
        <div className="col-side">
          <OrderPanel me={me} symbol={symbol} price={price} onDone={onDone} />
          <section className="card portfolio">
            <h2>이 종목 보유 현황</h2>
            {holding ? (
              <dl>
                <div>
                  <dt>보유</dt>
                  <dd>{num(holding.quantity)}주</dd>
                </div>
                <div>
                  <dt>평균 단가</dt>
                  <dd>{won(holding.avgPrice)}</dd>
                </div>
                <div>
                  <dt>평가금액</dt>
                  <dd>{won(evaluation)}</dd>
                </div>
                <div>
                  <dt>평가손익</dt>
                  <dd className={trend(profit)}>
                    {signed(profit)}원 ({pct(holding.avgPrice ? (profit / (holding.quantity * holding.avgPrice)) * 100 : 0)})
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="muted small">보유하고 있지 않아요.</p>
            )}
            <p className="muted small">주문 가능 현금 {won(me.user.cash)}</p>
          </section>
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </main>
  );
}
