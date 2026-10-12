import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import type { StockInfo } from "../../../shared/protocol";
import { api } from "../api";
import { useMe } from "../auth";
import { ChartPanel } from "../components/ChartPanel";
import { QuoteHeader } from "../components/QuoteHeader";
import { useRealtime } from "../realtime";

/** 검색한 종목: 실시간 시세 조회 전용 */
export function StockDetail() {
  const me = useMe();
  const symbol = (useParams().symbol ?? "").toUpperCase();
  const [stock, setStock] = useState<StockInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isMain = symbol === me.user.mainSymbol;
  const rt = useRealtime(isMain ? null : symbol);

  useEffect(() => {
    setStock(null);
    setError(null);
    api
      .stock(symbol)
      .then((r) => setStock(r.stock))
      .catch((e: Error) => setError(e.message));
  }, [symbol]);

  if (isMain) return <Navigate to="/" replace />;
  if (error) {
    return (
      <main className="narrow">
        <section className="card">
          <p className="error">{error}</p>
          <Link to="/">대시보드로</Link>
        </section>
      </main>
    );
  }

  const canChange = (me.holding?.quantity ?? 0) === 0 && me.user.mainChangeAvailableAt === null;

  return (
    <main>
      <div className="grid">
        <div className="col-main">
          <section className="card">
            <QuoteHeader name={stock?.name ?? symbol} symbol={symbol} quote={rt.quote} live={rt.live} badge="조회 전용" />
          </section>
          <ChartPanel
            symbol={symbol}
            quote={rt.quote}
            ticks={rt.ticks}
            marketOpen={rt.status.market === "open"}
          />
          {rt.status.error && <p className="error">{rt.status.error}</p>}
        </div>
        <div className="col-side">
          <section className="card">
            <h2>이 종목은 매매할 수 없어요</h2>
            <p className="muted">
              계정당 한 종목만 사고팔 수 있습니다. 현재 메인 종목은 <strong>{me.user.mainName}</strong>입니다.
            </p>
            {canChange ? (
              <Link className="button" to="/settings/main">
                메인 종목 바꾸러 가기
              </Link>
            ) : (
              <p className="muted small">
                {(me.holding?.quantity ?? 0) > 0
                  ? "메인 종목을 바꾸려면 보유 주식을 모두 매도해야 합니다."
                  : `메인 종목은 ${new Date(me.user.mainChangeAvailableAt!).toLocaleDateString("ko-KR")} 이후 바꿀 수 있습니다.`}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
