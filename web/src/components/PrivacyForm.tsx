import { PRIVACY_KEYS, type Privacy, type PrivacyKey } from "../../../shared/protocol";

const LABELS: Record<PrivacyKey, { title: string; desc: string }> = {
  badges: { title: "획득한 배지", desc: "모은 배지 목록 (획득 조건은 다른 사람에게 보이지 않아요)" },
  mainSymbol: { title: "메인 종목", desc: "내가 올인한 종목" },
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
