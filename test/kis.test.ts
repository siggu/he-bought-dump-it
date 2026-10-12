import { afterEach, describe, expect, it, vi } from "vitest";
import { KisClient, type KeyValueStore } from "../worker/hub/kis";

function memoryStore(): KeyValueStore {
  const m = new Map<string, unknown>();
  return {
    get: async <T>(k: string) => m.get(k) as T | undefined,
    put: async <T>(k: string, v: T) => {
      m.set(k, v);
    },
  };
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe("KIS 클라이언트", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("동시에 여러 번 호출해도 접근 토큰은 한 번만 발급받는다", async () => {
    let tokenCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/oauth2/tokenP")) {
          tokenCalls++;
          await new Promise((r) => setTimeout(r, 30));
          return json({ access_token: "T", expires_in: 86400 });
        }
        return json({ rt_cd: "0", output: { stck_prpr: "71500", prdy_vrss: "500", prdy_ctrt: "0.70" } });
      }),
    );
    const kis = new KisClient("k", "s", "real", memoryStore());
    const quotes = await Promise.all(["005930", "000660", "035420"].map((s) => kis.quote(s)));
    expect(quotes.map((q) => q.price)).toEqual([71500, 71500, 71500]);
    expect(tokenCalls).toBe(1);
  });

  it("앞 호출의 응답을 기다리지 않고 다음 호출을 보낸다 (간격만 지킨다)", async () => {
    const started: number[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/oauth2/tokenP")) return json({ access_token: "T", expires_in: 86400 });
        started.push(Date.now());
        await new Promise((r) => setTimeout(r, 300)); // 느린 KIS 응답
        return json({ rt_cd: "0", output: { stck_prpr: "1000" } });
      }),
    );
    const kis = new KisClient("k", "s", "real", memoryStore());
    const t0 = Date.now();
    await Promise.all(["A00001", "A00002", "A00003", "A00004"].map((s) => kis.quote(s)));
    const elapsed = Date.now() - t0;
    // 응답을 차례로 기다렸다면 300ms × 4 = 1.2초 이상 걸린다.
    expect(elapsed).toBeLessThan(800);
    // 호출 시작 간격은 최소 간격(실전 70ms) 이상
    for (let i = 1; i < started.length; i++) expect(started[i] - started[i - 1]).toBeGreaterThanOrEqual(60);
  });
});
