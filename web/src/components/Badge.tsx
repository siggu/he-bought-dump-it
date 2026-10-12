import { Link } from "react-router-dom";
import type { BadgeTier, PublicBadge } from "../../../shared/protocol";

export const TIER_LABEL: Record<BadgeTier, string> = {
  common: "일반",
  rare: "희귀",
  epic: "영웅",
  legendary: "전설",
};

export function BadgeChip({ badge, title }: { badge: PublicBadge; title?: string }) {
  return (
    <span className={`badge-chip ${badge.tier}`} title={title ?? `${TIER_LABEL[badge.tier]} · ${badge.flavor}`}>
      {badge.name}
    </span>
  );
}

/** 대표 배지 + 닉네임 (프로필 링크) */
export function Nickname({
  nickname,
  badge,
  link = true,
}: {
  nickname: string;
  badge: PublicBadge | null;
  link?: boolean;
}) {
  const inner = (
    <>
      {badge && <BadgeChip badge={badge} />}
      <span className="nick">{nickname}</span>
    </>
  );
  return link ? (
    <Link className="nickname-line" to={`/u/${encodeURIComponent(nickname)}`}>
      {inner}
    </Link>
  ) : (
    <span className="nickname-line">{inner}</span>
  );
}
