import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { GameDifficulty, GameQuestion, GameResult, GameStatus } from "../../../shared/protocol";
import { api } from "../api";
import { useAuth, useMe } from "../auth";
import { GameChart } from "../components/PriceChart";
import { pct, won } from "../format";

const LEVELS: { id: GameDifficulty; name: string; choices: number; desc: string }[] = [
  { id: "easy", name: "쉬움", choices: 2, desc: "인기 종목·날짜 공개. 20거래일 동안 올랐을까, 내렸을까?" },
  { id: "normal", name: "보통", choices: 3, desc: "종목·날짜 비공개. 5거래일 뒤 종가가 ±3%를 넘었을까?" },
  { id: "hard", name: "어려움", choices: 4, desc: "종목·날짜 비공개. 다음 날 등락률 구간을 정확히!" },
];

export function Game() {
  const me = useMe();
  const { refresh, setMe } = useAuth();
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [question, setQuestion] = useState<GameQuestion | null>(null);
  const [result, setResult] = useState<GameResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const s = await api.game();
      setStatus(s);
      if (s.current) setQuestion(s.current);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!question || result) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [question, result]);

  const start = async (difficulty: GameDifficulty) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setQuestion(await api.gameStart(difficulty));
      setNow(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await load();
      setBusy(false);
    }
  };

  const answer = async (choice: string) => {
    if (!question) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.gameAnswer(question.gameId, choice);
      setResult(r);
      if (r.recovered) await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      await load();
      setBusy(false);
    }
  };

  const next = () => {
    setQuestion(null);
    setResult(null);
    setError(null);
  };

  const claimSalary = async () => {
    try {
      setMe(await api.salary());
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (!me.user.isBankrupt && !result?.recovered) {
    return (
      <main className="narrow">
        <section className="card center">
          <h1>미니게임</h1>
          <p className="muted">미니게임은 파산했을 때만 할 수 있어요. 아직은 투자에 집중하세요!</p>
          <Link className="button primary" to="/">
            대시보드로
          </Link>
        </section>
      </main>
    );
  }

  const cash = result?.cash ?? status?.cash ?? me.user.cash;
  const target = result?.recoveryTarget || status?.recoveryTarget || me.thresholds.recovery;
  const progress = Math.min(100, (cash / target) * 100);
  const leftToday = status ? Math.max(0, status.dailyLimit - status.usedToday) : 0;
  const leftMonth = status ? Math.max(0, status.monthlyLimit - status.usedThisMonth) : 0;
  const canPlay = !!status && leftToday > 0 && leftMonth > 0;
  const secondsLeft = question ? Math.max(0, Math.ceil((question.expiresAt - now) / 1000)) : 0;

  return (
    <main className="narrow">
      <section className="card">
        <h1>📈 주가 맞히기</h1>
        <p className="muted">
          실제 과거 주가로 만든 문제입니다. 맞히면 상금을 받아 재기 자금을 모을 수 있어요.
        </p>
        <div className="progress" aria-label="재기 진행률">
          <div style={{ width: `${progress}%` }} />
        </div>
        <p className="small">
          현금 <strong>{won(cash)}</strong> / 재기 목표 {won(target)}
        </p>
        {status && (
          <div className="game-limits">
            <span>
              오늘 남은 기회 <strong>{leftToday}</strong>/{status.dailyLimit}
            </span>
            <span>
              이번 달 남은 기회 <strong>{leftMonth}</strong>/{status.monthlyLimit}
            </span>
          </div>
        )}
        {me.user.salaryAvailable && (
          <div className="banner info">
            이번 달 월급({won(me.user.salaryAmount)})을 아직 안 받았어요!
            <button type="button" className="primary" onClick={claimSalary}>
              월급 받기
            </button>
          </div>
        )}
      </section>

      {result?.recovered ? (
        <section className="card center">
          <h2>🎉 재기 성공!</h2>
          <p>매매 잠금이 풀렸습니다. 이번엔 신중하게…</p>
          <Link className="button primary" to="/">
            다시 투자하러 가기
          </Link>
        </section>
      ) : question ? (
        <section className="card">
          <div className="game-meta">
            <span className={`level-tag ${question.difficulty}`}>
              {LEVELS.find((l) => l.id === question.difficulty)?.name}
            </span>
            <span>
              정답 상금 <strong>{won(question.reward)}</strong>
            </span>
            {!result && <span className={secondsLeft < 20 ? "down" : "muted"}>남은 시간 {secondsLeft}초</span>}
          </div>
          <p className="game-prompt">{question.prompt}</p>
          <GameChart
            candles={result ? [...question.candles, ...result.reveal] : question.candles}
            reveal={result ? result.reveal.length : 0}
            datesVisible={question.datesVisible}
          />
          {result ? (
            <div className={`game-result ${result.correct ? "up" : "down"}`}>
              <strong>{result.correct ? `정답! +${won(result.reward)}` : "아쉽게도 오답"}</strong>
              <p className="muted">
                정답: {result.answerLabel} (실제 {pct(result.ratePct)})
                <br />
                {result.stockName} · {result.period}
              </p>
              <button type="button" className="primary" onClick={next}>
                {canPlay ? "다른 문제 풀기" : "확인"}
              </button>
            </div>
          ) : (
            <div className={`game-buttons n${question.choices.length}`}>
              {question.choices.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="primary choice"
                  disabled={busy || secondsLeft === 0}
                  onClick={() => answer(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
          )}
          {!result && secondsLeft === 0 && (
            <p className="muted small center">
              시간이 초과됐어요. 이 기회는 사용 처리됐습니다.{" "}
              <button type="button" className="link" onClick={next}>
                돌아가기
              </button>
            </p>
          )}
        </section>
      ) : (
        <section className="card">
          <h2>난이도 선택</h2>
          <p className="muted small">
            ⚠️ <strong>하이리스크 하이리턴</strong> — 어려울수록 맞히기 힘들지만 상금이 큽니다. 틀리면 상금 없이
            기회만 사라져요. 문제를 받는 순간 기회 1회가 차감됩니다.
          </p>
          <div className="levels">
            {LEVELS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`level ${l.id}`}
                disabled={busy || !canPlay}
                onClick={() => start(l.id)}
              >
                <span className="level-name">{l.name}</span>
                <span className="level-reward">{status ? won(status.rewards[l.id]) : "-"}</span>
                <span className="level-desc">
                  {l.choices}지선다 · {l.desc}
                </span>
              </button>
            ))}
          </div>
          {status && !canPlay && (
            <p className="muted small center">
              {leftMonth === 0 ? "이번 달 기회를 모두 썼어요. 다음 달 월급을 기다려 보세요." : "오늘 기회를 모두 썼어요. 내일 다시 오세요!"}
            </p>
          )}
        </section>
      )}
      {error && <p className="error center">{error}</p>}
    </main>
  );
}
