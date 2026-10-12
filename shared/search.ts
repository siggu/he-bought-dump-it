// 종목 검색 (서버와 브라우저가 함께 쓰는 순수 함수)
// - 대소문자·공백·기호 무시: "s-oil" = "S-Oil", "삼성 전자" = "삼성전자"
// - 별칭: "네이버" → NAVER, "삼전" → 삼성전자, "하이닉스" → SK하이닉스
// - 초성: "ㅅㅅㅈㅈ" → 삼성전자

export interface SearchableStock {
  symbol: string;
  name: string;
  market: string;
  /** 쉼표로 구분된 별칭 */
  aliases?: string;
}

const CHOSEONG = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";

export function normalize(text: string): string {
  return text
    .normalize("NFC")
    .toLowerCase()
    .replace(/[\s\-_.&+·,()]/g, "");
}

/** 한글 음절을 초성으로 바꾼다. 한글이 아닌 글자는 그대로 둔다. */
export function toChoseong(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0) - 0xac00;
    out += code >= 0 && code <= 11171 ? CHOSEONG[Math.floor(code / 588)] : ch;
  }
  return out;
}

function isChoseongOnly(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => CHOSEONG.includes(ch));
}

/** 0이면 일치하지 않음. 클수록 더 잘 맞는다. */
export function matchScore(stock: SearchableStock, query: string): number {
  const q = normalize(query);
  if (!q) return 0;
  const names = [stock.name, ...(stock.aliases ? stock.aliases.split(",") : [])].map(normalize).filter(Boolean);
  let best = 0;

  if (stock.symbol === q) best = 100;
  else if (stock.symbol.startsWith(q)) best = 75;

  names.forEach((n, i) => {
    const alias = i > 0 ? 1 : 0; // 정식 이름을 별칭보다 살짝 우선
    if (n === q) best = Math.max(best, 100 - alias);
    else if (n.startsWith(q)) best = Math.max(best, 85 - alias);
    else if (n.includes(q)) best = Math.max(best, 60 - alias);
  });

  if (best === 0 && isChoseongOnly(q)) {
    names.forEach((n) => {
      const c = toChoseong(n);
      if (c.startsWith(q)) best = Math.max(best, 70);
      else if (c.includes(q)) best = Math.max(best, 50);
    });
  }
  return best;
}

/** 점수 높은 순 → 관심 종목 우선 → 이름 짧은 순 */
export function searchStocks<T extends SearchableStock>(
  stocks: T[],
  query: string,
  favorites: ReadonlySet<string> = new Set(),
  limit = 20,
): T[] {
  return stocks
    .map((s) => ({ s, score: matchScore(s, query) }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(favorites.has(b.s.symbol)) - Number(favorites.has(a.s.symbol)) ||
        a.s.name.length - b.s.name.length ||
        a.s.name.localeCompare(b.s.name, "ko"),
    )
    .slice(0, limit)
    .map((x) => x.s);
}
