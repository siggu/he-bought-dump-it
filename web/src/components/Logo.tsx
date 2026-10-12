import { useState } from "react";

/**
 * 손나팔을 하고 외치는 삐에로 일러스트 (직접 그린 SVG).
 * web/public/clown.png 가 있으면 그 이미지를 대신 쓴다. (사용 권한이 있는 이미지만 넣을 것)
 */
function Clown() {
  const [useImage, setUseImage] = useState(true);
  if (useImage) {
    return <img className="clown-img" src="/clown.png" alt="" onError={() => setUseImage(false)} />;
  }
  return (
    <svg className="clown-svg" viewBox="0 0 100 100" aria-hidden="true">
      {/* 빨간 곱슬머리 */}
      <g fill="#ff3b30">
        <circle cx="22" cy="38" r="15" />
        <circle cx="30" cy="22" r="15" />
        <circle cx="50" cy="15" r="16" />
        <circle cx="70" cy="22" r="15" />
        <circle cx="78" cy="38" r="15" />
        <circle cx="18" cy="55" r="12" />
        <circle cx="82" cy="55" r="12" />
      </g>
      {/* 얼굴 */}
      <ellipse cx="50" cy="52" rx="25" ry="28" fill="#fff4ec" />
      {/* 눈 화장 + 눈 */}
      <path d="M36 37 q5 -6 10 0" stroke="#333" strokeWidth="2" fill="none" />
      <path d="M54 37 q5 -6 10 0" stroke="#333" strokeWidth="2" fill="none" />
      <circle cx="41" cy="44" r="3.4" fill="#2b1a10" />
      <circle cx="59" cy="44" r="3.4" fill="#2b1a10" />
      <circle cx="42" cy="43" r="1" fill="#fff" />
      <circle cx="60" cy="43" r="1" fill="#fff" />
      {/* 빨간 코 */}
      <circle cx="50" cy="54" r="7" fill="#ff2d20" />
      <circle cx="47.5" cy="51.5" r="2" fill="#ff8a80" />
      {/* 크게 벌린 입 */}
      <path d="M36 62 q14 22 28 0 z" fill="#c62828" stroke="#e53935" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M40 63 h20 l-2 4 h-16 z" fill="#fff" />
      <ellipse cx="50" cy="72" rx="6" ry="3" fill="#ff8a80" />
      {/* 손나팔 (흰 장갑) */}
      <g fill="#fff" stroke="#d0d4da" strokeWidth="1.5">
        <path d="M14 60 q4 -14 18 -6 l6 10 q-6 10 -16 8 q-10 -2 -8 -12 z" />
        <path d="M86 60 q-4 -14 -18 -6 l-6 10 q6 10 16 8 q10 -2 8 -12 z" />
      </g>
    </svg>
  );
}

/**
 * "그가 샀습니다" 애니메이션 로고. (4초 반복)
 * 차트가 오르다 꼭대기에 BUY! 핀이 꽂히는 순간 폭락하고, "샀습니다" 글자가 털썩 주저앉은 뒤
 * 삐에로가 튀어나와 "하면 그만이야~" 하고 외친다.
 */
export function Logo({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className={`anim-logo ${size}`} aria-label="그가 샀습니다">
      <span className="anim-logo-stage" aria-hidden="true">
        <svg className="anim-logo-chart" viewBox="0 0 64 36">
          <path className="rise" pathLength={100} d="M3 30 L13 23 L20 26 L30 15 L40 7" />
          <path className="crash" pathLength={100} d="M40 7 L45 28 L51 25 L60 33" />
          <g className="pin">
            <circle cx="40" cy="7" r="3.2" />
            <text x="40" y="2" textAnchor="middle">
              BUY!
            </text>
          </g>
        </svg>
        <span className="clown">
          <Clown />
          <span className="clown-bubble">하면 그만이야~</span>
        </span>
      </span>
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
