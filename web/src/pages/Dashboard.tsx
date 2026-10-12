import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicBadge, StockInfo } from "../../../shared/protocol";
import { api } from "../api";
import { useAuth, useMe } from "../auth";
import { Nickname } from "../components/Badge";
import { BankruptRule } from "../components/BankruptRule";
import { FavoriteList } from "../components/FavoriteList";
import { num, pct, signed, trend, won } from "../format";

export const POPULAR: StockInfo[] = [
  { symbol: "005930", name: "삼성전자", market: "KOSPI" },
  { symbol: "000660", name: "SK하이닉스", market: "KOSPI" },
  { symbol: "373220", name: "LG에너지솔루션", market: "KOSPI" },
  { symbol: "005380", name: "현대차", market: "KOSPI" },
  { symbol: "035420", name: "NAVER", market: "KOSPI" },
  { symbol: "035720", name: "카카오", market: "KOSPI" },
  { symbol: "068270", name: "셀트리온", market: "KOSPI" },
  { symbol: "247540", name: "에코프로비엠", market: "KOSDAQ" },
];

/** 내 계좌: 보유 종목은 1분 캐시 시세로 평가하고, 실시간 시세는 종목 화면에서만 받는다. */
export function Dashboard() {
  const me = useMe();
  const { refresh } = useAuth();

  // 화면이 보이는 동안 1분마다 평가금액 갱신 (서버 캐시 공유라 KIS 호출은 늘지 않는다)
  useEffect(() => {
    const t = window.setInterval(() => {
      if (!document.hidden) refresh().catch(() => undefined);
    }, 60_000);
    return () => window.clearInterval(t);
  }, [refresh]);

  return (
    <main>
      {me.user.isBankrupt && (
        <div className="banner bankrupt">
          <div>
            <strong>💸 파산했습니다!</strong> 총자산이 {won(me.thresholds.bankrupt)} 미만이 되어 보유 주식이 모두 강제
            매도됐고 매매가 잠겼어요. (누적 파산 {me.user.bankruptCount}회)
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
          <section className="card summary">
            <h1>내 계좌</h1>
            <dl className="summary-grid">
              <div className="total">
                <dt>총자산</dt>
                <dd>{won(me.totals.total)}</dd>
              </div>
              <div>
                <dt>현금</dt>
                <dd>{won(me.user.cash)}</dd>
              </div>
              <div>
                <dt>주식 평가금액</dt>
                <dd>{won(me.totals.evaluation)}</dd>
              </div>
              <div>
                <dt>평가손익</dt>
                <dd className={trend(me.totals.profit)}>
                  {signed(me.totals.profit)}원 ({pct(me.totals.profitRate)})
                </dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <h2>보유 종목 {me.holdings.length > 0 && <span className="muted small">{me.holdings.length}종목</span>}</h2>
            {me.holdings.length === 0 ? (
              <p className="muted">아직 보유한 주식이 없어요. 위 검색창이나 아래 인기 종목에서 종목을 골라 매수해 보세요.</p>
            ) : (
              <div className="table-wrap">
                <table className="holdings">
                  <thead>
                    <tr>
                      <th>종목</th>
                      <th className="num">수량</th>
                      <th className="num">평균 단가</th>
                      <th className="num">현재가</th>
                      <th className="num">평가금액</th>
                      <th className="num">손익</th>
                    </tr>
                  </thead>
                  <tbody>
                    {me.holdings.map((h) => (
                      <tr key={h.symbol}>
                        <td>
                          <Link to={`/stocks/${h.symbol}`}>{h.name}</Link>
                        </td>
                        <td className="num">{num(h.quantity)}</td>
                        <td className="num">{num(h.avgPrice)}</td>
                        <td className={`num ${trend(h.rate ?? 0)}`}>{h.price !== null ? num(h.price) : "-"}</td>
                        <td className="num">{num(h.evaluation)}</td>
                        <td className={`num ${trend(h.profit)}`}>
                          {signed(h.profit)}
                          <br />
                          <small>{pct(h.profitRate)}</small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="muted small">평가금액은 1분마다 갱신돼요. 실시간 시세는 종목을 눌러 들어가면 그 종목만 받아요.</p>
          </section>

          {me.favorites.length > 0 && (
            <section className="card">
              <h2>★ 관심 종목</h2>
              <FavoriteList />
            </section>
          )}

          <section className="card">
            <h2>인기 종목</h2>
            <div className="chips">
              {POPULAR.map((s) => (
                <Link key={s.symbol} className="chip" to={`/stocks/${s.symbol}`}>
                  {s.name}
                </Link>
              ))}
            </div>
          </section>
        </div>
        <div className="col-side">
          <BankruptRule me={me} />
          <SalaryCard />
          <Link to="/arena" className="card arena-link">
            <strong>🐜 개미 광장</strong>
            <span className="muted small">블라인드 박스 교환 · 기습 털기 · 1:1 수익률 맞짱</span>
          </Link>
          <HallOfFame />
        </div>
      </div>
      <p className="muted small center">{me.market.feed === "mock" ? "모의 시세" : "한국투자증권 시세"}</p>
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
