# 1주차 · 팔리는 콘텐츠 3단계 (약사 4주 집중 컨설팅)

1단계 알고리즘이 좋아하는 콘텐츠 → 2단계 콘텐츠 기획 → 3단계 콘텐츠 소재.

## 구조
- `public/index.html` 강의 페이지 (내용·디자인 전부)
- `server.js` 로컬 미리보기용 (`node server.js` → http://localhost:3000)

## Vercel 배포
방법 A. 이 저장소에서 새 프로젝트로 (카드뉴스 스튜디오와 별도 사이트)
1. vercel.com → Add New → Project → `pharmacist-cardnews-studio` 저장소 Import.
2. Root Directory 를 `week1-site` 로 바꾼다. (카드뉴스 스튜디오는 저장소 맨 위 폴더, 이 사이트는 `week1-site` 폴더)
3. Deploy. 환경 변수는 필요 없습니다.
   이후 main 에 push 하면 자동 배포.

방법 B. 이 폴더에서 `npx vercel --prod` (처음이면 로그인 안내가 나옴).

내용 수정은 `public/index.html` 만 고치면 됩니다.
