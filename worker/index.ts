import { Hono } from "hono";
import type { GameDifficulty, OrderRow, StockInfo } from "../shared/protocol";
import {
  buildMe,
  claimSalary,
  placeOrder,
  setMainSymbol,
  UserError,
} from "./account";
import {
  type AppEnv,
  allowLoginAttempt,
  clearLoginAttempts,
  endSession,
  passwordIterations,
  requireAuth,
  sameOriginJson,
  sessionUser,
  startSession,
} from "./auth";
import { priceHub } from "./env";
import { passwordHasher } from "./hasher";
import {
  NICKNAME_RE,
  NICKNAME_RULE,
  changeNickname,
  markBadgesSeen,
  myProfile,
  publicProfile,
  updateProfile,
} from "./profile";
import { publicBadge } from "./badges";
import { DIFFICULTIES, answerGame, gameStatus, startGame } from "./game";
import { INITIAL_CASH } from "./rules";
import { kst } from "./market";

export { PasswordHasher } from "./hasher";
export { PriceHub } from "./hub/PriceHub";

const app = new Hono<AppEnv>().basePath("/api");

app.onError((err, c) => {
  if (err instanceof UserError) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: "서버 오류가 발생했습니다." }, 500);
});

app.use("*", sameOriginJson);

async function body<T>(req: Request): Promise<Partial<T>> {
  try {
    const data = await req.json();
    return data && typeof data === "object" ? (data as Partial<T>) : {};
  } catch {
    return {};
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SYMBOL_RE = /^[0-9A-Z]{6}$/;

// ------------------------------------------------------------------ 인증

app.post("/auth/signup", async (c) => {
  const { email, password, nickname } = await body<{ email: string; password: string; nickname: string }>(c.req.raw);
  const mail = String(email ?? "").trim().toLowerCase();
  const nick = String(nickname ?? "").trim();
  const pw = String(password ?? "");
  if (!EMAIL_RE.test(mail) || mail.length > 254) return c.json({ error: "이메일 형식이 올바르지 않습니다." }, 400);
  if (pw.length < 8 || pw.length > 128) return c.json({ error: "비밀번호는 8~128자로 입력해 주세요." }, 400);
  if (!NICKNAME_RE.test(nick)) return c.json({ error: NICKNAME_RULE }, 400);

  const exists = await c.env.DB.prepare("SELECT email, nickname FROM users WHERE email = ? OR nickname = ?")
    .bind(mail, nick)
    .first<{ email: string; nickname: string }>();
  if (exists) {
    return c.json({ error: exists.email === mail ? "이미 가입된 이메일입니다." : "이미 사용 중인 닉네임입니다." }, 409);
  }

  const now = Date.now();
  const hash = await passwordHasher(c.env).hash(pw, passwordIterations(c.env));
  const user = await c.env.DB.prepare(
    // 가입한 달은 초기 자금이 월급을 대신한다.
    `INSERT INTO users (email, nickname, password_hash, cash, last_salary_month, created_at)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(mail, nick, hash, INITIAL_CASH, kst(now).month, now)
    .first<{ id: number }>()
    .catch(() => null);
  if (!user) return c.json({ error: "이미 가입된 이메일 또는 닉네임입니다." }, 409);
  await c.env.DB.prepare("INSERT INTO cash_events (user_id, type, amount, created_at) VALUES (?, 'signup', ?, ?)")
    .bind(user.id, INITIAL_CASH, now)
    .run();
  await startSession(c, user.id);
  return c.json({ ok: true }, 201);
});

app.post("/auth/login", async (c) => {
  const { email, password } = await body<{ email: string; password: string }>(c.req.raw);
  const mail = String(email ?? "").trim().toLowerCase();
  const limitKey = `login:${mail}`;
  if (!(await allowLoginAttempt(c.env, limitKey))) {
    return c.json({ error: "로그인 시도가 너무 많습니다. 15분 뒤 다시 시도해 주세요." }, 429);
  }
  const user = await c.env.DB.prepare("SELECT id, password_hash FROM users WHERE email = ?")
    .bind(mail)
    .first<{ id: number; password_hash: string }>();
  if (!user || !(await passwordHasher(c.env).verify(String(password ?? ""), user.password_hash))) {
    return c.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, 401);
  }
  await clearLoginAttempts(c.env, limitKey);
  await startSession(c, user.id);
  return c.json({ ok: true });
});

app.post("/auth/logout", async (c) => {
  await endSession(c);
  return c.json({ ok: true });
});

// ------------------------------------------------------- 실시간 시세 WS

app.get("/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") return c.json({ error: "WebSocket 요청이 아닙니다." }, 426);
  const origin = c.req.header("Origin");
  if (origin && origin !== new URL(c.req.url).origin) return c.json({ error: "허용되지 않은 출처입니다." }, 403);
  const user = await sessionUser(c);
  if (!user) return c.json({ error: "로그인이 필요합니다." }, 401);
  const headers = new Headers(c.req.raw.headers);
  headers.set("X-User-Id", String(user.id));
  return priceHub(c.env).fetch(new Request(c.req.raw.url, { headers }));
});

// ------------------------------------------------------------ 로그인 필요

app.use("/me/*", requireAuth);
app.use("/me", requireAuth);
app.use("/stocks/*", requireAuth);
app.use("/orders", requireAuth);
app.use("/salary", requireAuth);
app.use("/game", requireAuth);
app.use("/game/*", requireAuth);
app.use("/hall-of-fame", requireAuth);
app.use("/users/*", requireAuth);

app.get("/me", async (c) => c.json(await buildMe(c.env, c.get("user").id)));

app.post("/me/main-symbol", async (c) => {
  const { symbol } = await body<{ symbol: string }>(c.req.raw);
  const s = String(symbol ?? "").toUpperCase();
  if (!SYMBOL_RE.test(s)) return c.json({ error: "잘못된 종목코드입니다." }, 400);
  await setMainSymbol(c.env, c.get("user").id, s);
  return c.json(await buildMe(c.env, c.get("user").id));
});

app.get("/me/profile", async (c) => c.json(await myProfile(c.env, c.get("user").id)));

app.post("/me/profile", async (c) => {
  const input = await body<{ privacy: unknown; featuredBadge: unknown; setupDone: unknown }>(c.req.raw);
  await updateProfile(c.env, c.get("user").id, input);
  return c.json(await myProfile(c.env, c.get("user").id));
});

app.post("/me/nickname", async (c) => {
  const { nickname } = await body<{ nickname: string }>(c.req.raw);
  await changeNickname(c.env, c.get("user").id, String(nickname ?? "").trim());
  return c.json(await myProfile(c.env, c.get("user").id));
});

app.post("/me/badges/seen", async (c) => {
  await markBadgesSeen(c.env, c.get("user").id);
  return c.json({ ok: true });
});

app.get("/users/:nickname", async (c) => c.json(await publicProfile(c.env, c.req.param("nickname"))));

app.get("/stocks/search", async (c) => {
  const q = (c.req.query("q") ?? "").trim();
  if (q.length === 0) return c.json({ results: [] });
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT symbol, name, market FROM stocks
      WHERE name LIKE ?1 ESCAPE '\\' OR symbol LIKE ?1 ESCAPE '\\'
      ORDER BY (name = ?2 OR symbol = ?2) DESC, length(name), name
      LIMIT 20`,
  )
    .bind(like, q)
    .all<StockInfo>();
  return c.json({ results });
});

app.get("/stocks/:symbol", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  const stock = await c.env.DB.prepare("SELECT symbol, name, market FROM stocks WHERE symbol = ?")
    .bind(symbol)
    .first<StockInfo>();
  if (!stock) return c.json({ error: "존재하지 않는 종목입니다." }, 404);
  return c.json({ stock });
});

app.get("/stocks/:symbol/daily", async (c) => {
  const symbol = c.req.param("symbol").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) return c.json({ error: "잘못된 종목코드입니다." }, 400);
  // 등록된 종목만 조회해 KIS 호출량을 아낀다.
  const known = await c.env.DB.prepare("SELECT 1 FROM stocks WHERE symbol = ?").bind(symbol).first();
  if (!known) return c.json({ error: "존재하지 않는 종목입니다." }, 404);
  const candles = await priceHub(c.env).getDailyCandles(symbol);
  c.header("Cache-Control", "private, max-age=300");
  return c.json({ candles });
});

app.post("/orders", async (c) => {
  const { side, quantity } = await body<{ side: string; quantity: number }>(c.req.raw);
  if (side !== "buy" && side !== "sell") return c.json({ error: "주문 구분이 올바르지 않습니다." }, 400);
  const result = await placeOrder(c.env, c.get("user").id, side, Number(quantity));
  return c.json({ result, me: await buildMe(c.env, c.get("user").id) });
});

app.get("/orders", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT o.id, o.symbol, s.name, o.side, o.quantity, o.price, o.amount, o.fee, o.tax, o.created_at AS createdAt
       FROM orders o LEFT JOIN stocks s ON s.symbol = o.symbol
      WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 100`,
  )
    .bind(c.get("user").id)
    .all<OrderRow & { name: string | null }>();
  return c.json({ orders: results });
});

app.post("/salary", async (c) => {
  await claimSalary(c.env, c.get("user").id);
  return c.json(await buildMe(c.env, c.get("user").id));
});

app.get("/game", async (c) => c.json(await gameStatus(c.env, c.get("user").id)));

app.post("/game/start", async (c) => {
  const { difficulty } = await body<{ difficulty: string }>(c.req.raw);
  if (!DIFFICULTIES.includes(difficulty as GameDifficulty)) return c.json({ error: "난이도를 골라 주세요." }, 400);
  return c.json(await startGame(c.env, c.get("user").id, difficulty as GameDifficulty));
});

app.post("/game/answer", async (c) => {
  const { gameId, choice } = await body<{ gameId: string; choice: string }>(c.req.raw);
  if (typeof gameId !== "string" || typeof choice !== "string") return c.json({ error: "잘못된 요청입니다." }, 400);
  return c.json(await answerGame(c.env, c.get("user").id, gameId, choice));
});

app.get("/hall-of-fame", async (c) => {
  // 파산 횟수를 공개한 사람만 올라간다.
  const { results } = await c.env.DB.prepare(
    `SELECT nickname, bankrupt_count AS bankruptCount, featured_badge AS featured FROM users
      WHERE bankrupt_count > 0 AND json_extract(privacy, '$.bankruptCount') = 1
      ORDER BY bankrupt_count DESC, id LIMIT 10`,
  ).all<{ nickname: string; bankruptCount: number; featured: string | null }>();
  return c.json({
    ranking: results.map((r) => ({
      nickname: r.nickname,
      bankruptCount: r.bankruptCount,
      featuredBadge: r.featured ? publicBadge(r.featured) : null,
    })),
  });
});

app.all("*", (c) => c.json({ error: "Not Found" }, 404));

export default app;
