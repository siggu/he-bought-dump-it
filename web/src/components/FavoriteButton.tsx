import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";

/** 관심 종목 별표 토글 */
export function FavoriteButton({ symbol }: { symbol: string }) {
  const { me, setMe } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  const on = me.favorites.includes(symbol);
  const toggle = async () => {
    setBusy(true);
    try {
      const { favorites } = await api.favorite(symbol, !on);
      setMe({ ...me, favorites });
    } catch (e) {
      window.alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className={`fav-button ${on ? "on" : ""}`}
      aria-pressed={on}
      title={on ? "관심 종목 해제" : "관심 종목에 추가"}
      disabled={busy}
      onClick={toggle}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
