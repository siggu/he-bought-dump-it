import {
  INTERACTION_KEYS,
  PRIVACY_KEYS,
  type InteractionKey,
  type InteractionSettings,
  type Privacy,
  type PrivacyKey,
} from "../../../shared/protocol";

const LABELS: Record<PrivacyKey, { title: string; desc: string }> = {
  badges: { title: "획득한 배지", desc: "모은 배지 목록 (획득 조건은 다른 사람에게 보이지 않아요)" },
  holdings: { title: "보유 종목", desc: "가지고 있는 종목 이름 (수량·금액은 공개되지 않아요)" },
  bankruptCount: { title: "파산 횟수", desc: "공개하면 '파산 명예의 전당'에 오를 수 있어요" },
  totalAssets: { title: "총자산", desc: "현금 + 보유 주식 평가액" },
  profitRate: { title: "보유 종목 수익률", desc: "평균 단가 대비 현재 수익률" },
  recentTrades: { title: "최근 매매", desc: "최근 5건의 종목과 매수/매도 여부 (금액은 공개되지 않아요)" },
};

export function PrivacyForm({ value, onChange }: { value: Privacy; onChange: (next: Privacy) => void }) {
  return (
    <ul className="privacy-list">
      {PRIVACY_KEYS.map((k) => (
        <li key={k}>
          <label>
            <span>
              <strong>{LABELS[k].title}</strong>
              <small className="muted">{LABELS[k].desc}</small>
            </span>
            <span className="switch">
              <input
                type="checkbox"
                checked={value[k]}
                onChange={(e) => onChange({ ...value, [k]: e.target.checked })}
              />
              <span aria-hidden="true" />
              <em>{value[k] ? "공개" : "비공개"}</em>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export const ALL_PRIVATE: Privacy = Object.fromEntries(PRIVACY_KEYS.map((k) => [k, false])) as Privacy;

const INTERACTION_LABELS: Record<InteractionKey, { title: string; desc: string }> = {
  allowSwap: { title: "블라인드 박스 교환 받기", desc: "다른 개미가 이름을 가린 주식 1주와 교환을 제안할 수 있어요" },
  allowRaid: { title: "기습 털기 받기", desc: "결투에서 지면 내 주식 1주를 빼앗길 수 있어요 (이기면 판돈 획득)" },
  allowDuel: { title: "1:1 수익률 맞짱 받기", desc: "판돈을 걸고 7일간 종목 수익률 대결을 신청받아요" },
};

export function InteractionForm({
  value,
  onChange,
}: {
  value: InteractionSettings;
  onChange: (next: InteractionSettings) => void;
}) {
  return (
    <ul className="privacy-list">
      {INTERACTION_KEYS.map((k) => (
        <li key={k}>
          <label>
            <span>
              <strong>{INTERACTION_LABELS[k].title}</strong>
              <small className="muted">{INTERACTION_LABELS[k].desc}</small>
            </span>
            <span className="switch">
              <input type="checkbox" checked={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} />
              <span aria-hidden="true" />
              <em>{value[k] ? "받기" : "거부"}</em>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}
