import { useState } from "react";
import type { MeResponse } from "../../../shared/protocol";
import { api } from "../api";
import { num, won } from "../format";

// 서버(worker/rules.ts)와 같은 값. 표시용 예상 금액 계산에만 쓴다.
const FEE_RATE = 0.00015;
const SELL_TAX_RATE = 0.002;

export function OrderPanel({
  me,
  price,
  onDone,
}: {
  me: MeResponse;
  price: number | null;
  onDone: (me: MeResponse, message: string) => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const quantity = Number.parseInt(qty, 10) || 0;
  const held = me.holding?.quantity ?? 0;
  const maxBuy = price ? Math.floor(me.user.cash / (price * (1 + FEE_RATE))) : 0;
  const max = side === "buy" ? maxBuy : held;
  const amount = (price ?? 0) * quantity;
  const fee = Math.floor(amount * FEE_RATE);
  const tax = side === "sell" ? Math.floor(amount * SELL_TAX_RATE) : 0;
  const total = side === "buy" ? amount + fee : amount - fee - tax;

  const disabled =
    busy || !price || quantity < 1 || quantity > max || me.user.isBankrupt || !me.market.open;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.order(side, quantity);
      setQty("");
      onDone(
        r.me,
        `${side === "buy" ? "매수" : "매도"} 체결: ${num(r.result.quantity)}주 × ${won(r.result.price)}`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card order">
      <div className="tabs order-tabs" role="tablist">
        <button type="button" role="tab" className="buy" aria-selected={side === "buy"} onClick={() => setSide("buy")}>
          매수
        </button>
        <button type="button" role="tab" className="sell" aria-selected={side === "sell"} onClick={() => setSide("sell")}>
          매도
        </button>
      </div>
      <div className="field">
        <label htmlFor="qty">수량</label>
        <div className="qty">
          <input
            id="qty"
            inputMode="numeric"
            value={qty}
            placeholder="0"
            onChange={(e) => setQty(e.target.value.replace(/\D/g, "").slice(0, 7))}
          />
          <span>주</span>
        </div>
        <div className="qty-presets">
          {[0.1, 0.25, 0.5, 1].map((r) => (
            <button key={r} type="button" onClick={() => setQty(String(Math.floor(max * r)))} disabled={max === 0}>
              {r === 1 ? "최대" : `${r * 100}%`}
            </button>
          ))}
        </div>
        <p className="muted small">
          {side === "buy" ? `최대 ${num(maxBuy)}주 매수 가능` : `보유 ${num(held)}주`}
        </p>
      </div>
      <dl className="order-summary">
        <div>
          <dt>시장가(현재가)</dt>
          <dd>{price ? won(price) : "-"}</dd>
        </div>
        <div>
          <dt>수수료 (0.015%)</dt>
          <dd>{won(fee)}</dd>
        </div>
        {side === "sell" && (
          <div>
            <dt>거래세 (0.20%)</dt>
            <dd>{won(tax)}</dd>
          </div>
        )}
        <div className="total">
          <dt>{side === "buy" ? "총 결제 예상" : "총 입금 예상"}</dt>
          <dd>{won(Math.max(0, total))}</dd>
        </div>
      </dl>
      {error && <p className="error">{error}</p>}
      {!me.market.open && <p className="muted small">장 운영 시간(평일 09:00~15:30)에만 주문할 수 있습니다.</p>}
      <button type="button" className={`primary ${side}`} disabled={disabled} onClick={submit}>
        {busy ? "주문 중…" : side === "buy" ? "시장가 매수" : "시장가 매도"}
      </button>
    </section>
  );
}
