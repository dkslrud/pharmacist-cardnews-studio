# 콘텐츠 스튜디오

모드: **카드뉴스**(이미지 레이아웃 그대로) / **영상**(레퍼런스 영상의 구조 그대로 — 스크립트·썸네일 분석 → 새 스크립트·썸네일 문구 제작). 영상은 유튜브 주소(자막 자동 수집), 썸네일 이미지, 스크립트 직접 붙여넣기를 지원합니다. 영상 음성 인식은 하지 않아 자막이 없으면 스크립트를 붙여넣어야 합니다.

1단계: 레퍼런스 카드뉴스 이미지(또는 인스타 게시물 주소) → 레이아웃 분석 + 장별 글자 위치·크기·색 추출
2단계: 마케팅 단계(유입 — 댓글 유도·저장·공유 / 전환 / 마감) + 반드시 포함할 내용 + (선택) 상세페이지·Q&A·베스트 리뷰 이미지 → 레퍼런스 구성(장 수·순서·글자 자리)은 그대로 두고 글자만 바꾼 문구, 구조화된 캡션(후킹 제목 → 공동구매 일정 → 혜택 → 포인트 → 섭취법 → Q&A → 구매 → 표기), 광고 규정 체크
3단계: 버튼 한 번으로 Canva에 디자인을 만들고 Canva 편집 화면으로 이동 (Canva 미연결 시 Canva AI 지시문 복사)

## 구조
- `public/index.html` 화면
- `api/*.js` Vercel 함수 (config, analyze, compose)
- `lib/core.js` 핵심 로직 (Claude API 호출)
- `lib/canva.js` Canva 연동 (로그인, 카드뉴스 → PPTX → Canva 가져오기)
- `api/canva/[action].js` Canva 라우트 (status, login, callback, create, logout)
- `server.js` 로컬 실행용 (`node server.js` → http://localhost:3000, `.env` 사용)

## 환경 변수
`.env.example` 참고. Vercel에서는 Project Settings → Environment Variables 에 넣습니다.

## 2026-10-05 수정
2단계 "응답 JSON을 해석하지 못했어요" 오류 수정.
- 원인: 답변 한도(max_tokens 5000)가 모델의 생각+답변을 다 담지 못해 JSON이 잘림
- 한도 16000으로 상향, 2단계는 구조화 출력(JSON 스키마)으로 형식 강제, 잘림·거절 시 이유 안내
- 이미지를 브라우저에서 줄여 보내 Vercel 요청 용량 제한(4.5MB)을 넘지 않게 함
- `vercel.json`에서 함수 실행 시간 300초로 설정

## 배포
Vercel 프로젝트 `pharmacist-cardnews-studio`가 이 저장소의 `main`에 연결되어 있어, `main`에 push하면 자동으로 배포됩니다.

## Canva 연동
레퍼런스 이미지는 쓰지 않고, 분석한 레이아웃(배경색, 도형, 이미지 자리, 글자 자리)을 같은 위치에 다시 그린 뒤 새 문구를 같은 크기·색으로 얹은 PPTX를 만들어 (레퍼런스 이미지가 없으면 새 레이아웃으로) Canva Connect API의 디자인 가져오기(`/v1/imports`)로 편집 가능한 Canva 디자인을 만들고, 편집 화면을 새 창으로 엽니다.
- 로그인: OAuth + PKCE. 토큰은 DB 없이 브라우저의 암호화된 HttpOnly 쿠키에 보관 (암호화 키는 `CANVA_CLIENT_SECRET`에서 생성)
- 필요한 권한(scope): `design:content:write`
- 리디렉션 주소: Canva 개발자 포털에 `https://<배포 주소>/api/canva/callback` 를 URL 1(기본)로 등록. 앱은 기본 주소를 쓰고, 다른 주소를 쓰려면 `CANVA_REDIRECT_URI`를 설정 (로컬은 `http://127.0.0.1:3000/api/canva/callback`)
- `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`가 없으면 Canva 버튼은 숨겨지고 기존 지시문 복사만 보입니다.

## 업무 대시보드 (`/dashboard`)
노션 '프리랜서 업무 허브'(✅ 할 일 · 📦 공동구매 일정)와 구글 캘린더를 한 화면에서 보는 대시보드입니다.
- **통합 캘린더**: 구글 캘린더 일정 + 노션 할 일 마감 + 공동구매(판매기간·홍보 시작)를 월 달력에 겹쳐 보여줍니다. 구글에 이미 `✅ 할 일명`으로 올라간 노션 할 일은 중복 표시하지 않습니다.
- **오늘의 업무 (GPT)**: 매일 오전 9시(KST)에 Vercel Cron이 `/api/dashboard/cron`을 호출 → 노션 할 일·구글 일정·이번주 공구 일정을 GPT가 정리해 노션 '📋 일일 업무 브리핑' 아래에 `📋 오늘의 업무 YYYY-MM-DD` 페이지로 기록합니다. 대시보드의 "GPT로 지금 작성" 버튼으로 수동 작성도 가능합니다.
- **이번주 공동구매 일정 기록**: 같은 위치에 `🛒 이번주 공동구매 일정 월~일` 페이지를 주마다 1건 기록하고, 대시보드에는 홍보 시작·오픈·마감 날짜와 '확인 필요' 항목을 보여줍니다.

### 설정 (Vercel 환경 변수, `.env.example` 참고)
1. **노션**: notion.so/my-integrations 에서 통합을 만들어 `NOTION_TOKEN`에 넣고, '프리랜서 업무 허브' 페이지 → ⋯ → 연결에서 그 통합을 추가합니다 (하위 DB 포함).
2. **구글 캘린더**: Google Cloud에서 OAuth 클라이언트를 만들고(`GOOGLE_CLIENT_ID/SECRET`), `https://www.googleapis.com/auth/calendar.readonly` 권한으로 한 번 로그인해 받은 refresh token을 `GOOGLE_REFRESH_TOKEN`에 넣습니다 (OAuth Playground에서 본인 클라이언트로 발급 가능).
3. **GPT**: `OPENAI_API_KEY` (모델은 `OPENAI_MODEL`, 기본 `gpt-4.1`).
4. **Cron 인증**: 임의의 긴 문자열을 `CRON_SECRET`에 넣습니다. `vercel.json`의 `crons`(`0 0 * * *` = 한국 09:00)가 자동 등록됩니다. Hobby 요금제는 지정 시각 기준 1시간 안에서 실행될 수 있어요.
- 로컬 실행: `node server.js` → http://localhost:3000/dashboard
