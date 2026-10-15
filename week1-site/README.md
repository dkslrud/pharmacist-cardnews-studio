# 1주차 · 팔리는 콘텐츠 3단계 (약사 4주 집중 컨설팅)

1단계 알고리즘이 좋아하는 콘텐츠 → 2단계 콘텐츠 기획 → 3단계 콘텐츠 소재.
읽다가 문장을 드래그하면 "이 부분 질문하기" 버튼이 뜨고, Claude가 강의 조교로 답합니다.

## 구조
- `public/index.html` 강의 페이지 (내용·디자인·드래그 질문 화면 전부)
- `api/ask.js` Vercel 함수 (질문 → Claude)
- `lib/ask.js` 질문 처리 로직, 조교 지침(SYSTEM)
- `server.js` 로컬 실행용 (`node server.js` → http://localhost:3000, `.env` 사용)

## 환경 변수
`.env.example` 참고. Vercel에서는 Project Settings → Environment Variables 에 넣습니다.
- `ANTHROPIC_API_KEY` (필수, 질문 기능용)
- `CLAUDE_MODEL` (선택, 기본 claude-sonnet-5-5)
- `APP_PASSWORD` (선택, 넣으면 질문할 때 한 번 비밀번호를 물어봄)

## Vercel 배포
방법 A. 이 저장소에서 새 프로젝트로 (카드뉴스 스튜디오와 별도 사이트)
1. vercel.com → Add New → Project → `pharmacist-cardnews-studio` 저장소 Import.
2. Root Directory 를 `week1-site` 로 바꾼다. (카드뉴스 스튜디오는 저장소 맨 위 폴더, 이 사이트는 `week1-site` 폴더)
3. Environment Variables 에 `ANTHROPIC_API_KEY` 추가 → Deploy.
   이후 main 에 push 하면 자동 배포.

방법 B. 명령어 한 줄
1. 이 폴더에서 `npx vercel --prod` (처음이면 로그인 안내가 나옴).
2. 위 3번처럼 환경 변수를 넣고 다시 `npx vercel --prod`.

내용 수정은 `public/index.html` 만 고치면 됩니다.
