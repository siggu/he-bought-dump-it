// 비밀번호 해시(PBKDF2-SHA256)와 세션 관리.
// Workers에는 argon2/bcrypt 네이티브 구현이 없으므로 WebCrypto PBKDF2를 쓴다.
// 해시 계산 자체는 CPU 한도 때문에 PasswordHasher(Durable Object)에서 실행한다(hasher.ts).

import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Env } from "./env";

export const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Workers WebCrypto의 PBKDF2 최대 반복 횟수 */
const MAX_ITERATIONS = 100_000;

export interface SessionUser {
  id: number;
  email: string;
  nickname: string;
  role: "user" | "admin";
  suspended_at: number | null;
  suspended_reason: string | null;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

const encoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function passwordIterations(env: Env): number {
  const n = Number(env.PASSWORD_ITERATIONS);
  return Number.isInteger(n) && n >= 10_000 ? Math.min(n, MAX_ITERATIONS) : MAX_ITERATIONS;
}

/** 형식: pbkdf2_sha256$<반복횟수>$<salt base64>$<hash base64> */
export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, iter, salt, hash] = stored.split("$");
  if (algo !== "pbkdf2_sha256" || !iter || !salt || !hash) return false;
  const actual = await pbkdf2(password, fromBase64(salt), Number(iter));
  return timingSafeEqual(actual, fromBase64(hash));
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 세션을 만들고 쿠키를 심는다. DB에는 토큰의 해시만 저장한다. */
export async function startSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await c.env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(await sha256Hex(token), userId, now + SESSION_TTL_MS, now)
    .run();
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

export async function sessionUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.email, u.nickname, u.role, u.suspended_at, u.suspended_reason
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<SessionUser>();
  return row ?? null;
}

export function suspendedMessage(reason: string | null): string {
  return `이용이 정지된 계정입니다.${reason ? ` (사유: ${reason})` : ""}`;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "로그인이 필요합니다." }, 401);
  if (user.suspended_at) return c.json({ error: suspendedMessage(user.suspended_reason), suspended: true }, 403);
  c.set("user", user);
  await next();
};

/** 관리자 전용. 관리자 여부는 매 요청 DB의 role로 확인한다. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "로그인이 필요합니다." }, 401);
  if (user.role !== "admin" || user.suspended_at) return c.json({ error: "관리자만 접근할 수 있습니다." }, 403);
  c.set("user", user);
  await next();
};

/**
 * CSRF 방어: 상태를 바꾸는 요청은 JSON 본문 + 같은 출처(Origin)만 허용한다.
 * (SameSite=Lax 쿠키와 함께 이중으로 막는다)
 */
export const sameOriginJson: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    if (origin && origin !== new URL(c.req.url).origin) {
      return c.json({ error: "허용되지 않은 요청입니다." }, 403);
    }
    if (!c.req.header("Content-Type")?.includes("application/json")) {
      return c.json({ error: "JSON 요청만 허용됩니다." }, 415);
    }
  }
  await next();
};

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

/** 로그인 시도 제한. 허용되면 true */
export async function allowLoginAttempt(env: Env, key: string): Promise<boolean> {
  const now = Date.now();
  const row = await env.DB.prepare(
    `INSERT INTO login_attempts (key, count, reset_at) VALUES (?1, 1, ?2)
     ON CONFLICT(key) DO UPDATE SET
       count    = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
       reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
     RETURNING count`,
  )
    .bind(key, now + LOGIN_WINDOW_MS, now)
    .first<{ count: number }>();
  return (row?.count ?? 0) <= LOGIN_MAX_ATTEMPTS;
}

export async function clearLoginAttempts(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE key = ?").bind(key).run();
}
