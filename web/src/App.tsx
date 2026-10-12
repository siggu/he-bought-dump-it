import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { StockSearch } from "./components/StockSearch";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { Game } from "./pages/Game";
import { History } from "./pages/History";
import { Onboarding } from "./pages/Onboarding";
import { StockDetail } from "./pages/StockDetail";
import { useRealtime } from "./realtime";

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}

function Shell() {
  const { me } = useAuth();

  if (me === undefined) return <div className="loading">불러오는 중…</div>;

  if (me === null) {
    return (
      <Routes>
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (!me.user.mainSymbol) {
    return (
      <>
        <Header />
        <Onboarding />
      </>
    );
  }

  return (
    <>
      <Header />
      <MarketBanner />
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/stocks/:symbol" element={<StockDetail />} />
        <Route path="/history" element={<History />} />
        <Route path="/game" element={<Game />} />
        <Route path="/settings/main" element={<Onboarding />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

function Header() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="header">
      <Link to="/" className="logo">
        📉 그가 <em>샀습니다</em>
      </Link>
      {me?.user.mainSymbol && (
        <StockSearch placeholder="다른 종목 검색 (조회 전용)" onSelect={(s) => navigate(`/stocks/${s.symbol}`)} />
      )}
      <nav>
        {me?.user.mainSymbol && (
          <>
            <NavLink to="/" end>
              대시보드
            </NavLink>
            <NavLink to="/history">거래내역</NavLink>
            {me.user.isBankrupt && <NavLink to="/game">미니게임</NavLink>}
          </>
        )}
        <span className="nickname">{me?.user.nickname}</span>
        <button
          type="button"
          className="link"
          onClick={async () => {
            await logout();
            navigate("/login");
          }}
        >
          로그아웃
        </button>
      </nav>
    </header>
  );
}

function MarketBanner() {
  const { me } = useAuth();
  const { status } = useRealtime(null);
  const feed = status.feed ?? me?.market.feed;
  const open = status.market ? status.market === "open" : me?.market.open;
  if (feed === "mock") {
    return <div className="strip">🧪 모의 시세로 동작 중입니다 (한국투자증권 앱키 미설정). 실제 시세와 다릅니다.</div>;
  }
  if (!open) return <div className="strip">🌙 장 마감 · 주문은 평일 09:00~15:30에 가능합니다. 시세는 마지막 체결가입니다.</div>;
  return null;
}
