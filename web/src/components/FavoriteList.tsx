import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth";
import { catalogNow, loadCatalog } from "../catalog";
import { FavoriteButton } from "./FavoriteButton";

/** 관심 종목(★) 목록. editable이면 ★를 눌러 바로 뺄 수 있다. */
export function FavoriteList({ editable = false }: { editable?: boolean }) {
  const { me } = useAuth();
  const [catalog, setCatalog] = useState(catalogNow);

  useEffect(() => {
    if (catalog.length === 0) loadCatalog().then(setCatalog).catch(() => undefined);
  }, [catalog.length]);

  const favorites = me?.favorites ?? [];
  if (favorites.length === 0) {
    return <p className="muted small">아직 관심 종목이 없어요. 종목 화면에서 ☆를 눌러 추가해 보세요.</p>;
  }
  const name = (symbol: string) => catalog.find((s) => s.symbol === symbol)?.name ?? symbol;

  return (
    <div className="chips">
      {favorites.map((symbol) =>
        editable ? (
          <span key={symbol} className="chip fav editable">
            <FavoriteButton symbol={symbol} />
            <Link to={`/stocks/${symbol}`}>{name(symbol)}</Link>
          </span>
        ) : (
          <Link key={symbol} className="chip fav" to={`/stocks/${symbol}`}>
            <span className="fav-star">★</span>
            {name(symbol)}
          </Link>
        ),
      )}
    </div>
  );
}
