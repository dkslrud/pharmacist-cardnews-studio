# 2주차 · 클로드 코드로 만드는 알고리즘이 좋아하는 콘텐츠 (약사 4주 집중 컨설팅)

1단계 내 계정 가르치기 → 2단계 터진 영상 레퍼런스 → 3단계 분석하고 기획하기(영상 스크립트 · 카드뉴스).

## 구조
- `public/index.html` 강의 페이지 (내용·디자인 전부)
- `server.js` 로컬 미리보기용 (`node server.js` → http://localhost:3000)

## Vercel 배포 (1주차·카드뉴스 스튜디오와 별도 사이트)
1. vercel.com → Add New → Project → `pharmacist-cardnews-studio` 저장소 Import.
2. 목록에서 `week2-site` 줄의 Import single project (또는 Root Directory 를 `week2-site` 로).
3. Deploy. 환경 변수는 필요 없습니다. 이후 main 에 push 하면 자동 배포.

내용 수정은 `public/index.html` 만 고치면 됩니다.
