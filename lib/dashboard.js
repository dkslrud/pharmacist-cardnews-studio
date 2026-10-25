// 업무 대시보드: 노션(할 일·공동구매 일정) + 구글 캘린더를 한 화면으로 모으고,
// 매일 오전 9시(KST)에 GPT로 "오늘의 업무"를 써서 노션에 남긴다. 이번주 공동구매 일정도 함께 기록한다.
// server.js(로컬)와 api/dashboard/[action].js(Vercel)가 함께 쓴다.
const NOTION_TOKEN = () => process.env.NOTION_TOKEN || '';
const OPENAI_KEY = () => process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = () => process.env.OPENAI_MODEL || 'gpt-4.1';
const APP_PASSWORD = () => process.env.APP_PASSWORD || '';
const CRON_SECRET = () => process.env.CRON_SECRET || '';
const G = () => ({ id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET, refresh: process.env.GOOGLE_REFRESH_TOKEN });
const googleOn = () => { const g = G(); return !!(g.id && g.secret && g.refresh); };
const CAL_IDS = () => (process.env.GOOGLE_CALENDAR_IDS || 'primary').split(',').map(s => s.trim()).filter(Boolean);

// 노션 허브(프리랜서 업무 허브) 안의 데이터베이스. 다르면 환경 변수로 바꾼다.
const DB = {
  tasks: () => process.env.NOTION_TASKS_DB || 'e55256b2c45e43b6bb280d58ce3662c8',
  groupbuy: () => process.env.NOTION_GROUPBUY_DB || '790a7748d38c42c78b784bf648542af5',
};
const BRIEF_PARENT = () => process.env.NOTION_BRIEF_PARENT_ID || '3dd2ae17db57814697a0e32325ea7a4f';
const BRIEF_FOLDER = '📋 일일 업무 브리핑';

// ---------- 날짜 (모두 한국 시간 기준 'YYYY-MM-DD' 문자열) ----------
const KST = 9 * 3600e3;
const ymd = d => new Date(d.getTime() + KST).toISOString().slice(0, 10);
const today = () => ymd(new Date());
const addDays = (s, n) => new Date(new Date(s + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);
const weekOf = s => { const mon = addDays(s, -((new Date(s + 'T00:00:00Z').getUTCDay() + 6) % 7)); return { start: mon, end: addDays(mon, 6) }; };
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}(${DOW[new Date(s + 'T00:00:00Z').getUTCDay()]})`;
const nowTime = () => new Date(Date.now() + KST).toISOString().slice(11, 16);
const overlaps = (e, from, to) => e.start <= to && e.end >= from;

// ---------- 노션 ----------
async function notion(path, method = 'GET', body) {
  if (!NOTION_TOKEN()) throw new Error('NOTION_TOKEN이 설정되지 않았어요.');
  const r = await fetch('https://api.notion.com/v1' + path, {
    method,
    headers: { Authorization: `Bearer ${NOTION_TOKEN()}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`노션 오류 (${r.status}): ${j.message || ''}`.trim());
  return j;
}
async function queryAll(dbId, filter) {
  const out = [];
  let cursor;
  do {
    const j = await notion(`/databases/${dbId}/query`, 'POST', { page_size: 100, ...(filter ? { filter } : {}), ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...j.results);
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor && out.length < 500);
  return out;
}
const P = {
  title: p => (p?.title || []).map(t => t.plain_text).join(''),
  text: p => (p?.rich_text || []).map(t => t.plain_text).join(''),
  sel: p => p?.select?.name || '',
  num: p => (typeof p?.number === 'number' ? p.number : null),
  url: p => p?.url || '',
  date: p => (p?.date ? { start: p.date.start.slice(0, 10), end: (p.date.end || p.date.start).slice(0, 10), time: p.date.start.length > 10 ? p.date.start.slice(11, 16) : '' } : null),
};

async function loadTasks() {
  const rows = await queryAll(DB.tasks(), { and: [
    { property: '상태', select: { does_not_equal: '완료' } },
    { property: '상태', select: { does_not_equal: '취소' } },
  ] });
  return rows.map(r => {
    const p = r.properties;
    const due = P.date(p['마감일']);
    return {
      id: r.id, title: P.title(p['할 일']) || '(제목 없음)', url: r.url, status: P.sel(p['상태']), priority: P.sel(p['우선순위']),
      client: P.sel(p['클라이언트']), owner: P.sel(p['담당']), due: due ? due.start : '', memo: P.text(p['메모']),
      inCalendar: !!p['캘린더 등록']?.checkbox,
    };
  });
}
async function loadGroupbuys() {
  const rows = await queryAll(DB.groupbuy());
  return rows.map(r => {
    const p = r.properties;
    const sale = P.date(p['판매기간']);
    const promo = P.date(p['홍보 시작']);
    return {
      id: r.id, title: P.title(p['공구명']) || '(이름 없음)', url: r.url, pharmacist: P.sel(p['약사']), status: P.sel(p['상태']),
      stage: P.sel(p['준비 단계']), process: P.sel(p['프로세스']), brand: P.text(p['브랜드']), product: P.text(p['제품']),
      saleStart: sale ? sale.start : '', saleEnd: sale ? sale.end : '', promoStart: promo ? promo.start : '',
      todo: P.text(p['확인 필요']), checklist: P.num(p['체크리스트']), goal: P.num(p['목표 매출']), actual: P.num(p['실적 매출']),
    };
  });
}

// ---------- 구글 캘린더 ----------
async function googleToken() {
  const g = G();
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: g.id, client_secret: g.secret, refresh_token: g.refresh, grant_type: 'refresh_token' }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`구글 로그인 오류 (${j.error_description || j.error || r.status})`);
  return j.access_token;
}
async function loadGoogle(from, to) {
  const token = await googleToken();
  const out = [];
  for (const cal of CAL_IDS()) {
    const q = new URLSearchParams({
      timeMin: `${from}T00:00:00+09:00`, timeMax: `${addDays(to, 1)}T00:00:00+09:00`, singleEvents: 'true',
      orderBy: 'startTime', maxResults: '250', timeZone: 'Asia/Seoul',
    });
    const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events?${q}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`구글 캘린더 오류 (${j.error?.message || r.status})`);
    for (const e of j.items || []) {
      if (e.status === 'cancelled') continue;
      const allDay = !!e.start?.date;
      const start = (e.start?.date || e.start?.dateTime || '').slice(0, 10);
      const end = allDay ? addDays(e.end.date, -1) : (e.end?.dateTime || e.start.dateTime).slice(0, 10);
      const title = e.summary || '(제목 없음)';
      out.push({
        id: 'g:' + e.id, title, start, end: end < start ? start : end, time: allDay ? '' : e.start.dateTime.slice(11, 16),
        source: 'google', client: (title.match(/^\[(.+?)\]/) || [])[1] || '', url: e.htmlLink || '',
      });
    }
  }
  return out;
}

// ---------- 합치기 ----------
function taskEvents(tasks, googleEvents) {
  // 노션 할 일은 구글 캘린더에도 "[클라이언트] ✅ 할 일명"으로 올라가므로, 이미 있으면 겹치지 않게 뺀다.
  const gTitles = googleEvents.map(e => e.title);
  return tasks.filter(t => t.due && !gTitles.some(g => g.includes('✅') && g.includes(t.title)))
    .map(t => ({ id: 'n:' + t.id, title: '✅ ' + t.title, start: t.due, end: t.due, time: '', source: 'task', client: t.client, url: t.url, priority: t.priority, status: t.status }));
}
function groupbuyEvents(gbs) {
  const out = [];
  for (const g of gbs) {
    const who = [g.pharmacist, g.brand || g.product].filter(Boolean).join(' · ');
    if (g.saleStart) out.push({ id: 'gb:' + g.id, title: `🛒 ${g.title}`, start: g.saleStart, end: g.saleEnd || g.saleStart, time: '', source: 'groupbuy', client: '편한가', url: g.url, note: who, status: g.status });
    if (g.promoStart) out.push({ id: 'gp:' + g.id, title: `📣 홍보 시작 · ${g.title}`, start: g.promoStart, end: g.promoStart, time: '', source: 'groupbuy', client: '편한가', url: g.url, note: who, status: g.status });
  }
  return out;
}
// 이번주(월~일)에 걸린 공구의 홍보 시작·오픈·마감 날짜
function weekMilestones(gbs, wk) {
  const out = [];
  const inWeek = d => d && d >= wk.start && d <= wk.end;
  for (const g of gbs) {
    const base = { gb: g.title, pharmacist: g.pharmacist, url: g.url, stage: g.stage, todo: g.todo, status: g.status, checklist: g.checklist };
    if (inWeek(g.promoStart)) out.push({ ...base, date: g.promoStart, kind: '홍보 시작' });
    if (inWeek(g.saleStart)) out.push({ ...base, date: g.saleStart, kind: '오픈' });
    if (inWeek(g.saleEnd) && g.saleEnd !== g.saleStart) out.push({ ...base, date: g.saleEnd, kind: '마감' });
  }
  const order = { '홍보 시작': 0, '오픈': 1, '마감': 2 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind]);
}
// 이번주 진행 중인 공구(판매기간이 주와 겹침)
const activeGroupbuys = (gbs, wk) => gbs.filter(g => g.saleStart && g.saleStart <= wk.end && (g.saleEnd || g.saleStart) >= wk.start);

const sourceState = async (on, fn) => {
  if (!on) return { ok: false, off: true };
  try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, error: e.message }; }
};

async function dashboardData(query) {
  const t = today();
  const wk = weekOf(t);
  const from = /^\d{4}-\d\d-\d\d$/.test(query.from || '') ? query.from : addDays(t, -7);
  const to = /^\d{4}-\d\d-\d\d$/.test(query.to || '') ? query.to : addDays(t, 42);
  const [tasksR, gbR, gcalR] = await Promise.all([
    sourceState(!!NOTION_TOKEN(), loadTasks),
    sourceState(!!NOTION_TOKEN(), loadGroupbuys),
    sourceState(googleOn(), () => loadGoogle(from, to)),
  ]);
  const tasks = tasksR.value || [];
  const gbs = gbR.value || [];
  const google = gcalR.value || [];
  const events = [...google, ...taskEvents(tasks, google), ...groupbuyEvents(gbs)]
    .filter(e => overlaps(e, from, to))
    .sort((a, b) => a.start.localeCompare(b.start) || a.time.localeCompare(b.time));
  const st = r => (r.ok ? 'ok' : r.off ? 'off' : r.error);
  return {
    today: t, week: wk, from, to, events, tasks,
    groupbuys: activeGroupbuys(gbs, wk), milestones: weekMilestones(gbs, wk),
    sources: { notion: st(tasksR) === 'ok' && st(gbR) === 'ok' ? 'ok' : st(tasksR) !== 'ok' ? st(tasksR) : st(gbR), google: st(gcalR) },
  };
}

// ---------- 오늘의 업무 (GPT) ----------
const BRIEF_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['headline', 'priorities', 'schedule', 'watch'],
  properties: {
    headline: { type: 'string' },
    priorities: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['task', 'client', 'why', 'due'],
      properties: { task: { type: 'string' }, client: { type: 'string' }, why: { type: 'string' }, due: { type: 'string' } } } },
    schedule: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['time', 'title'],
      properties: { time: { type: 'string' }, title: { type: 'string' } } } },
    watch: { type: 'array', items: { type: 'string' } },
  },
};
const BRIEF_SYS = `너는 프리랜서 마케터의 아침 업무 비서다. 클라이언트는 편한가(공동구매 플랫폼)와 하우파머시이고, 약사 인플루언서 공동구매 운영이 주된 일이다.
주어진 데이터(노션 할 일, 오늘 구글 캘린더 일정, 이번주 공동구매 일정)만 근거로 오늘 해야 할 업무를 정리한다. 데이터에 없는 일을 지어내지 않는다.
- headline: 오늘 하루를 한 문장으로 (예: "오늘은 비타민C 오픈 준비가 핵심이에요")
- priorities: 오늘 꼭 할 일 3~7개, 중요한 순서. 마감이 지났거나 오늘인 것, 우선순위 높음, 공동구매 홍보 시작·오픈·마감 직전 업무를 먼저. task는 할 일 제목을 짧게 다듬어, client는 클라이언트명(없으면 빈 문자열), why는 왜 오늘인지 한 줄, due는 마감일(YYYY-MM-DD, 없으면 빈 문자열)
- schedule: 오늘 일정(시간 순). time은 "HH:MM", 종일이면 "종일"
- watch: 놓치기 쉬운 것 0~4개. 회신 대기가 오래된 건 팔로업, 이번주 공구의 '확인 필요' 항목 등
말투는 짧고 담백한 한국어 존댓말.`;

async function gpt(system, user, schema, name) {
  if (!OPENAI_KEY()) throw new Error('OPENAI_API_KEY가 설정되지 않았어요.');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OPENAI_MODEL(),
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`GPT 오류 (${r.status}): ${j.error?.message || ''}`.trim());
  const choice = j.choices?.[0];
  if (choice?.message?.refusal) throw new Error('GPT가 답변을 거절했어요: ' + choice.message.refusal);
  try { return JSON.parse(choice.message.content); } catch { throw new Error('GPT 응답을 해석하지 못했어요.'); }
}

function briefInput(d) {
  const t = d.today;
  const line = k => k.map(x => `- ${x}`).join('\n') || '- 없음';
  const taskLine = x => `[${x.client || '-'}] ${x.title} | 상태 ${x.status || '-'} | 우선순위 ${x.priority || '-'} | 마감 ${x.due || '없음'}${x.due && x.due < t ? ' (지남)' : ''}${x.memo ? ' | 메모 ' + x.memo.slice(0, 80) : ''}`;
  const rel = d.tasks.filter(x => x.status !== '회신 대기');
  const gMs = d.milestones.map(m => `${m.date}${m.date === t ? '(오늘)' : ''} ${m.kind} · ${m.gb}${m.pharmacist ? ' · ' + m.pharmacist : ''}${m.todo ? ' | 확인 필요: ' + m.todo.slice(0, 80) : ''}`);
  const todayEv = d.events.filter(e => e.source === 'google' && e.start <= t && e.end >= t).map(e => `${e.time || '종일'} ${e.title}`);
  return `오늘: ${t} (${DOW[new Date(t + 'T00:00:00Z').getUTCDay()]}요일)\n\n[열린 노션 할 일 ${rel.length}건]\n${line(rel.slice(0, 60).map(taskLine))}\n\n[회신 대기]\n${line(d.tasks.filter(x => x.status === '회신 대기').map(taskLine))}\n\n[오늘 구글 캘린더 일정]\n${line(todayEv)}\n\n[이번주(${d.week.start}~${d.week.end}) 공동구매 홍보 시작·오픈·마감]\n${line(gMs)}`;
}

// ---------- 노션에 기록 ----------
const rt = s => [{ type: 'text', text: { content: String(s).slice(0, 1900) } }];
const para = s => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(s) } });
const h2 = s => ({ object: 'block', type: 'heading_2', heading_2: { rich_text: rt(s) } });
const bullet = s => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt(s) } });
const todo = s => ({ object: 'block', type: 'to_do', to_do: { rich_text: rt(s), checked: false } });
const callout = (s, icon) => ({ object: 'block', type: 'callout', callout: { rich_text: rt(s), icon: { type: 'emoji', emoji: icon } } });

async function listChildren(id, max = 10) {
  const out = [];
  let cursor;
  for (let i = 0; i < max; i++) {
    const j = await notion(`/blocks/${id}/children?page_size=100${cursor ? '&start_cursor=' + cursor : ''}`);
    out.push(...j.results);
    if (!j.has_more) break;
    cursor = j.next_cursor;
  }
  return out;
}
async function findChildPage(parentId, title) {
  const kids = await listChildren(parentId);
  return kids.find(b => b.type === 'child_page' && b.child_page.title === title && !b.archived) || null;
}
async function createPage(parentId, title, icon, children) {
  return notion('/pages', 'POST', { parent: { page_id: parentId }, icon: { type: 'emoji', emoji: icon }, properties: { title: { title: rt(title) } }, children });
}
let folderId = '';
async function briefFolder() {
  if (process.env.NOTION_BRIEF_PARENT_ID) return process.env.NOTION_BRIEF_PARENT_ID;
  if (folderId) return folderId;
  const hit = await findChildPage(BRIEF_PARENT(), BRIEF_FOLDER);
  folderId = hit ? hit.id : (await createPage(BRIEF_PARENT(), BRIEF_FOLDER, '📋', [para('매일 오전 9시에 GPT가 오늘의 업무를 정리해 쌓는 곳이에요. 매주 이번주 공동구매 일정도 함께 기록합니다.')])).id;
  return folderId;
}
const briefTitle = t => `📋 오늘의 업무 ${t}`;
const weekTitle = wk => `🛒 이번주 공동구매 일정 ${wk.start} ~ ${wk.end}`;

const msLine = m => `${md(m.date)} ${m.kind} · ${m.gb}${m.pharmacist ? ` (${m.pharmacist})` : ''}${m.stage ? ` — 준비 단계: ${m.stage}` : ''}${m.todo ? ` — 확인 필요: ${m.todo.slice(0, 100)}` : ''}`;
const gbLine = g => `${g.title}${g.pharmacist ? ` (${g.pharmacist})` : ''} · 판매 ${md(g.saleStart)}~${md(g.saleEnd || g.saleStart)}${g.stage ? ` · ${g.stage}` : ''}${g.checklist != null ? ` · 체크리스트 ${Math.round(g.checklist * 100)}%` : ''}`;

function briefBlocks(b, d) {
  const blocks = [callout(b.headline, '☀️'), h2('🎯 오늘 꼭 할 일')];
  blocks.push(...(b.priorities.length ? b.priorities.map(p => todo(`${p.client ? `[${p.client}] ` : ''}${p.task} — ${p.why}${p.due ? ` (마감 ${p.due})` : ''}`)) : [para('오늘 등록된 할 일이 없어요.')]));
  blocks.push(h2('🗓️ 오늘 일정'));
  blocks.push(...(b.schedule.length ? b.schedule.map(s => bullet(`${s.time} ${s.title}`)) : [para('오늘 구글 캘린더 일정이 없어요.')]));
  blocks.push(h2('🛒 이번주 공동구매 (중요 일정)'));
  blocks.push(...(d.milestones.length ? d.milestones.map(m => bullet(msLine(m))) : [para('이번주 홍보 시작·오픈·마감 일정이 없어요.')]));
  if (b.watch.length) blocks.push(h2('👀 챙겨볼 것'), ...b.watch.map(bullet));
  blocks.push(para(`자동 작성 ${nowTime()} · GPT(${OPENAI_MODEL()})`));
  return blocks;
}
function weekBlocks(d) {
  const blocks = [callout('매주 이번주(월~일)의 홍보 시작·오픈·마감 일정을 기록해요.', '🛒'), h2('📌 이번주 핵심 일정')];
  blocks.push(...(d.milestones.length ? d.milestones.map(m => bullet(msLine(m))) : [para('이번주 홍보 시작·오픈·마감 일정이 없어요.')]));
  blocks.push(h2('🛍️ 이번주 진행 중인 공구'));
  blocks.push(...(d.groupbuys.length ? d.groupbuys.map(g => bullet(gbLine(g))) : [para('이번주 판매 중인 공구가 없어요.')]));
  return blocks;
}

// 오늘의 업무를 만들어 노션에 쓴다. 이미 있으면 force가 아닌 한 건너뛴다.
async function makeBrief({ force } = {}) {
  const folder = await briefFolder();
  const title = briefTitle(today());
  const old = await findChildPage(folder, title);
  if (old && !force) return { created: false, url: `https://www.notion.so/${old.id.replace(/-/g, '')}` };
  const d = await dashboardData({ from: today(), to: today() });
  if (d.sources.notion !== 'ok') throw new Error('노션 데이터를 불러오지 못했어요: ' + d.sources.notion);
  const brief = await gpt(BRIEF_SYS, briefInput(d), BRIEF_SCHEMA, 'daily_brief');
  const page = await createPage(folder, title, '📋', briefBlocks(brief, d));
  if (old) await notion(`/pages/${old.id}`, 'PATCH', { archived: true });
  return { created: true, url: page.url, brief };
}
// 이번주 공동구매 일정 기록 (주마다 1건)
async function makeWeekRecord() {
  const folder = await briefFolder();
  const d = await dashboardData({ from: today(), to: today() });
  const title = weekTitle(d.week);
  const old = await findChildPage(folder, title);
  if (old) return { created: false, url: `https://www.notion.so/${old.id.replace(/-/g, '')}` };
  if (d.sources.notion !== 'ok') throw new Error('노션 데이터를 불러오지 못했어요: ' + d.sources.notion);
  const page = await createPage(folder, title, '🛒', weekBlocks(d));
  return { created: true, url: page.url };
}

const blockText = b => (b[b.type]?.rich_text || []).map(t => t.plain_text).join('');
async function readBrief() {
  if (!NOTION_TOKEN()) return { exists: false, reason: 'NOTION_TOKEN이 설정되지 않았어요.' };
  const folder = await briefFolder();
  const page = await findChildPage(folder, briefTitle(today()));
  if (!page) return { exists: false };
  const kids = await listChildren(page.id, 2);
  return {
    exists: true, url: `https://www.notion.so/${page.id.replace(/-/g, '')}`,
    blocks: kids.map(b => ({ type: b.type, text: blockText(b), checked: !!b.to_do?.checked })).filter(b => b.text),
  };
}

// ---------- 요청 처리 ----------
const config = () => ({ needsPassword: !!APP_PASSWORD(), notion: !!NOTION_TOKEN(), google: googleOn(), openai: !!OPENAI_KEY(), cronReady: !!CRON_SECRET() });

async function dashHandle({ action, method, query = {}, body = {}, password, authorization }) {
  try {
    if (action === 'config') return { code: 200, json: config() };
    if (action === 'cron') {
      // Vercel Cron이 CRON_SECRET을 Bearer로 보낸다 (매일 00:00 UTC = 한국 09:00)
      if (!CRON_SECRET()) return { code: 500, json: { error: 'CRON_SECRET이 설정되지 않았어요.' } };
      if (authorization !== `Bearer ${CRON_SECRET()}`) return { code: 401, json: { error: 'unauthorized' } };
      const brief = await makeBrief();
      const week = await makeWeekRecord();
      return { code: 200, json: { brief: { created: brief.created, url: brief.url }, week } };
    }
    if (APP_PASSWORD() && password !== APP_PASSWORD()) return { code: 401, json: { error: '접속 비밀번호가 맞지 않아요.' } };
    if (action === 'data') return { code: 200, json: await dashboardData(query) };
    if (action === 'brief' && method === 'POST') {
      const r = await makeBrief({ force: !!body.force });
      return { code: 200, json: { created: r.created, url: r.url } };
    }
    if (action === 'brief') return { code: 200, json: await readBrief() };
    if (action === 'week' && method === 'POST') return { code: 200, json: await makeWeekRecord() };
    return { code: 404, json: { error: 'not found' } };
  } catch (e) {
    return { code: 500, json: { error: e.message } };
  }
}

module.exports = { dashHandle, weekOf, today };
