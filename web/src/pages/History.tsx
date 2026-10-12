import { useEffect, useState } from "react";
import type { OrderRow } from "../../../shared/protocol";
import { api } from "../api";
import { dateTime, num, won } from "../format";

const SIDE_LABEL = { buy: "매수", sell: "매도", liquidation: "강제청산" } as const;

export function History() {
  const [orders, setOrders] = useState<(OrderRow & { name: string | null })[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .orders()
      .then((r) => setOrders(r.orders))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main>
      <section className="card">
        <h1>거래 내역</h1>
        {error && <p className="error">{error}</p>}
        {orders && orders.length === 0 && <p className="muted">아직 거래가 없습니다.</p>}
        {orders && orders.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>종목</th>
                  <th>구분</th>
                  <th className="num">수량</th>
                  <th className="num">체결가</th>
                  <th className="num">금액</th>
                  <th className="num">수수료·세금</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{dateTime(o.createdAt)}</td>
                    <td>{o.name ?? o.symbol}</td>
                    <td className={o.side === "buy" ? "up" : "down"}>{SIDE_LABEL[o.side]}</td>
                    <td className="num">{num(o.quantity)}</td>
                    <td className="num">{won(o.price)}</td>
                    <td className="num">{won(o.amount)}</td>
                    <td className="num">{won(o.fee + o.tax)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
