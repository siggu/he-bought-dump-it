import { useEffect, useState } from "react";
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { OwnedBadge } from "../../shared/protocol";
import { api } from "./api";
import { AuthProvider, useAuth } from "./auth";
import { BadgeChip, TIER_LABEL } from "./components/Badge";
import { Logo } from "./components/Logo";
import { StockSearch } from "./components/StockSearch";
import { AuthPage } from "./pages/AuthPage";
import { Dashboard } from "./pages/Dashboard";
import { Game } from "./pages/Game";
import { History } from "./pages/History";
import { Admin } from "./pages/Admin";
import { Arena } from "./pages/Arena";
import { MyProfilePage, ProfileSetup, UserProfilePage } from "./pages/Profile";
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

  // 가입 직후: 공개 범위부터 정한다
  if (!me.user.profileSetupDone) {
    return (
      <>
        <Header />
        <ProfileSetup />
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
        <Route path="/arena" element={<Arena />} />
        {me.user.isAdmin && <Route path="/admin" element={<Admin />} />}
        <Route path="/profile" element={<MyProfilePage />} />
        <Route path="/u/:nickname" element={<UserProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <BadgeToast />
    </>
  );
}

/** 새로 얻은 배지 알림 */
function BadgeToast() {
  const { me } = useAuth();
  const [queue, setQueue] = useState<OwnedBadge[]>([]);

  useEffect(() => {
    const fresh = me?.newBadges ?? [];
    if (fresh.length === 0) return;
    setQueue((q) => [...q, ...fresh.filter((b) => !q.some((x) => x.id === b.id))]);
    api.badgesSeen().catch(() => undefined);
  }, [me?.newBadges]);

  const badge = queue[0];
  if (!badge) return null;
  return (
    <div className="badge-toast" role="status">
      <small className="muted">🏅 새 배지 획득 · {TIER_LABEL[badge.tier]}</small>
      <div>
        <BadgeChip badge={badge} />
      </div>
      <p>
        {badge.flavor}
        <br />
        <small className="muted">조건: {badge.condition}</small>
      </p>
      <div className="toast-actions">
        <Link to="/profile" className="button" onClick={() => setQueue((q) => q.slice(1))}>
          배지함 보기
        </Link>
        <button type="button" className="primary" onClick={() => setQueue((q) => q.slice(1))}>
          확인
        </button>
      </div>
    </div>
  );
}

function Header() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <header className="header">
      <Link to="/" className="logo">
        <Logo />
      </Link>
      {me?.user.profileSetupDone && (
        <StockSearch placeholder="종목 검색" onSelect={(s) => navigate(`/stocks/${s.symbol}`)} />
      )}
      <nav>
        {me?.user.profileSetupDone && (
          <>
            <NavLink to="/" end>
              내 계좌
            </NavLink>
            <NavLink to="/history">거래내역</NavLink>
            <NavLink to="/arena">개미 광장</NavLink>
            {me.user.isAdmin && <NavLink to="/admin">관리</NavLink>}
            {me.user.isBankrupt && <NavLink to="/game">미니게임</NavLink>}
          </>
        )}
        {me && (
          <Link to="/profile" className="nickname-line" title="내 프로필">
            {me.user.featuredBadge && <BadgeChip badge={me.user.featuredBadge} />}
            <span className="nick">{me.user.nickname}</span>
          </Link>
        )}
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
