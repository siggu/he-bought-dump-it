// 프로필, 공개 범위, 닉네임 변경

import { PRIVACY_KEYS, type MyProfile, type Privacy, type PublicProfile } from "../shared/protocol";
import { loadHolding, loadUser, UserError } from "./account";
import { BADGES, ownedBadges, publicBadge } from "./badges";
import { type Env, priceHub } from "./env";

/** 닉네임 변경 주기: 마지막 변경 시각부터 72시간(3일). 가입 시 정한 닉네임은 변경으로 치지 않는다. */
export const NICKNAME_CHANGE_COOLDOWN_MS = 72 * 60 * 60 * 1000;
export const NICKNAME_RE = /^[가-힣a-zA-Z0-9_]{2,16}$/;
export const NICKNAME_RULE = "닉네임은 2~16자의 한글·영문·숫자·밑줄(_)만 쓸 수 있습니다.";

export function parsePrivacy(raw: string | null | undefined): Privacy {
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(raw ?? "{}") as Record<string, unknown>;
  } catch {
    // 기본값(전부 비공개)
  }
  return Object.fromEntries(PRIVACY_KEYS.map((k) => [k, obj[k] === true])) as Privacy;
}

function nicknameChangeAvailableAt(changedAt: number | null, now = Date.now()): number | null {
  if (!changedAt) return null;
  const at = changedAt + NICKNAME_CHANGE_COOLDOWN_MS;
  return at > now ? at : null;
}

export async function myProfile(env: Env, userId: number): Promise<MyProfile> {
  const user = await loadUser(env, userId);
  return {
    nickname: user.nickname,
    privacy: parsePrivacy(user.privacy),
    featuredBadgeId: user.featured_badge,
    badges: await ownedBadges(env, userId),
    totalBadges: BADGES.length,
    nicknameChangeAvailableAt: nicknameChangeAvailableAt(user.nickname_changed_at),
  };
}

export async function updateProfile(
  env: Env,
  userId: number,
  input: { privacy?: unknown; featuredBadge?: unknown; setupDone?: unknown },
): Promise<void> {
  const user = await loadUser(env, userId);
  let privacy = parsePrivacy(user.privacy);
  if (input.privacy && typeof input.privacy === "object") {
    privacy = parsePrivacy(JSON.stringify({ ...privacy, ...(input.privacy as object) }));
  }

  let featured = user.featured_badge;
  if (input.featuredBadge !== undefined) {
    if (input.featuredBadge === null) featured = null;
    else {
      const owned = await env.DB.prepare("SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?")
        .bind(userId, String(input.featuredBadge))
        .first();
      if (!owned) throw new UserError("획득한 배지만 대표 배지로 설정할 수 있습니다.");
      featured = String(input.featuredBadge);
    }
  }

  await env.DB.prepare(
    `UPDATE users SET privacy = ?, featured_badge = ?,
            profile_setup_done = CASE WHEN ? THEN 1 ELSE profile_setup_done END
      WHERE id = ?`,
  )
    .bind(JSON.stringify(privacy), featured, input.setupDone === true ? 1 : 0, userId)
    .run();
}

export async function changeNickname(env: Env, userId: number, nickname: string): Promise<void> {
  if (!NICKNAME_RE.test(nickname)) throw new UserError(NICKNAME_RULE);
  const user = await loadUser(env, userId);
  if (user.nickname === nickname) return;
  const now = Date.now();
  const availableAt = nicknameChangeAvailableAt(user.nickname_changed_at, now);
  if (availableAt) {
    const when = new Date(availableAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
    throw new UserError(`닉네임은 3일(72시간)에 한 번만 바꿀 수 있습니다. ${when} 이후에 다시 시도해 주세요.`, 409);
  }
  const taken = await env.DB.prepare("SELECT 1 FROM users WHERE nickname = ? AND id <> ?").bind(nickname, userId).first();
  if (taken) throw new UserError("이미 사용 중인 닉네임입니다.", 409);
  const res = await env.DB.prepare(
    `UPDATE users SET nickname = ?1, nickname_changed_at = ?2
      WHERE id = ?3 AND (nickname_changed_at IS NULL OR nickname_changed_at <= ?4)`,
  )
    .bind(nickname, now, userId, now - NICKNAME_CHANGE_COOLDOWN_MS)
    .run()
    .catch(() => null);
  if (!res || res.meta.changes !== 1) throw new UserError("닉네임을 바꾸지 못했습니다. 다시 시도해 주세요.", 409);
}

export async function markBadgesSeen(env: Env, userId: number): Promise<void> {
  await env.DB.prepare("UPDATE user_badges SET seen = 1 WHERE user_id = ? AND seen = 0").bind(userId).run();
}

/** 다른 사람에게 보이는 프로필. 공개하지 않은 항목은 null */
export async function publicProfile(env: Env, nickname: string): Promise<PublicProfile> {
  const row = await env.DB.prepare("SELECT id FROM users WHERE nickname = ?").bind(nickname).first<{ id: number }>();
  if (!row) throw new UserError("존재하지 않는 사용자입니다.", 404);
  const user = await loadUser(env, row.id);
  const p = parsePrivacy(user.privacy);

  const symbol = user.main_symbol;
  const stock = symbol
    ? await env.DB.prepare("SELECT symbol, name FROM stocks WHERE symbol = ?").bind(symbol).first<{ symbol: string; name: string }>()
    : null;

  let totalAssets: number | null = null;
  let profitRate: number | null = null;
  if ((p.totalAssets || p.profitRate) && symbol) {
    const holding = await loadHolding(env, user.id, symbol);
    const quote = await priceHub(env)
      .getQuote(symbol)
      .catch(() => null);
    const price = quote?.price ?? holding?.avg_price ?? 0;
    const qty = holding?.quantity ?? 0;
    if (p.totalAssets) totalAssets = user.cash + qty * price;
    if (p.profitRate) {
      profitRate = qty > 0 && holding ? Math.round(((price - holding.avg_price) / holding.avg_price) * 10_000) / 100 : 0;
    }
  } else if (p.totalAssets) {
    totalAssets = user.cash;
  }

  let recentTrades: PublicProfile["recentTrades"] = null;
  if (p.recentTrades) {
    const { results } = await env.DB.prepare(
      `SELECT COALESCE(s.name, o.symbol) AS name, o.side, o.created_at AS createdAt
         FROM orders o LEFT JOIN stocks s ON s.symbol = o.symbol
        WHERE o.user_id = ? ORDER BY o.id DESC LIMIT 5`,
    )
      .bind(user.id)
      .all<{ name: string; side: "buy" | "sell" | "liquidation"; createdAt: number }>();
    recentTrades = results;
  }

  return {
    nickname: user.nickname,
    featuredBadge: user.featured_badge ? publicBadge(user.featured_badge) : null,
    joinedAt: user.created_at,
    badges: p.badges
      ? (await ownedBadges(env, user.id)).map(({ id, name, tier, flavor }) => ({ id, name, tier, flavor }))
      : null,
    mainStock: p.mainSymbol ? stock : null,
    bankruptCount: p.bankruptCount ? user.bankrupt_count : null,
    totalAssets,
    profitRate,
    recentTrades,
  };
}
