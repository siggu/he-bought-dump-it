import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ArenaState, Candle, GameChoice, InteractionView, StockInfo } from "../../../shared/protocol";
import { api } from "../api";
import { useAuth, useMe } from "../auth";
import { Nickname } from "../components/Badge";
import { InteractionForm } from "../components/PrivacyForm";
import { GameChart } from "../components/PriceChart";
import { StockSearch } from "../components/StockSearch";
import { dateTime, pct, won } from "../format";

const TYPE_LABEL = { swap: "🎁 블라인드 박스", raid: "🥷 기습 털기", duel: "🥊 수익률 맞짱" } as const;

/** 아직 동작하지 않는 상호작용 (제목·설명만) */
const COMING_SOON = [
  { title: "🤝 십시일반", desc: "이번 달 내 월급을 파산한 개미에게 대신 보내줍니다. 보낸 사람은 이번 달 월급이 사라져요." },
  { title: "🕯️ 조의금", desc: "막 파산한 개미에게 최대 10만원의 위로금을 보냅니다. 명예의 전당에서 '조문'할 수 있어요." },
  { title: "🔔 그가 샀다! 알림", desc: "다른 개미를 팔로우하면, 그 개미가 매수할 때 '🤡 그가 샀습니다!' 알림이 와요." },
  { title: "🔮 예언하기", desc: "'○○님이 산 종목, 내일 오른다/내린다'에 소액을 걸고 맞히면 배당을 받아요." },
  { title: "🚀 리액션", desc: "프로필과 매매 기록에 🚀가즈아 · 🤡하면그만이야 · 🪦RIP · 💎존버 리액션을 남겨요." },
  { title: "👥 투자 동아리", desc: "최대 5명이 팀을 만들어 팀 평균 수익률로 시즌 랭킹을 겨뤄요." },
];

type RaidDraft = { id: string; candles: Candle[]; prompt: string; choices: GameChoice[]; expiresAt: number };

export function Arena() {
  const me = useMe();
  const { refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState<ArenaState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const target = params.get("target");

  const load = useCallback(async () => {
    try {
      setState(await api.arena(target));
    } catch (e) {
      setError((e as Error).message);
    }
  }, [target]);
  useEffect(() => {
    load();
  }, [load]);

  /** 요청을 보내고 결과 상태로 바꾼다. */
  const run = async (task: () => Promise<ArenaState | void>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await task();
      if (next) setState(next);
      else await load();
      setNotice(done);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <main className="narrow">{error ? <p className="error">{error}</p> : <p className="muted">불러오는 중…</p>}</main>;

  const targetPlayer = state.players.find((p) => p.nickname === target) ?? null;
  const drafts = state.outgoing.filter((v) => v.detail.draft);

  return (
    <main className="narrow arena">
      <section className="card">
        <h1>🐜 개미 광장</h1>
        <p className="muted">
          다른 개미와 주식을 바꾸고, 털고, 맞짱 뜨는 곳입니다. 상대가 <strong>받기</strong>로 설정한 상호작용만 걸 수
          있어요. 종류별로 <strong>하루 {state.limits.dailyPerType}번</strong>씩 걸 수 있고, 판돈은{" "}
          {won(state.limits.stakeMin)} ~ {won(state.limits.stakeMax)}입니다.
        </p>
        {me.user.isBankrupt && <p className="error">파산 상태에서는 상호작용을 할 수 없어요.</p>}
        {notice && <p className="ok">{notice}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      {drafts.map((d) => (
        <RaidAnswer key={d.id} view={d} busy={busy} run={run} />
      ))}

      <section className="card">
        <h2>받은 요청 {state.incoming.length > 0 && <span className="pill">{state.incoming.length}</span>}</h2>
        {state.incoming.length === 0 && <p className="muted small">받은 요청이 없어요.</p>}
        {state.incoming.map((v) => (
          <Incoming key={v.id} view={v} busy={busy} run={run} />
        ))}
      </section>

      <section className="card">
        <h2>보낸 요청 · 진행 중</h2>
        {state.outgoing.filter((v) => !v.detail.draft).length === 0 && <p className="muted small">진행 중인 상호작용이 없어요.</p>}
        {state.outgoing
          .filter((v) => !v.detail.draft)
          .map((v) => (
            <div key={v.id} className="ix-row">
              <div>
                <strong>{TYPE_LABEL[v.type]}</strong> → <Nickname nickname={v.other.nickname} badge={v.other.badge} />
                <p className="muted small">{describe(v)}</p>
              </div>
              {v.status === "pending" && (
                <button type="button" disabled={busy} onClick={() => run(() => api.respond(v.id, "cancel"), "요청을 취소했습니다.")}>
                  취소
                </button>
              )}
            </div>
          ))}
      </section>

      <section className="card">
        <h2>상대 찾기</h2>
        {targetPlayer ? (
          <Challenge
            key={targetPlayer.nickname}
            player={targetPlayer}
            state={state}
            busy={busy || me.user.isBankrupt}
            run={run}
            onClose={() => setParams({})}
          />
        ) : (
          <>
            <p className="muted small">상호작용을 받아 주는 개미들이에요. 골라서 도전해 보세요.</p>
            {state.players.length === 0 && <p className="muted">아직 상호작용을 받아 주는 개미가 없어요.</p>}
            <ul className="player-list">
              {state.players.map((p) => (
                <li key={p.nickname}>
                  <Nickname nickname={p.nickname} badge={p.badge} />
                  <span className="muted small">
                    {[p.accepts.allowSwap && "박스", p.accepts.allowRaid && "털기", p.accepts.allowDuel && "맞짱"].filter(Boolean).join(" · ")}
                  </span>
                  <button type="button" onClick={() => setParams({ target: p.nickname })}>
                    선택
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>내 받기 설정</h2>
        <p className="muted small">기본은 모두 거부예요. 켜 둔 상호작용만 다른 개미가 나에게 걸 수 있습니다.</p>
        <InteractionForm
          value={state.settings}
          onChange={(interactionSettings) =>
            run(async () => {
              await api.updateProfile({ interactionSettings });
            }, "받기 설정을 저장했습니다.")
          }
        />
      </section>

      <section className="card">
        <h2>지난 기록</h2>
        {state.history.length === 0 && <p className="muted small">아직 기록이 없어요.</p>}
        {state.history.map((v) => (
          <div key={v.id} className="ix-row">
            <div>
              <strong>{TYPE_LABEL[v.type]}</strong> {v.outgoing ? "→" : "←"} <Nickname nickname={v.other.nickname} badge={v.other.badge} />
              <p className="small">{v.summary ?? STATUS_LABEL[v.status]}</p>
              <p className="muted small">{dateTime(v.createdAt)}</p>
            </div>
          </div>
        ))}
      </section>

      <section className="card">
        <h2>준비 중인 상호작용</h2>
        <div className="soon-grid">
          {COMING_SOON.map((c) => (
            <div key={c.title} className="soon">
              <strong>{c.title}</strong>
              <span className="muted small">{c.desc}</span>
              <span className="soon-tag">준비 중</span>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

const STATUS_LABEL: Record<InteractionView["status"], string> = {
  pending: "응답 대기",
  active: "진행 중",
  settled: "완료",
  declined: "거절됨",
  cancelled: "취소됨",
  expired: "만료됨",
};

function describe(v: InteractionView): string {
  const d = v.detail as Record<string, string | number | null>;
  if (v.type === "swap") return `내 상자: ${d.myStock} 1주 (상대에게는 '${d.hint}'로 보여요) · 응답 기한 ${dateTime(v.expiresAt)}`;
  if (v.type === "raid") return `판돈 ${won(v.stake)} · 내 답: ${d.myChoice} · 응답 기한 ${dateTime(v.expiresAt)}`;
  if (v.status === "active") {
    const rf = typeof d.rateFrom === "number" ? pct(d.rateFrom) : "-";
    const rt = typeof d.rateTo === "number" ? pct(d.rateTo) : "-";
    return `판돈 ${won(v.stake)} · ${d.fromStock} ${rf} vs ${d.toStock} ${rt} · ${dateTime(Number(d.endAt))} 종료`;
  }
  return `판돈 ${won(v.stake)} · 내 종목: ${d.fromStock} · 응답 기한 ${dateTime(v.expiresAt)}`;
}

type Run = (task: () => Promise<ArenaState | void>, done: string) => Promise<void>;

function HoldingSelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const me = useMe();
  if (me.holdings.length === 0) return <p className="muted small">보유한 주식이 없어요. 먼저 주식을 사 주세요.</p>;
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="내 보유 종목">
      <option value="">내 보유 종목 고르기</option>
      {me.holdings.map((h) => (
        <option key={h.symbol} value={h.symbol}>
          {h.name} ({h.quantity}주)
        </option>
      ))}
    </select>
  );
}

function Incoming({ view, busy, run }: { view: InteractionView; busy: boolean; run: Run }) {
  const [symbol, setSymbol] = useState("");
  const [stock, setStock] = useState<StockInfo | null>(null);
  const d = view.detail as Record<string, unknown>;
  const decline = () => run(() => api.respond(view.id, "decline"), "거절했습니다.");
  const question = d.question as { prompt: string; candles: Candle[]; choices: GameChoice[] } | undefined;

  return (
    <div className="ix-card">
      <div className="ix-head">
        <strong>{TYPE_LABEL[view.type]}</strong>
        <span>
          from <Nickname nickname={view.other.nickname} badge={view.other.badge} />
        </span>
        <span className="muted small">기한 {dateTime(view.expiresAt)}</span>
      </div>
      {view.type === "swap" && (
        <>
          <p>
            이름을 가린 주식 1주가 든 상자가 왔어요. 힌트: <strong>{String(d.hint)}</strong>
            <br />
            <span className="muted small">내 주식 1주를 골라 넣으면 서로 맞바꿉니다. 받은 주식의 단가는 교환 시점 현재가로 계산돼요.</span>
          </p>
          <div className="ix-actions">
            <HoldingSelect value={symbol} onChange={setSymbol} />
            <button type="button" className="primary" disabled={busy || !symbol} onClick={() => run(() => api.respond(view.id, "accept", { symbol }), "교환이 성사됐습니다!")}>
              교환하기
            </button>
            <button type="button" disabled={busy} onClick={decline}>
              거절
            </button>
          </div>
        </>
      )}
      {view.type === "raid" && question && (
        <>
          <p>
            판돈 <strong>{won(view.stake)}</strong>을 건 기습! 같은 문제를 풀어 막아내세요. 상대만 맞히면 내 주식 1주를
            빼앗기고, 나만 맞히면 판돈을 가져와요.
          </p>
          <p className="game-prompt">{question.prompt}</p>
          <GameChart candles={question.candles} reveal={0} datesVisible={false} />
          <div className="game-buttons n3">
            {question.choices.map((c) => (
              <button key={c.id} type="button" className="primary choice" disabled={busy} onClick={() => run(() => api.respond(view.id, "accept", { choice: c.id }), "결과가 나왔습니다! 지난 기록을 확인하세요.")}>
                {c.label}
              </button>
            ))}
          </div>
          <button type="button" className="link" disabled={busy} onClick={decline}>
            도망치기 (거절)
          </button>
        </>
      )}
      {view.type === "duel" && (
        <>
          <p>
            판돈 <strong>{won(view.stake)}</strong>을 건 7일 수익률 맞짱! 상대 종목은 수락한 뒤 공개돼요. 내 종목을 골라 주세요.
          </p>
          <div className="ix-actions">
            <StockSearch placeholder="맞짱에 쓸 종목 검색" onSelect={setStock} />
            {stock && <span className="chip active">{stock.name}</span>}
            <button type="button" className="primary" disabled={busy || !stock} onClick={() => run(() => api.respond(view.id, "accept", { symbol: stock!.symbol }), "맞짱이 시작됐습니다! 7일 뒤 결과가 나와요.")}>
              수락 (판돈 {won(view.stake)})
            </button>
            <button type="button" disabled={busy} onClick={decline}>
              거절
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function RaidAnswer({ view, busy, run }: { view: InteractionView; busy: boolean; run: Run }) {
  const q = view.detail.question as RaidDraft | undefined;
  const [stake, setStake] = useState("100000");
  const [choice, setChoice] = useState<string | null>(null);
  if (!q) return null;
  return (
    <section className="card ix-card">
      <div className="ix-head">
        <strong>🥷 기습 털기 준비</strong>
        <span>
          → <Nickname nickname={view.other.nickname} badge={view.other.badge} />
        </span>
        <span className="muted small">{dateTime(view.expiresAt)}까지 제출</span>
      </div>
      <p className="game-prompt">{q.prompt}</p>
      <GameChart candles={q.candles} reveal={0} datesVisible={false} />
      <div className="game-buttons n3">
        {q.choices.map((c) => (
          <button key={c.id} type="button" className={`choice ${choice === c.id ? "primary" : ""}`} onClick={() => setChoice(c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="ix-actions">
        <label className="small">
          판돈
          <input inputMode="numeric" value={stake} onChange={(e) => setStake(e.target.value.replace(/\D/g, ""))} />
        </label>
        <button
          type="button"
          className="primary"
          disabled={busy || !choice}
          onClick={() => run(() => api.submitRaid(view.id, choice!, Number(stake)), "도전장을 보냈습니다! 상대가 답하면 결과가 나와요.")}
        >
          도전장 보내기
        </button>
      </div>
    </section>
  );
}

function Challenge({
  player,
  state,
  busy,
  run,
  onClose,
}: {
  player: ArenaState["players"][number];
  state: ArenaState;
  busy: boolean;
  run: Run;
  onClose: () => void;
}) {
  const [swapSymbol, setSwapSymbol] = useState("");
  const [duelStock, setDuelStock] = useState<StockInfo | null>(null);
  const [duelStake, setDuelStake] = useState("100000");
  const left = (t: "swap" | "raid" | "duel") => state.limits.dailyPerType - state.usedToday[t];

  return (
    <div className="challenge">
      <div className="ix-head">
        <Nickname nickname={player.nickname} badge={player.badge} />
        <button type="button" className="link" onClick={onClose}>
          다른 상대 고르기
        </button>
      </div>

      <div className={`ix-card ${player.accepts.allowSwap ? "" : "disabled"}`}>
        <strong>🎁 블라인드 박스 교환</strong>
        <p className="muted small">
          내 주식 1주를 상자에 넣어 보내요. 상대에게는 종목명 대신 가격대만 보이고, 상대도 이름을 가린 1주를 넣으면 맞교환! (오늘 남은 횟수 {left("swap")})
        </p>
        {player.accepts.allowSwap ? (
          <div className="ix-actions">
            <HoldingSelect value={swapSymbol} onChange={setSwapSymbol} />
            <button type="button" className="primary" disabled={busy || !swapSymbol || left("swap") <= 0} onClick={() => run(() => api.swap(player.nickname, swapSymbol), "상자를 보냈습니다!")}>
              상자 보내기
            </button>
          </div>
        ) : (
          <p className="muted small">이 개미는 블라인드 박스를 받지 않아요.</p>
        )}
      </div>

      <div className={`ix-card ${player.accepts.allowRaid ? "" : "disabled"}`}>
        <strong>🥷 기습 털기</strong>
        <p className="muted small">
          주가 맞히기 한 문제로 결투! 나만 맞히면 상대 주식 1주를 무작위로 털어 오고, 상대만 맞히면 판돈을 줘요. 둘 다 맞히거나 틀리면 무승부. (오늘 남은 횟수 {left("raid")}, 문제를 받으면 1회 사용)
        </p>
        {player.accepts.allowRaid ? (
          <button
            type="button"
            className="primary"
            disabled={busy || left("raid") <= 0}
            onClick={() => run(async () => {
              await api.raid(player.nickname);
            }, "문제가 나왔습니다! 위에서 답과 판돈을 정해 도전장을 보내세요.")}
          >
            문제 받기
          </button>
        ) : (
          <p className="muted small">이 개미는 기습 털기를 받지 않아요.</p>
        )}
      </div>

      <div className={`ix-card ${player.accepts.allowDuel ? "" : "disabled"}`}>
        <strong>🥊 1:1 수익률 맞짱</strong>
        <p className="muted small">
          각자 종목 하나를 골라 {state.limits.duelDays}일 동안 수익률 대결! 이긴 쪽이 판돈을 모두 가져가요. 내 종목은 상대가 수락할 때까지 비공개. (오늘 남은 횟수 {left("duel")})
        </p>
        {player.accepts.allowDuel ? (
          <div className="ix-actions">
            <StockSearch placeholder="내가 고를 종목 검색" onSelect={setDuelStock} />
            {duelStock && <span className="chip active">{duelStock.name}</span>}
            <label className="small">
              판돈
              <input inputMode="numeric" value={duelStake} onChange={(e) => setDuelStake(e.target.value.replace(/\D/g, ""))} />
            </label>
            <button
              type="button"
              className="primary"
              disabled={busy || !duelStock || left("duel") <= 0}
              onClick={() => run(() => api.duel(player.nickname, duelStock!.symbol, Number(duelStake)), "맞짱 신청을 보냈습니다!")}
            >
              맞짱 신청
            </button>
          </div>
        ) : (
          <p className="muted small">이 개미는 맞짱을 받지 않아요.</p>
        )}
      </div>
      <p className="muted small">
        <Link to={`/u/${encodeURIComponent(player.nickname)}`}>{player.nickname}님 프로필 보기</Link>
      </p>
    </div>
  );
}
