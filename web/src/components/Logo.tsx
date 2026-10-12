/**
 * "그가 샀습니다" 애니메이션 로고 (4초 반복)
 * 상한가까지 치솟음 → 꼭대기에서 BUY! → 하한가까지 폭락 (BUY!는 사라짐) → 잠시 멈춤 → 초기화
 */
export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className={`anim-logo ${size}`} aria-label="그가 샀습니다">
      <svg className="anim-logo-chart" viewBox="0 0 64 56" aria-hidden="true">
        {/* 상한가 / 하한가 기준선 */}
        <line className="limit upper" x1="2" y1="6" x2="62" y2="6" />
        <line className="limit lower" x1="2" y1="52" x2="62" y2="52" />
        <path className="rise" pathLength={100} d="M3 34 L11 29 L17 31 L25 20 L32 22 L40 6" />
        <path className="crash" pathLength={100} d="M40 6 L45 30 L50 27 L60 52" />
        <g className="pin">
          <circle cx="40" cy="6" r="3.4" />
          <text x="40" y="-1" textAnchor="middle">
            BUY!
          </text>
        </g>
      </svg>
      <span className="anim-logo-text" aria-hidden="true">
        <span className="he">그가</span>
        {[..."샀습니다"].map((ch, i) => (
          <span key={i} className="drop" style={{ animationDelay: `${i * 0.07}s` }}>
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}
