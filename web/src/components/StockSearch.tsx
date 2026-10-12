import { useEffect, useRef, useState } from "react";
import type { StockInfo } from "../../../shared/protocol";
import { api } from "../api";

/** 종목 검색 자동완성 (입력 후 300ms 디바운스) */
export function StockSearch({
  onSelect,
  placeholder = "종목명 또는 코드 검색",
  autoFocus = false,
}: {
  onSelect: (stock: StockInfo) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<StockInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api
        .search(term)
        .then((r) => {
          setResults(r.results);
          setActive(0);
        })
        .catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [q]);

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
    setResults([]);
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
      {open && results.length > 0 && (
        <ul className="search-results" role="listbox">
          {results.map((s, i) => (
            <li key={s.symbol} role="option" aria-selected={i === active}>
              <button type="button" className={i === active ? "active" : ""} onMouseDown={() => pick(s)}>
                <span>{s.name}</span>
                <small>
                  {s.symbol} · {s.market}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
