import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { StockInfo } from "../../../shared/protocol";
import { api } from "../api";
import { useAuth, useMe } from "../auth";
import { StockSearch } from "../components/StockSearch";

const POPULAR: StockInfo[] = [
  { symbol: "005930", name: "삼성전자", market: "KOSPI" },
  { symbol: "000660", name: "SK하이닉스", market: "KOSPI" },
  { symbol: "373220", name: "LG에너지솔루션", market: "KOSPI" },
  { symbol: "005380", name: "현대차", market: "KOSPI" },
  { symbol: "035420", name: "NAVER", market: "KOSPI" },
  { symbol: "035720", name: "카카오", market: "KOSPI" },
  { symbol: "068270", name: "셀트리온", market: "KOSPI" },
  { symbol: "247540", name: "에코프로비엠", market: "KOSDAQ" },
];

export function Onboarding() {
  const me = useMe();
  const { setMe } = useAuth();
  const navigate = useNavigate();
  const [picked, setPicked] = useState<StockInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changing = me.user.mainSymbol !== null;

  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      setMe(await api.setMainSymbol(picked.symbol));
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <section className="card">
        <h1>{changing ? "메인 종목 변경" : "올인할 종목을 고르세요"}</h1>
        <p className="muted">
          계정당 <strong>한 종목만</strong> 사고팔 수 있습니다. 다른 종목은 검색해서 실시간 시세만 볼 수 있어요.
          <br />
          메인 종목은 보유 주식이 없을 때만, 7일에 한 번 바꿀 수 있습니다.
        </p>
        <StockSearch onSelect={setPicked} autoFocus />
        <div className="chips">
          {POPULAR.map((s) => (
            <button
              key={s.symbol}
              type="button"
              className={picked?.symbol === s.symbol ? "chip active" : "chip"}
              onClick={() => setPicked(s)}
            >
              {s.name}
            </button>
          ))}
        </div>
        {picked && (
          <div className="picked">
            <div>
              <strong>{picked.name}</strong> <span className="muted">{picked.symbol} · {picked.market}</span>
            </div>
            <button type="button" className="primary" disabled={busy} onClick={confirm}>
              {busy ? "설정 중…" : "이 종목으로 시작"}
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </main>
  );
}
