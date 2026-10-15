// 1·2주차 사이트를 과정 홈 아래로 복사: node sync.js
// week1-site/public → public/week1, week2-site/public → public/week2
// 각 페이지 맨 위에 "← 4주 과정 홈" 바를 넣는다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEEKS = { week1: 'week1-site/public', week2: 'week2-site/public' };
const BAR = '<div style="background:#141413;color:#EDEAE0;font:600 13px/1 \'Pretendard Variable\',Pretendard,-apple-system,sans-serif;padding:11px 16px;letter-spacing:.04em"><a href="../index.html" style="color:inherit;text-decoration:none">← 안희경 · 4주 과정 홈</a></div>';

for (const [dest, src] of Object.entries(WEEKS)) {
  const to = path.join(__dirname, 'public', dest);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, src), to, { recursive: true });
  const html = path.join(to, 'index.html');
  const t = fs.readFileSync(html, 'utf8');
  fs.writeFileSync(html, t.replace(/<body([^>]*)>/, `<body$1>\n${BAR}`));
  console.log(`${src} → public/${dest}`);
}
