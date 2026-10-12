import { useEffect, useMemo, useRef, useState } from "react";
import type { StockInfo } from "../../../shared/protocol";
import { searchStocks } from "../../../shared/search";
import { useAuth } from "../auth";
import { catalogNow, loadCatalog } from "../catalog";

/**
 * 종목 검색 자동완성. 전체 종목 목록을 브라우저에 받아 두고 입력할 때마다 즉시 거른다(서버 왕복 없음).
 * 관심 종목은 ★로 표시하고 위쪽에 보여 준다. 검색어가 비어 있으면 관심 종목 목록을 보여 준다.
 */
export function StockSearch({
  onSelect,
  placeholder = "종목명·코드·초성 검색 (예: 네이버, 삼전, ㅅㅅㅈㅈ)",
  autoFocus = false,
}: {
  onSelect: (stock: StockInfo) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { me } = useAuth();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [catalog, setCatalog] = useState<StockInfo[]>(catalogNow);
  const box = useRef<HTMLDivElement>(null);
  const favorites = useMemo(() => new Set(me?.favorites ?? []), [me?.favorites]);

  useEffect(() => {
    if (catalog.length === 0) loadCatalog().then(setCatalog).catch(() => undefined);
  }, [catalog.length]);

  const results = useMemo(() => {
    const term = q.trim();
    if (term) return searchStocks(catalog, term, favorites);
    return catalog.filter((s) => favorites.has(s.symbol));
  }, [q, catalog, favorites]);

  useEffect(() => setActive(0), [q]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (s: StockInfo) => {
    onSelect(s);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="search" ref={box}>
      <input
        type="search"
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-label="종목 검색"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter" && results[active]) pick(results[active]);
          else if (e.key === "Escape") setOpen(false);
        }}
      />
      {open && (results.length > 0 || q.trim()) && (
        <ul className="search-results" role="listbox">
          {!q.trim() && <li className="search-caption">★ 관심 종목</li>}
          {results.map((s, i) => (
            <li key={s.symbol} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={i === active ? "active" : ""}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(s);
                }}
              >
                <span>
                  {favorites.has(s.symbol) && <span className="fav-star">★</span>}
                  {s.name}
                </span>
                <small>
                  {s.symbol} · {s.market}
                </small>
              </button>
            </li>
          ))}
          {q.trim() && results.length === 0 && <li className="search-caption">'{q}'에 맞는 종목이 없어요.</li>}
        </ul>
      )}
    </div>
  );
}
