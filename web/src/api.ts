import type {
  Candle,
  GameDifficulty,
  GameQuestion,
  GameResult,
  GameStatus,
  MeResponse,
  MyProfile,
  OrderRow,
  Privacy,
  PublicBadge,
  PublicProfile,
  StockInfo,
} from "../../shared/protocol";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(data.error ?? `요청 실패 (${res.status})`, res.status);
  return data as T;
}

export const api = {
  signup: (email: string, password: string, nickname: string) =>
    request<{ ok: true }>("POST", "/auth/signup", { email, password, nickname }),
  login: (email: string, password: string) => request<{ ok: true }>("POST", "/auth/login", { email, password }),
  logout: () => request<{ ok: true }>("POST", "/auth/logout"),
  me: () => request<MeResponse>("GET", "/me"),
  setMainSymbol: (symbol: string) => request<MeResponse>("POST", "/me/main-symbol", { symbol }),
  search: (q: string) => request<{ results: StockInfo[] }>("GET", `/stocks/search?q=${encodeURIComponent(q)}`),
  stock: (symbol: string) => request<{ stock: StockInfo }>("GET", `/stocks/${symbol}`),
  daily: (symbol: string) => request<{ candles: Candle[] }>("GET", `/stocks/${symbol}/daily`),
  order: (side: "buy" | "sell", quantity: number) =>
    request<{ result: { price: number; quantity: number; total: number }; me: MeResponse }>("POST", "/orders", {
      side,
      quantity,
    }),
  orders: () => request<{ orders: (OrderRow & { name: string | null })[] }>("GET", "/orders"),
  salary: () => request<MeResponse>("POST", "/salary"),
  game: () => request<GameStatus>("GET", "/game"),
  gameStart: (difficulty: GameDifficulty) => request<GameQuestion>("POST", "/game/start", { difficulty }),
  gameAnswer: (gameId: string, choice: string) => request<GameResult>("POST", "/game/answer", { gameId, choice }),
  hallOfFame: () =>
    request<{ ranking: { nickname: string; bankruptCount: number; featuredBadge: PublicBadge | null }[] }>(
      "GET",
      "/hall-of-fame",
    ),
  myProfile: () => request<MyProfile>("GET", "/me/profile"),
  updateProfile: (input: { privacy?: Partial<Privacy>; featuredBadge?: string | null; setupDone?: boolean }) =>
    request<MyProfile>("POST", "/me/profile", input),
  changeNickname: (nickname: string) => request<MyProfile>("POST", "/me/nickname", { nickname }),
  badgesSeen: () => request<{ ok: true }>("POST", "/me/badges/seen"),
  user: (nickname: string) => request<PublicProfile>("GET", `/users/${encodeURIComponent(nickname)}`),
};
