import { useCallback, useEffect, useState } from "react";
import { type AdminUser, api } from "../api";
import { dateTime, won } from "../format";

const ACTION_LABEL: Record<string, string> = { nickname: "닉네임 변경", suspend: "정지", unsuspend: "정지 해제" };

/** 관리자 전용: 부적절한 닉네임 변경, 계정 정지/해제 */
export function Admin() {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [actions, setActions] = useState<Awaited<ReturnType<typeof api.adminActions>>["actions"]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (term: string) => {
    try {
      const [u, a] = await Promise.all([api.adminUsers(term), api.adminActions()]);
      setUsers(u.users);
      setActions(a.actions);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => load(q), 300);
    return () => window.clearTimeout(t);
  }, [q, load]);

  const run = async (task: Promise<unknown>, done: string) => {
    setError(null);
    setMessage(null);
    try {
      await task;
      setMessage(done);
      await load(q);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <main>
      <section className="card">
        <h1>🛡️ 관리</h1>
        <p className="muted small">
          부적절한 닉네임은 바꾸고, 문제가 되는 계정은 정지할 수 있어요. 모든 조치는 아래 기록에 남습니다. 닉네임을 바꾸면
          그 사람은 3일 제한 없이 바로 다시 바꿀 수 있어요.
        </p>
        <input type="search" value={q} placeholder="닉네임 또는 이메일 검색" onChange={(e) => setQ(e.target.value)} />
        {message && <p className="ok">{message}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <section className="card">
        <h2>유저 ({users.length})</h2>
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>닉네임</th>
                <th>이메일</th>
                <th>가입</th>
                <th className="num">현금</th>
                <th>상태</th>
                <th>조치</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <AdminRow key={u.id} user={u} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>조치 기록</h2>
        {actions.length === 0 && <p className="muted small">아직 기록이 없어요.</p>}
        <ul className="trade-list">
          {actions.map((a) => (
            <li key={a.id}>
              <strong>{ACTION_LABEL[a.action] ?? a.action}</strong> {a.target}
              <span className="muted small">{a.detail}</span>
              <span className="muted small">
                by {a.admin} · {dateTime(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function AdminRow({ user, run }: { user: AdminUser; run: (task: Promise<unknown>, done: string) => Promise<void> }) {
  const [nickname, setNickname] = useState("");
  const [reason, setReason] = useState("");
  const isAdmin = user.role === "admin";
  return (
    <tr className={user.suspendedAt ? "suspended" : ""}>
      <td>
        <strong>{user.nickname}</strong>
        {isAdmin && <span className="badge">관리자</span>}
      </td>
      <td className="small">{user.email}</td>
      <td className="small">{new Date(user.createdAt).toLocaleDateString("ko-KR")}</td>
      <td className="num small">{won(user.cash)}</td>
      <td className="small">
        {user.suspendedAt ? (
          <span className="down">
            정지 ({user.suspendedReason})
          </span>
        ) : (
          "정상"
        )}
      </td>
      <td>
        <div className="admin-actions">
          <input value={nickname} placeholder="새 닉네임 (비우면 자동)" maxLength={16} onChange={(e) => setNickname(e.target.value)} />
          <button
            type="button"
            onClick={() =>
              run(api.adminNickname(user.id, nickname), `${user.nickname}님의 닉네임을 바꿨습니다.`).then(() => setNickname(""))
            }
          >
            닉네임 변경
          </button>
          {!isAdmin &&
            (user.suspendedAt ? (
              <button type="button" onClick={() => run(api.adminUnsuspend(user.id), `${user.nickname}님의 정지를 해제했습니다.`)}>
                정지 해제
              </button>
            ) : (
              <>
                <input value={reason} placeholder="정지 사유" maxLength={200} onChange={(e) => setReason(e.target.value)} />
                <button
                  type="button"
                  className="danger"
                  disabled={!reason.trim()}
                  onClick={() => {
                    if (window.confirm(`${user.nickname}님을 정지할까요? 로그인 중인 세션도 모두 끊깁니다.`)) {
                      run(api.adminSuspend(user.id, reason), `${user.nickname}님을 정지했습니다.`).then(() => setReason(""));
                    }
                  }}
                >
                  정지
                </button>
              </>
            ))}
        </div>
      </td>
    </tr>
  );
}
