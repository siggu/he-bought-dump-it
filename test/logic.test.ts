import { describe, expect, it } from "vitest";
import type { Candle } from "../shared/protocol";
import { parseKisMessage, subscriptionMessage } from "../worker/hub/kis";
import { basePrice, mockDailyCandles } from "../worker/hub/mock";
import { changePct, normalize, pickIndex } from "../worker/game";
import {
  isMarketOpen,
  kst,
  kstDayStart,
  kstMonthStart,
  parseHolidays,
  roundToTick,
  tickSize,
} from "../worker/market";
import {
  GAME_WINDOW,
  bankruptThreshold,
  buySettlement,
  classifyMove,
  maxBuyQuantity,
  recoveryTarget,
  sellSettlement,
} from "../worker/rules";

// 2026-10-12(월) 10:00 KST = 01:00 UTC
const MON_10AM = Date.UTC(2026, 9, 12, 1, 0);

describe("KIS 실시간 메시지 파싱", () => {
  // ccnl_krx.py 컬럼 순서 기준 46개 필드
  const record = (symbol: string, price: number) => {
    const f = new Array(46).fill("0");
    f[0] = symbol;
    f[1] = "093001";
    f[2] = String(price);
    f[3] = "2";
    f[4] = "500";
    f[5] = "0.70";
    f[7] = "71000";
    f[8] = "72000";
    f[9] = "70500";
    f[13] = "1234567";
    return f.join("^");
  };

  it("단건 체결을 읽는다", () => {
    const msg = parseKisMessage(`0|H0STCNT0|001|${record("005930", 71500)}`);
    expect(msg.kind).toBe("trades");
    if (msg.kind !== "trades") return;
    expect(msg.trades).toEqual([
      {
        symbol: "005930",
        time: "093001",
        price: 71500,
        change: 500,
        rate: 0.7,
        open: 71000,
        high: 72000,
        low: 70500,
        volume: 1234567,
      },
    ]);
  });

  it("여러 건이 묶여 오면 건수만큼 나눈다", () => {
    const msg = parseKisMessage(`0|H0STCNT0|002|${record("005930", 71500)}^${record("005930", 71600)}`);
    expect(msg.kind === "trades" && msg.trades.map((t) => t.price)).toEqual([71500, 71600]);
  });

  it("PINGPONG과 구독 응답을 구분한다", () => {
    expect(parseKisMessage(JSON.stringify({ header: { tr_id: "PINGPONG", datetime: "20261012" } }))).toEqual({
      kind: "pingpong",
    });
    expect(
      parseKisMessage(
        JSON.stringify({
          header: { tr_id: "H0STCNT0", tr_key: "005930", encrypt: "N" },
          body: { rt_cd: "0", msg_cd: "OPSP0000", msg1: "SUBSCRIBE SUCCESS" },
        }),
      ),
    ).toEqual({ kind: "system", trId: "H0STCNT0", ok: true, message: "SUBSCRIBE SUCCESS" });
  });

  it("암호화 메시지와 깨진 메시지는 무시한다", () => {
    expect(parseKisMessage("1|H0STCNI0|001|abc").kind).toBe("unknown");
    expect(parseKisMessage("not json").kind).toBe("unknown");
  });

  it("구독 등록은 1, 해제는 2", () => {
    expect(JSON.parse(subscriptionMessage("k", "005930", true)).header.tr_type).toBe("1");
    expect(JSON.parse(subscriptionMessage("k", "005930", false)).header.tr_type).toBe("2");
    expect(JSON.parse(subscriptionMessage("k", "005930", true)).body.input).toEqual({
      tr_id: "H0STCNT0",
      tr_key: "005930",
    });
  });
});

describe("장 운영 시간", () => {
  const holidays = parseHolidays("2026-10-09, 잘못된값");

  it("휴장일 목록에서 잘못된 값은 버린다", () => {
    expect([...holidays]).toEqual(["2026-10-09"]);
  });

  it("평일 09:00~15:30만 열린다", () => {
    expect(isMarketOpen(MON_10AM, holidays)).toBe(true);
    expect(isMarketOpen(Date.UTC(2026, 9, 11, 23, 59), holidays)).toBe(false); // 08:59 KST
    expect(isMarketOpen(Date.UTC(2026, 9, 12, 6, 29), holidays)).toBe(true); // 15:29
    expect(isMarketOpen(Date.UTC(2026, 9, 12, 6, 30), holidays)).toBe(false); // 15:30
    expect(isMarketOpen(Date.UTC(2026, 9, 11, 1, 0), holidays)).toBe(false); // 일요일
    expect(isMarketOpen(Date.UTC(2026, 9, 9, 1, 0), holidays)).toBe(false); // 한글날
  });

  it("KST 날짜·월 경계", () => {
    // 2026-10-31 23:30 KST
    const t = Date.UTC(2026, 9, 31, 14, 30);
    expect(kst(t).date).toBe("2026-10-31");
    expect(kst(t + 60 * 60 * 1000).month).toBe("2026-11");
    expect(kstDayStart(t)).toBe(Date.UTC(2026, 9, 30, 15, 0));
    expect(kstMonthStart(t)).toBe(Date.UTC(2026, 8, 30, 15, 0));
  });

  it("호가 단위", () => {
    expect(tickSize(1_999)).toBe(1);
    expect(tickSize(19_990)).toBe(10);
    expect(tickSize(71_500)).toBe(100);
    expect(tickSize(600_000)).toBe(1_000);
    expect(roundToTick(71_549)).toBe(71_500);
  });
});

describe("매매 정산", () => {
  it("매수는 금액 + 수수료(내림)", () => {
    expect(buySettlement(71_500, 10)).toEqual({ amount: 715_000, fee: 107, tax: 0, total: 715_107 });
  });

  it("매도는 금액 - 수수료 - 거래세", () => {
    expect(sellSettlement(71_500, 10)).toEqual({ amount: 715_000, fee: 107, tax: 1_430, total: 713_463 });
  });

  it("최대 매수 수량은 수수료까지 감당할 수 있는 만큼", () => {
    const q = maxBuyQuantity(10_000_000, 71_500);
    expect(buySettlement(71_500, q).total).toBeLessThanOrEqual(10_000_000);
    expect(buySettlement(71_500, q + 1).total).toBeGreaterThan(10_000_000);
  });

  it("파산·복구 기준", () => {
    expect(bankruptThreshold(71_500)).toBe(100_000);
    expect(bankruptThreshold(1_200_000)).toBe(1_200_000);
    expect(recoveryTarget(71_500)).toBe(1_000_000);
    expect(recoveryTarget(1_200_000)).toBe(1_200_000);
  });
});

describe("미니게임", () => {
  it("난이도별 정답 분류", () => {
    expect(classifyMove("easy", 0.01)).toBe("up");
    expect(classifyMove("easy", -0.01)).toBe("down");
    expect(classifyMove("normal", 3)).toBe("big_up");
    expect(classifyMove("normal", 2.99)).toBe("flat");
    expect(classifyMove("normal", -3)).toBe("big_down");
    expect(classifyMove("hard", 2)).toBe("up2");
    expect(classifyMove("hard", 0.5)).toBe("up");
    expect(classifyMove("hard", 0)).toBe("down");
    expect(classifyMove("hard", -1.99)).toBe("down");
    expect(classifyMove("hard", -2)).toBe("down2");
  });

  it("등락률은 소수 둘째 자리", () => {
    expect(changePct(71_500, 73_000)).toBe(2.1);
    expect(changePct(10_000, 9_700)).toBe(-3);
  });

  const candles = (closes: number[]): Candle[] =>
    closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, open: c, high: c, low: c, close: c, volume: 0 }));

  it("앞뒤 봉이 충분한 위치만 고른다", () => {
    const list = candles(Array.from({ length: 45 }, (_, i) => 100 + i));
    for (const d of ["easy", "normal", "hard"] as const) {
      for (const r of [0, 0.5, 0.999]) {
        const i = pickIndex(list, d, () => r);
        expect(i).not.toBeNull();
        expect(i!).toBeGreaterThanOrEqual(GAME_WINDOW - 1);
        expect(i! + (d === "easy" ? 20 : d === "normal" ? 5 : 1)).toBeLessThan(list.length);
      }
    }
    // 쉬움은 20거래일이 더 필요하므로 30개로는 부족하다
    expect(pickIndex(candles(Array.from({ length: 30 }, () => 100)), "easy")).toBeNull();
  });

  it("정규화하면 기준 종가가 100이 되고 날짜가 숨겨진다", () => {
    const n = normalize(candles([50, 100, 200]), 100);
    expect(n.map((c) => c.close)).toEqual([50, 100, 200]);
    expect(n.map((c) => c.date)).toEqual(["D1", "D2", "D3"]);
    expect(normalize(candles([110]), 100, 20)[0]).toMatchObject({ date: "D21", close: 110 });
  });
});

describe("모의 시세", () => {
  it("종목별로 같은 기준가와 일봉을 만든다", () => {
    expect(basePrice("005930")).toBe(basePrice("005930"));
    const a = mockDailyCandles("005930", 100, MON_10AM);
    const b = mockDailyCandles("005930", 100, MON_10AM);
    expect(a).toEqual(b);
    expect(a).toHaveLength(100);
    expect(a[a.length - 1].date).toBe("2026-10-12");
    expect(a[a.length - 1].close).toBe(basePrice("005930"));
    expect(a.every((c) => c.low <= Math.min(c.open, c.close) && c.high >= Math.max(c.open, c.close))).toBe(true);
  });
});
