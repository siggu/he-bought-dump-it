// 관리자 기능: 유저 검색, 닉네임 강제 변경, 계정 정지/해제, 조치 기록

import { loadUser, UserError } from "./account";
import type { Env } from "./env";
import { NICKNAME_RE, NICKNAME_RULE } from "./profile";

export interface AdminUserRow {
  id: number;
  email: string;
  nickname: string;
  role: string;
  createdAt: number;
  cash: number;
  bankruptCount: number;
  suspendedAt: number | null;
  suspendedReason: string | null;
}

export async function searchUsers(env: Env, q: string): Promise<AdminUserRow[]> {
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { results } = await env.DB.prepare(
    `SELECT id, email, nickname, role, created_at AS createdAt, cash, bankrupt_count AS bankruptCount,
            suspended_at AS suspendedAt, suspended_reason AS suspendedReason
       FROM users
      WHERE ?1 = '' OR nickname LIKE ?2 ESCAPE '\\' OR email LIKE ?2 ESCAPE '\\'
      ORDER BY id DESC LIMIT 50`,
  )
    .bind(q, like)
    .all<AdminUserRow>();
  return results;
}

function log(env: Env, adminId: number, targetId: number, action: string, detail: string): D1PreparedStatement {
  return env.DB.prepare(
    "INSERT INTO admin_actions (admin_id, target_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(adminId, targetId, action, detail, Date.now());
}

/** 닉네임 강제 변경. 비워 두면 '개미' + 숫자로 바꾼다. 3일 제한과 무관하며, 바뀐 사람은 바로 다시 바꿀 수 있다. */
export async function forceNickname(env: Env, adminId: number, targetId: number, nickname: string): Promise<string> {
  const target = await loadUser(env, targetId);
  let next = nickname.trim();
  if (!next) {
    for (let i = 0; i < 5 && !next; i++) {
      const candidate = `개미${Math.floor(10000 + Math.random() * 90000)}`;
      const taken = await env.DB.prepare("SELECT 1 FROM users WHERE nickname = ?").bind(candidate).first();
      if (!taken) next = candidate;
    }
  }
  if (!NICKNAME_RE.test(next)) throw new UserError(NICKNAME_RULE);
  const taken = await env.DB.prepare("SELECT 1 FROM users WHERE nickname = ? AND id <> ?").bind(next, targetId).first();
  if (taken) throw new UserError("이미 사용 중인 닉네임입니다.", 409);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET nickname = ?, nickname_changed_at = NULL WHERE id = ?").bind(next, targetId),
    log(env, adminId, targetId, "nickname", `${target.nickname} → ${next}`),
  ]);
  return next;
}

export async function suspendUser(env: Env, adminId: number, targetId: number, reason: string): Promise<void> {
  if (adminId === targetId) throw new UserError("자기 자신은 정지할 수 없습니다.");
  const target = await env.DB.prepare("SELECT role FROM users WHERE id = ?").bind(targetId).first<{ role: string }>();
  if (!target) throw new UserError("존재하지 않는 사용자입니다.", 404);
  if (target.role === "admin") throw new UserError("관리자 계정은 정지할 수 없습니다.", 403);
  const text = reason.trim().slice(0, 200);
  if (!text) throw new UserError("정지 사유를 입력해 주세요.");
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET suspended_at = ?, suspended_reason = ? WHERE id = ?").bind(Date.now(), text, targetId),
    // 로그인 중인 세션도 모두 끊는다.
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(targetId),
    log(env, adminId, targetId, "suspend", text),
  ]);
}

export async function unsuspendUser(env: Env, adminId: number, targetId: number): Promise<void> {
  await loadUser(env, targetId);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET suspended_at = NULL, suspended_reason = NULL WHERE id = ?").bind(targetId),
    log(env, adminId, targetId, "unsuspend", ""),
  ]);
}

export async function recentActions(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT a.id, a.action, a.detail, a.created_at AS createdAt,
            ad.nickname AS admin, t.nickname AS target
       FROM admin_actions a
       JOIN users ad ON ad.id = a.admin_id
       JOIN users t ON t.id = a.target_id
      ORDER BY a.id DESC LIMIT 50`,
  ).all<{ id: number; action: string; detail: string; createdAt: number; admin: string; target: string }>();
  return results;
}
