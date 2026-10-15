# 콘텐츠 처방소 (약사 4주 과정 홈)

1주차부터 4주차까지 자료를 카드로 모아 보는 정적 사이트입니다.

- `public/index.html` 과정 홈
- `public/week1/`, `public/week2/` 각 주차 페이지 (`week1-site`, `week2-site`에서 복사)

## 주차 자료를 고쳤을 때
`week1-site/public` 또는 `week2-site/public`을 고친 뒤 `node sync.js`를 실행하고 커밋합니다.

## 새 주차 추가
`weekN-site/public`을 만들고 `sync.js`의 `WEEKS`에 넣은 뒤, `public/index.html`의 "준비 중" 카드를 링크 카드로 바꿉니다.

## Vercel 배포
New Project → 이 저장소 → Root Directory `course-site` → Deploy. 환경 변수는 없습니다.
