import type { MeResponse } from "../../../shared/protocol";
import { won } from "../format";

/** 파산·재기 기준 안내 (서버의 worker/rules.ts 기준과 같다) */
export function BankruptRule({ me }: { me: MeResponse }) {
  const gap = me.totals.total - me.thresholds.bankrupt;
  return (
    <section className="card rule">
      <h2>⚖️ 파산 기준</h2>
      <ul>
        <li>
          <strong>총자산</strong>(현금 + 보유 주식 전체 평가액)이 <strong>{won(me.thresholds.bankrupt)} 미만</strong>이
          되면 파산합니다.
        </li>
        <li>파산하면 보유 주식은 모두 현재가로 강제 매도되고, 매매·상호작용이 잠깁니다.</li>
        <li>
          파산 상태에서 <strong>현금 {won(me.thresholds.recovery)} 이상</strong>을 모으면 재기합니다. (월급·미니게임)
        </li>
      </ul>
      {!me.user.isBankrupt && (
        <p className={`small ${gap < me.thresholds.bankrupt ? "down" : "muted"}`}>
          파산까지 남은 여유: {won(Math.max(0, gap))}
        </p>
      )}
    </section>
  );
}
