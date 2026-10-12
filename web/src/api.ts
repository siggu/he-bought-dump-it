import type {
  ArenaState,
  Candle,
  GameDifficulty,
  GameQuestion,
  GameResult,
  GameStatus,
  InteractionSettings,
  MeResponse,
  MyProfile,
  OrderRow,
  Privacy,
  PublicBadge,
  PublicProfile,
  Quote,
  StockInfo,
} from "../../shared/protocol";

export interface AdminUser {
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
  search: (q: string) => request<{ results: StockInfo[] }>("GET", `/stocks/search?q=${encodeURIComponent(q)}`),
  stock: (symbol: string) => request<{ stock: StockInfo; quote: Quote | null }>("GET", `/stocks/${symbol}`),
  daily: (symbol: string) => request<{ candles: Candle[] }>("GET", `/stocks/${symbol}/daily`),
  order: (symbol: string, side: "buy" | "sell", quantity: number) =>
    request<{ result: { price: number; quantity: number; total: number }; me: MeResponse }>("POST", "/orders", {
      symbol,
      side,
      quantity,
    }),
  orders: () => request<{ orders: (OrderRow & { name: string | null })[] }>("GET", "/orders"),
  salary: () => request<MeResponse>("POST", "/salary"),
  game: () => request<GameStatus>("GET", "/game"),
  gameStart: (difficulty: GameDifficulty) => request<GameQuestion>("POST", "/game/start", { difficulty }),
  gameAnswer: (gameId: string, choice: string) => request<GameResult>("POST", "/game/answer", { gameId, choice }),
  adminUsers: (q: string) => request<{ users: AdminUser[] }>("GET", `/admin/users?q=${encodeURIComponent(q)}`),
  adminNickname: (id: number, nickname: string) =>
    request<{ nickname: string }>("POST", `/admin/users/${id}/nickname`, { nickname }),
  adminSuspend: (id: number, reason: string) => request<{ ok: true }>("POST", `/admin/users/${id}/suspend`, { reason }),
  adminUnsuspend: (id: number) => request<{ ok: true }>("POST", `/admin/users/${id}/unsuspend`),
  adminActions: () =>
    request<{ actions: { id: number; action: string; detail: string; createdAt: number; admin: string; target: string }[] }>(
      "GET",
      "/admin/actions",
    ),
  hallOfFame: () =>
    request<{ ranking: { nickname: string; bankruptCount: number; featuredBadge: PublicBadge | null }[] }>(
      "GET",
      "/hall-of-fame",
    ),
  myProfile: () => request<MyProfile>("GET", "/me/profile"),
  updateProfile: (input: {
    privacy?: Partial<Privacy>;
    interactionSettings?: Partial<InteractionSettings>;
    featuredBadge?: string | null;
    setupDone?: boolean;
  }) =>
    request<MyProfile>("POST", "/me/profile", input),
  changeNickname: (nickname: string) => request<MyProfile>("POST", "/me/nickname", { nickname }),
  favorite: (symbol: string, on: boolean) => request<{ favorites: string[] }>("POST", "/me/favorites", { symbol, on }),
  badgesSeen: () => request<{ ok: true }>("POST", "/me/badges/seen"),
  user: (nickname: string) => request<PublicProfile>("GET", `/users/${encodeURIComponent(nickname)}`),
  arena: (target?: string | null) =>
    request<ArenaState>("GET", target ? `/arena?target=${encodeURIComponent(target)}` : "/arena"),
  swap: (nickname: string, symbol: string) => request<ArenaState>("POST", "/arena/swap", { nickname, symbol }),
  raid: (nickname: string) =>
    request<{ id: string; question: Omit<GameQuestion, "gameId" | "expiresAt">; expiresAt: number }>("POST", "/arena/raid", {
      nickname,
    }),
  submitRaid: (id: string, choice: string, stake: number) =>
    request<ArenaState>("POST", `/arena/raid/${id}/submit`, { choice, stake }),
  duel: (nickname: string, symbol: string, stake: number) =>
    request<ArenaState>("POST", "/arena/duel", { nickname, symbol, stake }),
  respond: (id: string, action: "accept" | "decline" | "cancel", input: Record<string, unknown> = {}) =>
    request<ArenaState>("POST", `/arena/${id}/${action}`, input),
};
