# 약사 카드뉴스 스튜디오

1단계: 레퍼런스 카드뉴스 이미지(또는 인스타 게시물 주소) → 레이아웃 분석
2단계: 마케팅 단계(구매전환/리마인드) + 약사 정보 → 카드뉴스 구성, 캡션, Canva 지시문, 광고 규정 체크

## 구조
- `public/index.html` 화면
- `api/*.js` Vercel 함수 (config, analyze, compose)
- `lib/core.js` 핵심 로직 (Claude API 호출)
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
