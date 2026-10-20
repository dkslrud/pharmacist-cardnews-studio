// 1~4주차 사이트를 과정 홈 아래로 복사: node sync.js
// weekN-site/public → public/weekN
// 각 페이지 맨 위에 "← 4주 과정 홈" 바를 넣고, 2주차부터는 "← 이전 주차로 돌아가기" 버튼도 넣는다.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WEEKS = { week1: 'week1-site/public', week2: 'week2-site/public', week3: 'week3-site/public', week4: 'week4-site/public' };
// 이전 주차로 돌아가는 버튼
const PREV = {
  week2: { href: '../week1/index.html', label: '← 1주차로 돌아가기' },
  week3: { href: '../week2/index.html', label: '← 2주차로 돌아가기' },
  week4: { href: '../week3/index.html', label: '← 3주차로 돌아가기' },
};
const LINK = 'color:inherit;text-decoration:none';
const bar = (dest) => {
  const prev = PREV[dest]
    ? `<a href="${PREV[dest].href}" style="${LINK};border:1px solid #EDEAE0;padding:7px 12px;white-space:nowrap">${PREV[dest].label}</a>`
    : '';
  return '<div style="background:#141413;color:#EDEAE0;font:600 13px/1 \'Pretendard Variable\',Pretendard,-apple-system,sans-serif;padding:' + (prev ? '6px' : '11px') + ' 16px;letter-spacing:.04em;display:flex;align-items:center;justify-content:space-between;gap:12px">'
    + `<a href="../index.html" style="${LINK}">← 안희경 · 4주 과정 홈</a>${prev}</div>`;
};

for (const [dest, src] of Object.entries(WEEKS)) {
  const to = path.join(__dirname, 'public', dest);
  fs.rmSync(to, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, src), to, { recursive: true });
  const html = path.join(to, 'index.html');
  const t = fs.readFileSync(html, 'utf8');
  let out = t.replace(/<body([^>]*)>/, `<body$1>\n${bar(dest)}`);
  // 페이지 맨 아래에도 같은 버튼을 둔다 (마지막 <script> 바로 앞)
  if (PREV[dest]) {
    const i = out.lastIndexOf('<script');
    const foot = `<div style="text-align:center;padding:8px 16px 64px"><a href="${PREV[dest].href}" style="display:inline-block;font:600 15px/1 'Pretendard Variable',Pretendard,-apple-system,sans-serif;color:#141413;text-decoration:none;border:1.5px solid #141413;padding:14px 22px">${PREV[dest].label}</a></div>\n`;
    out = out.slice(0, i) + foot + out.slice(i);
  }
  fs.writeFileSync(html, out);
  console.log(`${src} → public/${dest}`);
}
