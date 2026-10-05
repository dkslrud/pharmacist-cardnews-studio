// Canva Connect API 연동: 로그인(OAuth+PKCE) → 카드뉴스를 PPTX로 만들어 Canva에 가져오기 → 편집 링크 반환
// 토큰은 DB 없이 브라우저의 암호화된 쿠키(HttpOnly)에 보관한다.
const crypto = require('crypto');
const PptxGenJS = require('pptxgenjs');

const CLIENT_ID = () => process.env.CANVA_CLIENT_ID || '';
const CLIENT_SECRET = () => process.env.CANVA_CLIENT_SECRET || '';
const APP_PASSWORD = () => process.env.APP_PASSWORD || '';
const SCOPES = 'design:content:write';
const API = 'https://api.canva.com/rest/v1';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const configured = () => !!(CLIENT_ID() && CLIENT_SECRET());

// ---------- 쿠키 암호화 ----------
const key = () => crypto.createHash('sha256').update('cardnews-canva:' + CLIENT_SECRET()).digest();
function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}
function open(s) {
  try {
    const b = Buffer.from(s, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
const cookie = (name, value, maxAge, secure) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;

// ---------- OAuth ----------
async function tokenRequest(params) {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(j.error_description || j.message || `Canva 로그인 오류 (${r.status})`);
  return j;
}
// 토큰 응답 → 쿠키 2개(접근 토큰은 만료까지, 갱신 토큰은 90일)
function tokenCookies(t, secure) {
  const ttl = Math.max(60, (+t.expires_in || 14400) - 60);
  return [
    cookie('canva_at', seal({ t: t.access_token, e: Date.now() + ttl * 1000 }), ttl, secure),
    cookie('canva_rt', seal({ t: t.refresh_token }), 90 * 86400, secure),
  ];
}
const clearCookies = secure => ['canva_at', 'canva_rt', 'canva_pkce'].map(n => cookie(n, '', 0, secure));

// 쓸 수 있는 접근 토큰을 꺼낸다. 만료됐으면 갱신 토큰으로 새로 받는다(갱신 토큰은 1회용이라 쿠키도 바꾼다).
async function accessToken(cookies, setCookies, secure, forceRefresh) {
  const at = cookies.canva_at && open(cookies.canva_at);
  if (!forceRefresh && at && at.e > Date.now()) return at.t;
  const rt = cookies.canva_rt && open(cookies.canva_rt);
  if (!rt) return null;
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: rt.t });
    setCookies.push(...tokenCookies(t, secure));
    return t.access_token;
  } catch {
    setCookies.push(...clearCookies(secure));
    return null;
  }
}

// ---------- 카드뉴스 → PPTX ----------
const ASPECT = { '1:1': 11.25, '4:5': 14.0625, '9:16': 20 }; // 너비 11.25in(=1080px) 기준 높이
const hex = h => (/^#?[0-9a-f]{6}$/i.test(String(h || '').trim()) ? String(h).trim().replace('#', '').toUpperCase() : null);
const rgb = h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
const lum = h => { const [r, g, b] = rgb(h); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
const sat = h => { const c = rgb(h); return (Math.max(...c) - Math.min(...c)) / 255; };
const mix = (a, b, t) => rgb(a).map((v, i) => Math.round(v + (rgb(b)[i] - v) * t).toString(16).padStart(2, '0')).join('').toUpperCase();

// 레퍼런스 색상에서 배경(가장 밝은색), 글자(가장 어두운색), 강조(채도 높은 중간색)를 고른다.
function pickColors(palette) {
  const cs = [...new Set((palette || []).map(hex).filter(Boolean))];
  const byLum = [...cs].sort((a, b) => lum(b) - lum(a));
  const bg = byLum[0] && lum(byLum[0]) > 0.82 ? byLum[0] : 'FFFFFF';
  const ink = byLum.length && lum(byLum[byLum.length - 1]) < 0.3 ? byLum[byLum.length - 1] : '1D2320';
  const accent = cs.filter(c => c !== bg && c !== ink && lum(c) > 0.15 && lum(c) < 0.75).sort((a, b) => sat(b) - sat(a))[0] || '0D6B4F';
  const onAccent = lum(accent) > 0.6 ? ink : 'FFFFFF';
  return { bg, ink, accent, onAccent, soft: mix(accent, 'FFFFFF', 0.86), muted: mix(ink, bg, 0.45) };
}

const FONT = 'Noto Sans KR';
const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function buildPptx({ slides, analysis, name, cta }) {
  const W = 11.25, H = ASPECT[analysis?.aspect] || ASPECT['4:5'];
  const C = pickColors(analysis?.palette);
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: 'CARD', width: W, height: H });
  pptx.layout = 'CARD';
  const M = 0.8, IW = W - M * 2;
  const total = slides.length;

  slides.forEach((s, i) => {
    const first = i === 0, last = i === total - 1 && total > 1;
    const sl = pptx.addSlide();
    const page = `${i + 1} / ${total}`;
    const text = (t, o) => sl.addText(t, { fontFace: FONT, margin: 0, valign: 'top', ...o });
    const notes = [s.role && `역할: ${s.role}`, s.layoutRef && `배치: ${s.layoutRef}`, s.visual && `비주얼: ${s.visual}`].filter(Boolean).join('\n');
    if (notes) sl.addNotes(notes);

    if (last) {
      // CTA: 강조색 배경 + 버튼
      sl.background = { color: C.accent };
      text(clip(s.headline, 40), { x: M, y: H * 0.26, w: IW, h: H * 0.22, fontSize: 52, bold: true, color: C.onAccent, align: 'center', valign: 'middle' });
      text(clip(s.body, 120), { x: M, y: H * 0.5, w: IW, h: H * 0.16, fontSize: 24, color: C.onAccent, align: 'center' });
      sl.addShape(pptx.ShapeType.roundRect, { x: W * 0.17, y: H * 0.7, w: W * 0.66, h: 1.15, rectRadius: 0.55, fill: { color: C.onAccent }, line: { color: C.onAccent } });
      text(clip(cta || '지금 상담하기', 24), { x: W * 0.17, y: H * 0.7, w: W * 0.66, h: 1.15, fontSize: 26, bold: true, color: C.accent, align: 'center', valign: 'middle' });
      if (name) text(name, { x: M, y: H - 1.1, w: IW, h: 0.5, fontSize: 16, color: C.onAccent, align: 'center' });
      return;
    }

    sl.background = { color: C.bg };
    if (name) text(name, { x: M, y: 0.6, w: IW * 0.7, h: 0.45, fontSize: 16, color: C.muted });
    text(page, { x: W - M - 2, y: 0.6, w: 2, h: 0.45, fontSize: 16, color: C.muted, align: 'right' });

    if (first) {
      // 훅: 큰 제목 중앙 + 강조 막대
      sl.addShape(pptx.ShapeType.rect, { x: M, y: H * 0.3, w: 1.4, h: 0.16, fill: { color: C.accent }, line: { color: C.accent } });
      text(clip(s.headline, 40), { x: M, y: H * 0.34, w: IW, h: H * 0.26, fontSize: 60, bold: true, color: C.ink });
      text(clip(s.body, 120), { x: M, y: H * 0.62, w: IW, h: H * 0.16, fontSize: 26, color: C.muted });
      sl.addShape(pptx.ShapeType.rect, { x: 0, y: H - 0.35, w: W, h: 0.35, fill: { color: C.accent }, line: { color: C.accent } });
      return;
    }

    // 본문: 역할 칩 + 제목 + 본문 + 이미지 자리
    const chip = clip(s.role || '', 14);
    if (chip) {
      sl.addShape(pptx.ShapeType.roundRect, { x: M, y: 1.5, w: Math.min(IW, 0.6 + chip.length * 0.32), h: 0.6, rectRadius: 0.3, fill: { color: C.accent }, line: { color: C.accent } });
      text(chip, { x: M, y: 1.5, w: Math.min(IW, 0.6 + chip.length * 0.32), h: 0.6, fontSize: 16, bold: true, color: C.onAccent, align: 'center', valign: 'middle' });
    }
    text(clip(s.headline, 40), { x: M, y: 2.4, w: IW, h: 2.2, fontSize: 44, bold: true, color: C.ink });
    text(clip(s.body, 140), { x: M, y: 4.7, w: IW, h: 1.6, fontSize: 24, color: C.ink });
    const py = 6.6, ph = H - py - 0.9;
    if (ph > 1.5) {
      sl.addShape(pptx.ShapeType.roundRect, { x: M, y: py, w: IW, h: ph, rectRadius: 0.3, fill: { color: C.soft }, line: { color: C.accent, width: 1.5, dashType: 'dash' } });
      text(`이미지 자리\n${clip(s.visual, 80)}`, { x: M + 0.4, y: py, w: IW - 0.8, h: ph, fontSize: 18, color: C.muted, align: 'center', valign: 'middle' });
    }
  });

  return pptx.write({ outputType: 'nodebuffer' });
}

// ---------- Canva 가져오기 ----------
async function importDesign(token, buf, title) {
  const r = await fetch(`${API}/imports`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/octet-stream',
      'Import-Metadata': JSON.stringify({ title_base64: Buffer.from(title, 'utf8').toString('base64'), mime_type: PPTX_MIME }),
    },
    body: buf,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { const e = new Error('unauthorized'); e.unauthorized = true; throw e; }
  if (r.status === 403) throw new Error('Canva 권한이 부족해요. 개발자 설정에서 design:content:write 권한을 켜고 다시 연결해 주세요.');
  if (r.status === 429) throw new Error('Canva 요청이 너무 많아요. 1분 뒤 다시 시도해 주세요.');
  if (!r.ok || !j.job?.id) throw new Error(j.message || `Canva 가져오기 오류 (${r.status})`);

  // 가져오기는 비동기 작업: 끝날 때까지 기다린다(최대 약 90초)
  let job = j.job;
  for (let i = 0; i < 60 && job.status === 'in_progress'; i++) {
    await new Promise(res => setTimeout(res, i < 5 ? 1000 : 1500));
    const g = await fetch(`${API}/imports/${encodeURIComponent(job.id)}`, { headers: { Authorization: `Bearer ${token}` } });
    const gj = await g.json().catch(() => ({}));
    if (!g.ok) throw new Error(gj.message || `Canva 작업 확인 오류 (${g.status})`);
    job = gj.job;
  }
  if (job.status === 'failed') throw new Error(`Canva가 디자인을 만들지 못했어요: ${job.error?.message || job.error?.code || '알 수 없는 오류'}`);
  const d = job.result?.designs?.[0];
  if (job.status !== 'success' || !d?.urls?.edit_url) throw new Error('Canva 작업이 오래 걸려요. 잠시 뒤 Canva의 "최근 디자인"에서 확인해 주세요.');
  return { editUrl: d.urls.edit_url, viewUrl: d.urls.view_url, designId: d.id };
}

// ---------- 라우트 ----------
// req: {action, method, query, body, cookie, origin, password} → {code, json?, html?, location?, setCookies}
async function canvaHandle(req) {
  const secure = req.origin.startsWith('https://');
  const setCookies = [];
  const redirectUri = process.env.CANVA_REDIRECT_URI || `${req.origin}/api/canva/callback`;
  const cookies = parseCookies(req.cookie);
  const out = o => ({ setCookies, ...o });
  try {
    if (req.action === 'status') {
      return out({ code: 200, json: { configured: configured(), connected: configured() && !!(cookies.canva_rt && open(cookies.canva_rt)) } });
    }
    if (!configured()) return out({ code: 400, json: { error: '서버에 CANVA_CLIENT_ID, CANVA_CLIENT_SECRET이 설정되지 않았어요.' } });

    if (req.action === 'login') {
      const verifier = crypto.randomBytes(48).toString('base64url');
      const state = crypto.randomBytes(24).toString('base64url');
      setCookies.push(cookie('canva_pkce', seal({ verifier, state }), 600, secure));
      const q = new URLSearchParams({
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 's256', scope: SCOPES, response_type: 'code',
        client_id: CLIENT_ID(), state, redirect_uri: redirectUri,
      });
      return out({ code: 302, location: `https://www.canva.com/api/oauth/authorize?${q}` });
    }

    if (req.action === 'callback') {
      const pk = cookies.canva_pkce && open(cookies.canva_pkce);
      setCookies.push(cookie('canva_pkce', '', 0, secure));
      let msg;
      if (req.query.error) msg = req.query.error_description || 'Canva 연결을 취소했어요.';
      else if (!pk || pk.state !== req.query.state || !req.query.code) msg = 'Canva 연결 확인에 실패했어요. 다시 시도해 주세요.';
      else {
        try {
          const t = await tokenRequest({ grant_type: 'authorization_code', code: req.query.code, code_verifier: pk.verifier, redirect_uri: redirectUri });
          setCookies.push(...tokenCookies(t, secure));
        } catch (e) { msg = e.message; }
      }
      return out({ code: 200, html: callbackPage(msg) });
    }

    if (req.action === 'logout') {
      setCookies.push(...clearCookies(secure));
      return out({ code: 200, json: { ok: true } });
    }

    if (req.action === 'create') {
      if (req.method !== 'POST') return out({ code: 405, json: { error: 'POST만 가능해요.' } });
      if (APP_PASSWORD() && req.password !== APP_PASSWORD()) return out({ code: 401, json: { error: '접속 비밀번호가 맞지 않아요.' } });
      const b = req.body || {};
      const slides = (Array.isArray(b.slides) ? b.slides : []).slice(0, 10)
        .map(s => ({ role: String(s.role || ''), headline: String(s.headline || ''), body: String(s.body || ''), layoutRef: String(s.layoutRef || ''), visual: String(s.visual || '') }));
      if (!slides.length) return out({ code: 400, json: { error: '먼저 카드뉴스 구성을 만들어 주세요.' } });
      const title = clip(b.title || '약사 카드뉴스', 50);
      const buf = await buildPptx({ slides, analysis: b.analysis || {}, name: clip(b.name, 30), cta: clip(b.cta, 30) });

      let token = await accessToken(cookies, setCookies, secure, false);
      if (!token) return out({ code: 401, json: { error: 'Canva 연결이 필요해요.', needsLogin: true } });
      try {
        return out({ code: 200, json: await importDesign(token, buf, title) });
      } catch (e) {
        if (!e.unauthorized) throw e;
        token = await accessToken(cookies, setCookies, secure, true);
        if (!token) return out({ code: 401, json: { error: 'Canva 연결이 만료됐어요. 다시 연결해 주세요.', needsLogin: true } });
        return out({ code: 200, json: await importDesign(token, buf, title) });
      }
    }
    return out({ code: 404, json: { error: 'not found' } });
  } catch (e) {
    return out({ code: 500, json: { error: e.message } });
  }
}

// 로그인 창(팝업)에서 보이는 페이지: 원래 화면에 결과를 알리고, 팝업이 아니면 첫 화면으로 돌아간다.
function callbackPage(err) {
  const payload = JSON.stringify(err ? { canva: 'error', message: err } : { canva: 'connected' }).replace(/</g, '\\u003c');
  const back = err ? '/?canva=error' : '/?canva=connected';
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Canva 연결</title>
<style>body{font-family:system-ui,sans-serif;background:#f4f4ef;color:#1d2320;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;text-align:center}</style></head>
<body><p id="m">${err ? 'Canva 연결에 실패했어요.' : 'Canva에 연결됐어요. 디자인을 만드는 중이에요…'}</p>
<script>var d=${payload};if(window.opener&&!window.opener.closed){window.opener.postMessage(d,location.origin);if(d.canva==='error')setTimeout(function(){window.close()},1500)}else{location.replace(${JSON.stringify(back)})}</script></body></html>`;
}

module.exports = { canvaHandle, buildPptx, pickColors };
