export const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const num = (n: number) => Math.round(n).toLocaleString("ko-KR");
export const signed = (n: number) => `${n > 0 ? "+" : ""}${Math.round(n).toLocaleString("ko-KR")}`;
export const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
export const trend = (n: number) => (n > 0 ? "up" : n < 0 ? "down" : "flat");

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
}
