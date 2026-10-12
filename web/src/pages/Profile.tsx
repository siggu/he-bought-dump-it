import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { MyProfile, Privacy, PublicProfile } from "../../../shared/protocol";
import { api } from "../api";
import { useAuth } from "../auth";
import { BadgeChip, Nickname, TIER_LABEL } from "../components/Badge";
import { ALL_PRIVATE, PrivacyForm } from "../components/PrivacyForm";
import { dateTime, pct, won } from "../format";

/** 가입 직후: 공개 범위부터 정한다 (기본 전부 비공개) */
export function ProfileSetup() {
  const { refresh } = useAuth();
  const [privacy, setPrivacy] = useState<Privacy>(ALL_PRIVATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateProfile({ privacy, setupDone: true });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="narrow">
      <section className="card">
        <h1>👋 환영합니다! 프로필 공개 범위를 정해 주세요</h1>
        <p className="muted">
          다른 사람이 내 프로필에서 볼 수 있는 항목입니다. <strong>처음에는 모두 비공개</strong>로 되어 있어요. 나중에
          프로필 화면에서 언제든 바꿀 수 있습니다.
        </p>
        <PrivacyForm value={privacy} onChange={setPrivacy} />
        {error && <p className="error">{error}</p>}
        <button type="button" className="primary wide" disabled={busy} onClick={save}>
          {busy ? "저장 중…" : "저장하고 종목 고르러 가기"}
        </button>
      </section>
    </main>
  );
}

/** 내 프로필: 배지함, 대표 배지, 닉네임 변경, 공개 범위 */
export function MyProfilePage() {
  const { refresh } = useAuth();
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .myProfile()
      .then((p) => {
        setProfile(p);
        setNickname(p.nickname);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const apply = async (task: Promise<MyProfile>, done: string) => {
    setError(null);
    setMessage(null);
    try {
      const p = await task;
      setProfile(p);
      setNickname(p.nickname);
      setMessage(done);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!profile) {
    return <main className="narrow">{error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>}</main>;
  }

  const hidden = profile.totalBadges - profile.badges.length;
  const featured = profile.badges.find((b) => b.id === profile.featuredBadgeId) ?? null;

  const submitNickname = (e: FormEvent) => {
    e.preventDefault();
    apply(api.changeNickname(nickname.trim()), "닉네임을 바꿨습니다.");
  };

  return (
    <main className="narrow">
      <section className="card">
        <div className="profile-head">
          <Nickname nickname={profile.nickname} badge={featured} link={false} />
          <Link to={`/u/${encodeURIComponent(profile.nickname)}`} className="small">
            다른 사람에게 보이는 내 프로필 →
          </Link>
        </div>
        {message && <p className="ok">{message}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>
          🏅 배지함 <span className="muted small">{profile.badges.length} / {profile.totalBadges}</span>
        </h2>
        <p className="muted small">
          배지 조건은 비밀이에요. 획득한 배지만 조건을 볼 수 있습니다. 하나를 골라 닉네임 옆에 달 수 있어요.
        </p>
        <div className="badge-grid">
          {profile.badges.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`badge-card ${b.tier} ${profile.featuredBadgeId === b.id ? "selected" : ""}`}
              onClick={() =>
                apply(
                  api.updateProfile({ featuredBadge: profile.featuredBadgeId === b.id ? null : b.id }),
                  profile.featuredBadgeId === b.id ? "대표 배지를 해제했습니다." : `대표 배지를 '${b.name}'(으)로 바꿨습니다.`,
                )
              }
            >
              <span className="badge-tier">{TIER_LABEL[b.tier]}</span>
              <strong>{b.name}</strong>
              <span className="badge-flavor">{b.flavor}</span>
              <span className="badge-cond">조건: {b.condition}</span>
              <span className="badge-date">{dateTime(b.earnedAt)}</span>
              {profile.featuredBadgeId === b.id && <span className="badge-featured">대표</span>}
            </button>
          ))}
          {hidden > 0 && (
            <div className="badge-card locked">
              <strong>???</strong>
              <span className="badge-flavor">아직 {hidden}개의 숨겨진 배지가 있어요</span>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2>닉네임 변경</h2>
        <p className="notice">
          ⚠️ 닉네임은 <strong>3일(72시간)에 한 번만</strong> 바꿀 수 있습니다. 바꾼 뒤 72시간 동안은 다시 바꿀 수 없으니
          신중하게 정해 주세요. (가입할 때 정한 닉네임은 변경 횟수에 포함되지 않습니다)
        </p>
        <form className="inline-form" onSubmit={submitNickname}>
          <input
            value={nickname}
            maxLength={16}
            onChange={(e) => setNickname(e.target.value)}
            disabled={profile.nicknameChangeAvailableAt !== null}
            aria-label="새 닉네임"
          />
          <button
            type="submit"
            className="primary"
            disabled={profile.nicknameChangeAvailableAt !== null || nickname.trim() === profile.nickname}
          >
            변경
          </button>
        </form>
        <p className="muted small">
          {profile.nicknameChangeAvailableAt
            ? `다음 변경 가능: ${dateTime(profile.nicknameChangeAvailableAt)}`
            : "2~16자, 한글·영문·숫자·밑줄(_)만 쓸 수 있어요."}
        </p>
      </section>

      <section className="card">
        <h2>공개 범위</h2>
        <PrivacyForm
          value={profile.privacy}
          onChange={(privacy) => apply(api.updateProfile({ privacy }), "공개 범위를 저장했습니다.")}
        />
      </section>
    </main>
  );
}

const SIDE_LABEL = { buy: "매수", sell: "매도", liquidation: "강제청산" } as const;

/** 다른 사람의 프로필 */
export function UserProfilePage() {
  const nickname = useParams().nickname ?? "";
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProfile(null);
    setError(null);
    api
      .user(nickname)
      .then(setProfile)
      .catch((e: Error) => setError(e.message));
  }, [nickname]);

  if (error) {
    return (
      <main className="narrow">
        <section className="card">
          <p className="error">{error}</p>
        </section>
      </main>
    );
  }
  if (!profile) return <main className="narrow muted">불러오는 중…</main>;

  const priv = <span className="muted">비공개</span>;
  return (
    <main className="narrow">
      <section className="card">
        <div className="profile-head">
          <Nickname nickname={profile.nickname} badge={profile.featuredBadge} link={false} />
          <span className="muted small">가입 {new Date(profile.joinedAt).toLocaleDateString("ko-KR")}</span>
        </div>
        <dl className="profile-stats">
          <div>
            <dt>메인 종목</dt>
            <dd>{profile.mainStock ? `${profile.mainStock.name} (${profile.mainStock.symbol})` : priv}</dd>
          </div>
          <div>
            <dt>총자산</dt>
            <dd>{profile.totalAssets !== null ? won(profile.totalAssets) : priv}</dd>
          </div>
          <div>
            <dt>보유 종목 수익률</dt>
            <dd className={profile.profitRate !== null ? (profile.profitRate >= 0 ? "up" : "down") : ""}>
              {profile.profitRate !== null ? pct(profile.profitRate) : priv}
            </dd>
          </div>
          <div>
            <dt>파산 횟수</dt>
            <dd>{profile.bankruptCount !== null ? `${profile.bankruptCount}회` : priv}</dd>
          </div>
        </dl>
      </section>
      <section className="card">
        <h2>배지</h2>
        {profile.badges === null ? (
          priv
        ) : profile.badges.length === 0 ? (
          <p className="muted">아직 획득한 배지가 없어요.</p>
        ) : (
          <div className="chips">
            {profile.badges.map((b) => (
              <BadgeChip key={b.id} badge={b} />
            ))}
          </div>
        )}
      </section>
      <section className="card">
        <h2>최근 매매</h2>
        {profile.recentTrades === null ? (
          priv
        ) : profile.recentTrades.length === 0 ? (
          <p className="muted">아직 매매 기록이 없어요.</p>
        ) : (
          <ul className="trade-list">
            {profile.recentTrades.map((t, i) => (
              <li key={i}>
                <span className={t.side === "buy" ? "up" : "down"}>{SIDE_LABEL[t.side]}</span> {t.name}
                <span className="muted small">{dateTime(t.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
