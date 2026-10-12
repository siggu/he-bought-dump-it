import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export function AuthPage({ mode }: { mode: "login" | "signup" }) {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "signup") await api.signup(email, password, nickname);
      else await api.login(email, password);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="auth">
      <div className="auth-hero">
        <p className="logo">📉 그가 <em>샀습니다</em></p>
        <p className="muted">
          한 종목에 올인하는 실시간 모의 투자.
          <br />
          파산하면 미니게임으로 재기하세요.
        </p>
      </div>
      <form className="card auth-form" onSubmit={submit}>
        <h1>{mode === "login" ? "로그인" : "회원가입"}</h1>
        <label>
          이메일
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === "signup" && (
          <label>
            닉네임 <small className="muted">(2~16자)</small>
            <input required minLength={2} maxLength={16} value={nickname} onChange={(e) => setNickname(e.target.value)} />
          </label>
        )}
        <label>
          비밀번호 {mode === "signup" && <small className="muted">(8자 이상)</small>}
          <input
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={mode === "signup" ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "잠시만요…" : mode === "login" ? "로그인" : "가입하고 1,000만원 받기"}
        </button>
        <p className="muted small center">
          {mode === "login" ? (
            <>
              처음이신가요? <Link to="/signup">회원가입</Link>
            </>
          ) : (
            <>
              이미 계정이 있나요? <Link to="/login">로그인</Link>
            </>
          )}
        </p>
      </form>
    </main>
  );
}
