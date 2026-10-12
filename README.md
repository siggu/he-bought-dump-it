# 📉 그가 샀습니다

한 종목에 올인하는 **실시간 주식 모의 투자** 서비스입니다. 돈을 다 잃으면(파산) 주가 맞히기 미니게임과 월급으로 재기해야 합니다.

- **계정당 1종목**: 메인 종목 하나만 사고팔 수 있습니다. 다른 종목은 검색해서 실시간 시세만 볼 수 있습니다.
- **실시간 시세**: 한국투자증권(KIS) Open API 실시간 체결가(H0STCNT0)를 서버가 받아 브라우저로 중계합니다.
- **파산과 재기**: 총자산이 기준 아래로 떨어지면 보유 주식이 강제 청산되고 매매가 잠깁니다. 미니게임 상금과 월급(매달 100만원)으로 현금 100만원을 모으면 매매를 다시 할 수 있습니다.
- **로그인/로그아웃**: 이메일과 비밀번호로 가입합니다. 세션은 httpOnly 쿠키로 관리합니다.

## 구조

모든 구성 요소가 Cloudflare 한 곳에서 돌아가며, 무료 플랜으로 운영할 수 있습니다.

```
브라우저 (React SPA)
   │  REST /api/*            WebSocket /api/ws (종목 구독/해제)
   ▼                               │
Cloudflare Worker (Hono) ──────────┤
   │  D1 (SQLite): 회원·세션·잔고·주문·게임
   │                               ▼
   │                   PriceHub (Durable Object, 서비스 전체 1개)
   │                     · 브라우저 WebSocket 전부 수용 (Hibernation)
   │                     · 구독 종목의 합집합만 KIS에 등록 (서버 측 팬아웃)
   │                     · 종목당 1초 1회로 묶어서 전송
   │                               │ ws://ops.koreainvestment.com:21000
   └─ PasswordHasher (DO)          ▼
      비밀번호 해시 전용        한국투자증권 Open API
```

### 트래픽 절감 장치
| 장치 | 설명 |
| --- | --- |
| 서버 측 팬아웃 | 사용자가 몇 명이든 KIS 쪽 실시간 등록은 "지금 누군가 보고 있는 종목 수"만큼만 생깁니다(최대 40종목). |
| 구독 수 제한 | 연결 1개당 동시 구독은 메인 종목 1개와 조회 중인 종목 1개, 합쳐 2개까지입니다. 페이지를 떠나면 바로 해제합니다. |
| 스로틀링 | 체결이 아무리 많아도 브라우저에는 종목당 1초에 1번만 보냅니다. |
| 짧은 메시지 | `{"type":"tick","s":"005930","p":71500,...}`처럼 짧은 키를 씁니다. |
| 숨은 탭 정지 | 탭이 15초 이상 숨겨져 있으면 연결을 끊고, 다시 보이면 재연결합니다. |
| 장외 시간 | 장이 닫혀 있으면 KIS 실시간 연결을 끊고 REST 현재가(캐시)만 씁니다. |

## 규칙

| 항목 | 값 |
| --- | --- |
| 가입 시 지급 | 10,000,000원 (가입한 달의 월급을 대신함) |
| 월급 | 매달(KST) 1회 1,000,000원 |
| 주문 | 시장가, 서버 최신 시세로 체결, 평일 09:00~15:30만 가능 |
| 수수료 / 거래세 | 0.015% / 매도 시 0.20% |
| 파산 | 총자산 < max(메인 종목 1주 가격, 10만원) → 보유 주식 강제 청산, 매매 잠금 |
| 재기 | 파산 상태에서 현금 ≥ max(1주 가격, 100만원) |
| 메인 종목 변경 | 보유 수량 0일 때만, 7일에 1회 |

### 미니게임: 주가 맞히기 (파산했을 때만)
실제 과거 일봉으로 문제를 만듭니다. 정답은 서버만 알고 있어서 클라이언트를 조작해 점수를 만들 수 없습니다.

| 난이도 | 문제 | 선택지 | 정답 상금 |
| --- | --- | --- | --- |
| 쉬움 | 인기 종목과 실제 날짜를 공개합니다. 20거래일 동안 **올랐을까, 내렸을까?** | 2 | 100,000원 |
| 보통 | 종목과 날짜를 숨깁니다. **5거래일 뒤** 종가가 +3% 이상 / ±3% 이내 / −3% 이하 중 어디일까? | 3 | 300,000원 |
| 어려움 | 종목과 날짜를 숨깁니다. **다음 날** 등락률이 +2%↑ / 0~+2% / −2%~0 / −2%↓ 중 어디일까? | 4 | 600,000원 |

- 하이리스크 하이리턴: 어려울수록 맞히기 어렵지만 상금이 큽니다. 틀리면 상금은 없고 기회만 사라집니다.
- **하루 3회, 한 달 10회**까지 할 수 있습니다. 문제를 받는 순간 1회가 차감되고, 2분 안에 답해야 합니다.

## 로컬 실행

```bash
npm install
npm run db:migrate:local      # 로컬 D1에 테이블 생성 + 종목 데이터
npm run dev                   # 프론트 빌드 후 http://localhost:8787
```

- KIS 키가 없으면 **모의 시세**(랜덤 워크)로 동작하며, 이때는 24시간 주문할 수 있습니다.
- 실제 시세로 보려면 `.dev.vars.example`을 `.dev.vars`로 복사하고 `KIS_APP_KEY`, `KIS_APP_SECRET`을 채우세요.
- 프론트만 수정할 때는 `npm run dev:web`(Vite, 5173 포트)을 쓰면 `/api`가 8787 포트로 프록시됩니다.

검사 명령:

```bash
npm run typecheck && npm test && npm run build
```

## 배포 (GitHub → Cloudflare)

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 다음을 자동으로 처리합니다.

1. D1 데이터베이스 생성 (없을 때만)
2. 마이그레이션 적용
3. Worker 배포
4. KIS 시크릿 등록

### 처음 한 번만 설정
1. **Cloudflare 계정**을 만들고, 대시보드의 *Workers & Pages*에 한 번 들어가서 `workers.dev` 서브도메인을 등록합니다.
2. **API 토큰 발급**: Cloudflare 대시보드 → *My Profile → API Tokens → Create Token*
   - 템플릿 *Edit Cloudflare Workers*를 고르고 권한에 **Account · D1 · Edit**를 추가합니다.
3. **Account ID 확인**: *Workers & Pages* 화면 오른쪽에 있습니다.
4. GitHub 저장소 *Settings → Secrets and variables → Actions*에 다음을 등록합니다.

   | 이름 | 필수 | 내용 |
   | --- | --- | --- |
   | `CLOUDFLARE_API_TOKEN` | ✅ | 2번의 토큰 |
   | `CLOUDFLARE_ACCOUNT_ID` | ✅ | 3번의 ID |
   | `KIS_APP_KEY` | 선택 | 한국투자증권 앱키 (없으면 모의 시세) |
   | `KIS_APP_SECRET` | 선택 | 한국투자증권 앱시크릿 |

5. `main`에 push하거나 *Actions → Deploy to Cloudflare → Run workflow*를 실행합니다. 배포 주소는 `https://he-bought-dump-it.<서브도메인>.workers.dev`입니다.

### 한국투자증권 Open API 키
[KIS Developers](https://apiportal.koreainvestment.com)에서 계좌를 연결하고 앱키와 앱시크릿을 발급받습니다. 연동 방식은 공식 샘플 [koreainvestment/open-trading-api](https://github.com/koreainvestment/open-trading-api)를 따릅니다.

- 모의투자용 키라면 `wrangler.jsonc`의 `KIS_ENV`를 `demo`로 바꿉니다.
- 접근 토큰은 재발급할 때마다 알림톡이 가기 때문에, 서버가 Durable Object 저장소에 캐시해서 하루 1번만 발급받습니다.

## 설정값 (`wrangler.jsonc`의 `vars`)

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `PRICE_FEED` | `auto` | `auto`: KIS 키가 있으면 실제 시세 / `mock`: 항상 모의 시세 |
| `KIS_ENV` | `real` | `real`(실전 키) / `demo`(모의투자 키) |
| `MARKET_HOLIDAYS` | 2026년 휴장일 | KRX 휴장일 목록(YYYY-MM-DD, 쉼표 구분). **매년 갱신해야 합니다.** |
| `PASSWORD_ITERATIONS` | 100000 | PBKDF2 반복 횟수 |

## 알아둘 점
- **KIS 실시간 연결 검증 필요**: KIS 웹소켓은 비표준 포트(`:21000`)를 씁니다. Workers는 `compatibility_date` 2024-09-02 이후부터 사용자 지정 포트를 허용하므로 동작할 것으로 예상합니다. 다만 실제 키로 연결 테스트를 하지 못했습니다. 배포 후 실시간 시세가 안 들어오면 Cloudflare 대시보드의 Worker 로그(`KIS realtime connect failed`)를 확인하세요. 실시간 연결이 안 되는 동안에도 30초마다 REST 현재가로 갱신합니다.
- **종목 목록**: 검색용 종목은 주요 125개(`migrations/0002_seed_stocks.sql`)입니다. 전체 종목이 필요하면 KIS 종목 마스터 파일(`kospi_code.mst`, `kosdaq_code.mst`)로 `stocks` 테이블을 채우면 됩니다.
- 장 시작일(1월 첫 거래일)이나 수능일처럼 개장 시간이 늦춰지는 날은 반영하지 않았습니다.
