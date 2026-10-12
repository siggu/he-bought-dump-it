import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse, PublicBadge } from "../../../shared/protocol";
import { Nickname } from "../components/Badge";
import { api } from "../api";
import { useAuth, useMe } from "../auth";
import { ChartPanel } from "../components/ChartPanel";
import { OrderPanel } from "../components/OrderPanel";
import { QuoteHeader } from "../components/QuoteHeader";
import { dateTime, num, pct, signed, trend, won } from "../format";
import { useRealtime } from "../realtime";

// worker/rules.ts 의 BANKRUPT_FLOOR
const BANKRUPT_FLOOR = 100_000;

export function Dashboard() {
  const me = useMe();
  const { setMe, refresh } = useAuth();
  const symbol = me.user.mainSymbol!;
  const rt = useRealtime(symbol);
  const [toast, setToast] = useState<string | null>(null);
  const quote = rt.quote ?? me.quote;
  const price = quote?.price ?? null;
  const marketOpen = rt.status.market ? rt.status.market === "open" : me.market.open;

  // 실시간 가격으로 계산한 총자산이 파산 기준 아래로 내려가면 서버에 재평가를 요청한다.
  const qty = me.holding?.quantity ?? 0;
  const evaluation = qty * (price ?? 0);
  const total = me.user.cash + evaluation;
  const cost = qty * (me.holding?.avgPrice ?? 0);
  const profit = evaluation - cost;
  const bankruptLine = Math.max(price ?? 0, BANKRUPT_FLOOR);
  const lastCheck = useRef(0);
  useEffect(() => {
    if (me.user.isBankrupt || price === null || total >= bankruptLine) return;
    if (Date.now() - lastCheck.current < 10_000) return;
    lastCheck.current = Date.now();
    refresh().catch(() => undefined);
  }, [me.user.isBankrupt, price, total, bankruptLine, refresh]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onOrderDone = (next: MeResponse, message: string) => {
    setMe(next);
    setToast(message);
  };

  return (
    <main>
      {me.user.isBankrupt && (
        <div className="banner bankrupt">
          <div>
            <strong>💸 파산했습니다!</strong> 보유 주식은 강제 청산됐고 매매가 잠겼어요. (누적 파산 {me.user.bankruptCount}회)
            <br />
            현금 {won(me.thresholds.recovery)} 이상을 모으면 다시 매매할 수 있습니다.
          </div>
          <Link className="button primary" to="/game">
            미니게임으로 재기하기
          </Link>
        </div>
      )}
      <div className="grid">
        <div className="col-main">
          <section className="card">
            <QuoteHeader
              name={me.user.mainName ?? symbol}
              symbol={symbol}
              quote={quote}
              live={rt.live}
              badge="메인 종목"
            />
          </section>
          <ChartPanel symbol={symbol} quote={quote} ticks={rt.ticks} marketOpen={marketOpen} />
        </div>
        <div className="col-side">
          <OrderPanel me={me} price={price} onDone={onOrderDone} />
          <section className="card portfolio">
            <h2>내 계좌</h2>
            <dl>
              <div className="total">
                <dt>총자산</dt>
                <dd>{won(total)}</dd>
              </div>
              <div>
                <dt>현금</dt>
                <dd>{won(me.user.cash)}</dd>
              </div>
              <div>
                <dt>보유</dt>
                <dd>
                  {num(qty)}주 {qty > 0 && <span className="muted">(평단 {won(me.holding!.avgPrice)})</span>}
                </dd>
              </div>
              <div>
                <dt>평가금액</dt>
                <dd>{won(evaluation)}</dd>
              </div>
              <div>
                <dt>평가손익</dt>
                <dd className={trend(profit)}>
                  {signed(profit)}원 {cost > 0 && `(${pct((profit / cost) * 100)})`}
                </dd>
              </div>
              <div>
                <dt>파산 기준</dt>
                <dd className="muted">총자산 {won(bankruptLine)} 미만</dd>
              </div>
            </dl>
          </section>
          <SalaryCard />
          <HallOfFame />
        </div>
      </div>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      <p className="muted small center">
        {me.market.feed === "mock" ? "모의 시세" : "한국투자증권 시세"} · 마지막 갱신 {quote ? dateTime(quote.at) : "-"}
      </p>
    </main>
  );
}

function SalaryCard() {
  const me = useMe();
  const { setMe } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      setMe(await api.salary());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card salary">
      <div>
        <h2>💰 월급</h2>
        <p className="muted small">매달 한 번 {won(me.user.salaryAmount)}을 받을 수 있어요.</p>
      </div>
      <button type="button" className="primary" disabled={!me.user.salaryAvailable || busy} onClick={claim}>
        {me.user.salaryAvailable ? "월급 받기" : "이번 달 수령 완료"}
      </button>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function HallOfFame() {
  const [ranking, setRanking] = useState<
    { nickname: string; bankruptCount: number; featuredBadge: PublicBadge | null }[] | null
  >(null);
  useEffect(() => {
    api
      .hallOfFame()
      .then((r) => setRanking(r.ranking))
      .catch(() => setRanking([]));
  }, []);
  if (!ranking || ranking.length === 0) return null;
  return (
    <section className="card">
      <h2>🏆 파산 명예의 전당</h2>
      <ol className="ranking">
        {ranking.map((r) => (
          <li key={r.nickname}>
            <Nickname nickname={r.nickname} badge={r.featuredBadge} />
            <span className="muted">{r.bankruptCount}회</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
