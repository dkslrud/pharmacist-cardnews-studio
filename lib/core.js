// 서버(server.js)와 Vercel 함수(api/*.js)가 함께 쓰는 핵심 로직
const API_KEY = () => process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const APP_PASSWORD = () => process.env.APP_PASSWORD || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const MAX_IMG = 8;

const STAGES = {
  conversion: { label: '전환 · 나눔이벤트 OPEN', goal: '공구 오픈을 알리고 나눔이벤트(사은품)·혜택, USP와 근거, 섭취법, 지금 사야 할 이유로 구매 전환', flow: ['OPEN 커버(기간·나눔이벤트)', '상황 공감·필요성', 'USP 체크·근거', '혜택(사은품·가격)', '섭취법·Q&A', '구매 방법'] },
  remind: { label: '리마인드 · 마감임박', goal: '곧 마감을 알리고 남은 혜택, 후기·Q&A로 망설임을 풀어 막차 구매 확정', flow: ['곧 마감 커버(마감 일시)', '남은 혜택', '후기·Q&A로 망설임 해소', '아이 섭취 장면', '구매 방법'] },
};

const ANALYZE_SYS = `너는 카드뉴스 디자인 분석가다. 첨부한 이미지는 한 카드뉴스의 슬라이드들(순서대로)이다. 이 레이아웃을 그대로 재사용해 글자만 바꿔 넣을 것이므로, 각 장의 글자 덩어리를 빠짐없이 찾아 위치와 모양을 정확히 기록한다.
- slides는 첨부 이미지 1장당 1개, 같은 순서. no는 1부터.
- texts: 그 장에 보이는 글자 덩어리(제목, 부제, 본문, 강조, 라벨, 버튼, 계정명, 페이지 번호 등)마다 하나. 한 줄씩 쪼개지 말고 같은 서식으로 이어진 문단은 하나로 묶는다. 사진 속 제품 포장지 글자는 제외한다.
  - id: "s{장번호}t{순번}" (예: s1t1)
  - kind: 제목|부제|본문|강조|라벨|버튼|계정|페이지|기타
  - text: 원래 문구 그대로(줄바꿈은 \n)
  - x, y, w, h: 글자 덩어리를 감싸는 상자. 이미지 왼쪽 위 기준, 이미지 너비·높이에 대한 백분율(0~100). 글자를 넉넉히 덮도록 살짝 여유를 둔다.
  - lineHeight: 글자 한 줄의 높이(이미지 높이 대비 %). 제목은 보통 4~9, 본문은 2~4.
  - color: 글자색 hex, bg: 글자 바로 뒤 배경색 hex(글자를 지울 때 칠할 색), align: left|center|right, bold: 굵으면 true
- bg: 그 장의 배경색 hex(사진 배경이면 대표색).
- shapes: 글자 외의 요소 자리. 사진·일러스트·제품 이미지는 kind "이미지", 색 상자·띠·말풍선·버튼 바탕은 kind "도형". x, y, w, h는 texts와 같은 백분율, color는 도형 색(이미지는 대표색), label은 무엇인지 짧게(예: 제품 사진, 아이 사진, 노란 띠). 가는 선·작은 장식은 뺀다. 뒤에 있는 것부터 순서대로.
- 그 외 항목은 디자인 문법 요약. 문구를 베끼라는 뜻이 아니다.`;

// 1단계 답변 형식(구조화 출력)
const ANALYZE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slideCount', 'aspect', 'palette', 'mood', 'typography', 'tone', 'slides', 'reusablePattern', 'note'],
  properties: {
    slideCount: { type: 'integer' },
    aspect: { type: 'string' },
    palette: { type: 'array', items: { type: 'string' } },
    mood: { type: 'string' },
    typography: { type: 'string' },
    tone: { type: 'string' },
    reusablePattern: { type: 'string' },
    note: { type: 'string' },
    slides: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['no', 'role', 'layout', 'bg', 'shapes', 'texts'],
        properties: {
          no: { type: 'integer' },
          role: { type: 'string' },
          layout: { type: 'string' },
          bg: { type: 'string' },
          shapes: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'label', 'x', 'y', 'w', 'h', 'color'],
              properties: {
                kind: { type: 'string', enum: ['이미지', '도형'] }, label: { type: 'string' },
                x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' }, color: { type: 'string' },
              },
            },
          },
          texts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['id', 'kind', 'text', 'x', 'y', 'w', 'h', 'lineHeight', 'color', 'bg', 'align', 'bold'],
              properties: {
                id: { type: 'string' }, kind: { type: 'string' }, text: { type: 'string' },
                x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' },
                lineHeight: { type: 'number' }, color: { type: 'string' }, bg: { type: 'string' },
                align: { type: 'string', enum: ['left', 'center', 'right'] }, bold: { type: 'boolean' },
              },
            },
          },
        },
      },
    },
  },
};

const COMPOSE_SYS = `너는 약사 마케팅 카피라이터다. 레퍼런스 카드뉴스의 디자인과 장 구성은 그대로 두고, 각 장의 글자 덩어리(texts)만 약사·제품 정보와 마케팅 단계에 맞는 문구로 바꿔 쓴다.
- 구성은 레퍼런스 그대로다: 장 수, 순서, 각 장의 역할(훅, 문제 제기, 근거, 제품, CTA 등)과 글자 덩어리 구성을 바꾸지 않는다. 마케팅 단계는 문구의 말투와 강조점에만 반영하고, 레퍼런스의 장 구성을 단계의 권장 흐름으로 바꾸지 않는다.
- replacements에는 그 장의 모든 text id를 하나씩 넣는다. 새 문구는 원래 글자 수와 줄 수에 최대한 맞추되(줄바꿈은 \n), 필수 내용을 넣어야 하면 최대 2배까지 늘려도 된다. 계정명은 약사명으로, 페이지 번호는 그대로 둔다.
- [반드시 포함할 내용]의 항목은 하나도 빠짐없이 어느 장이든 글자 덩어리에 들어가야 한다. 날짜·사은품·수치는 바꾸지 말고 그대로 쓴다.
- 첨부한 [상세페이지] 이미지에서 USP, 원료, 함량, 섭취법, 구성, 인정 기능성을 읽어 근거 문구에 반드시 쓰고, [Q&A·베스트 리뷰] 이미지에서 자주 묻는 질문과 답, 대표 리뷰 포인트를 읽어 반드시 쓴다. 이미지에 없는 수치나 사실은 지어내지 않는다.
- 리뷰는 효능·효과 체험(키 큼, 머리 좋아짐, 병이 나음 등)이 아닌 맛·먹기 편함·포장·재구매 같은 사용감 위주로 쓰고, 효능 체험이 들어간 표현은 complianceNotes에 지적한다.
- headline, body는 그 장의 대표 제목과 본문 요약(화면 표시용), layoutRef는 "레퍼런스 n장 레이아웃 그대로", visual은 사진·그림을 바꿔야 할 때 넣을 이미지 제안.
의약품·건강기능식품 광고 규정을 지킨다: 질병의 예방·치료 보장 금지, "100%" 등 단정·과장 금지, 비교우위 단정 금지, 효능·효과를 암시하는 소비자 체험·후기 금지, 효과 단정(두뇌 발달, 머리 좋아짐 등) 금지, 타사 제품명 금지, 건강기능식품은 인정된 기능성 범위의 '도움을 줄 수 있음' 표현만 사용. 애매한 표현은 complianceNotes에 지적하고 대체 문구를 제안한다.
인스타 캡션(captionParts)은 이 순서와 역할을 지킨다:
- hook: 제목이 되는 후킹 문안 한 줄(캡션 맨 위, 스크롤을 멈추게 하는 질문·공감·숫자)
- schedule: 공동구매 일정 안내 한 줄(예: 📅 공동구매 10/12(월) ~ 10/18(일)). 리마인드는 마감 일시를 앞세운다
- benefit: 나눔이벤트·사은품·혜택 1~2줄
- points: 제품 핵심 포인트 3~5개, 각 한 줄(✔ 없이 문장만)
- howTo: 섭취법·구성 1~2줄
- qna: 상세페이지·Q&A에서 자주 묻는 질문 1~2개와 짧은 답(Q. / A. 형식), 없으면 빈 문자열
- cta: 구매 방법 한 줄
- notice: 하단 표기(예: *오메가3: EPA 및 DHA 함유 유지)
각 항목: headline은 20자 내외, body는 2줄 이내, layoutRef는 참고한 레퍼런스 슬라이드와 배치, visual은 넣을 이미지·아이콘 지시. canvaPrompt는 Canva AI에 그대로 붙여넣을 한국어 디자인 지시문으로 비율, 장 수, 색상 hex, 서체 느낌, 장별 배치와 문구를 모두 포함한다.`;

// 2단계 답변 형식. API가 이 형식대로만 답하게 강제한다(구조화 출력).
const COMPOSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slides', 'captionParts', 'hashtags', 'canvaPrompt', 'complianceNotes'],
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['no', 'role', 'headline', 'body', 'layoutRef', 'visual', 'replacements'],
        properties: {
          no: { type: 'integer' },
          role: { type: 'string' },
          headline: { type: 'string' },
          body: { type: 'string' },
          layoutRef: { type: 'string' },
          visual: { type: 'string' },
          replacements: {
            type: 'array',
            items: { type: 'object', additionalProperties: false, required: ['id', 'text'], properties: { id: { type: 'string' }, text: { type: 'string' } } },
          },
        },
      },
    },
    // 인스타 캡션은 정해진 순서의 항목으로 받아 서버에서 이어 붙인다
    captionParts: {
      type: 'object',
      additionalProperties: false,
      required: ['hook', 'schedule', 'benefit', 'points', 'howTo', 'qna', 'cta', 'notice'],
      properties: {
        hook: { type: 'string' },
        schedule: { type: 'string' },
        benefit: { type: 'string' },
        points: { type: 'array', items: { type: 'string' } },
        howTo: { type: 'string' },
        qna: { type: 'string' },
        cta: { type: 'string' },
        notice: { type: 'string' },
      },
    },
    hashtags: { type: 'array', items: { type: 'string' } },
    canvaPrompt: { type: 'string' },
    complianceNotes: { type: 'array', items: { type: 'string' } },
  },
};

function config() {
  return { hasKey: !!API_KEY(), hasApify: !!process.env.APIFY_TOKEN, needsPassword: !!APP_PASSWORD(), maxImages: MAX_IMG };
}
const passwordOk = header => !APP_PASSWORD() || header === APP_PASSWORD();

async function downloadImage(u, referer) {
  try {
    const ir = await fetch(u, { headers: { 'User-Agent': UA, ...(referer ? { Referer: referer } : {}) } });
    const type = (ir.headers.get('content-type') || '').split(';')[0];
    if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await ir.arrayBuffer());
    if (buf.length < 8000 || buf.length > 3.5e6) return null;
    return { media_type: type, data: buf.toString('base64') };
  } catch { return null; }
}

// Apify Instagram Scraper로 게시물(카드뉴스·릴스) 이미지 수집.
// 영상(릴스)은 영상 자체를 분석할 수 없어 커버 이미지를 사용한다.
async function fetchInstagramViaApify(url) {
  const clean = url.split('?')[0].split('#')[0];
  const actor = process.env.APIFY_ACTOR || 'apify~instagram-scraper';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 85000);
  let items;
  try {
    const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=80&format=json&clean=true`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.APIFY_TOKEN}` },
      body: JSON.stringify({ directUrls: [clean], resultsType: 'posts', resultsLimit: 1, addParentData: false }),
    });
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 401 || r.status === 403) throw new Error('Apify 토큰이 올바르지 않아요. APIFY_TOKEN을 확인해 주세요.');
      if (r.status === 402) throw new Error('Apify 사용 한도 또는 크레딧이 부족해요.');
      throw new Error(`Apify 오류 (${r.status}): ${t.slice(0, 160)}`);
    }
    items = await r.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Apify 응답이 너무 늦어요. 잠시 뒤 다시 시도해 주세요.');
    throw e;
  } finally { clearTimeout(timer); }

  const post = Array.isArray(items) ? items[0] : null;
  if (!post || post.error) throw new Error('Apify가 게시물을 가져오지 못했어요. 비공개 계정이거나 삭제된 게시물일 수 있어요.');

  const urls = [];
  if (Array.isArray(post.images) && post.images.length) urls.push(...post.images);
  else if (Array.isArray(post.childPosts) && post.childPosts.length) urls.push(...post.childPosts.map(c => c.displayUrl).filter(Boolean));
  if (!urls.length && post.displayUrl) urls.push(post.displayUrl);
  const isVideo = /video/i.test(post.type || '') || !!post.videoUrl;

  const images = [];
  for (const u of [...new Set(urls)].slice(0, MAX_IMG)) {
    const img = await downloadImage(u);
    if (img) images.push(img);
  }
  const noteParts = [`Apify로 인스타그램 게시물에서 이미지 ${images.length}장을 가져왔어요.`];
  if (isVideo) noteParts.push('영상(릴스)은 커버 이미지로 분석해요. 장면별 레이아웃이 필요하면 영상을 캡처해 올려 주세요.');
  return { images, text: (post.caption || '').slice(0, 800), note: noteParts.join(' ') };
}

async function fetchRefImages(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('http(s) 주소만 입력할 수 있어요.');
  if (/instagram\.com/i.test(url) && process.env.APIFY_TOKEN) return fetchInstagramViaApify(url);
  const out = { images: [], text: '', note: '' };
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko' }, redirect: 'follow' });
  const html = await r.text();
  const meta = p => {
    const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]+content=["']([^"']+)["']`, 'i'))
      || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${p}["']`, 'i'));
    return m ? m[1].replace(/&amp;/g, '&') : '';
  };
  out.text = meta('og:description') || meta('og:title');
  const urls = new Set();
  const og = meta('og:image'); if (og) urls.add(og);
  if (/instagram\.com/i.test(url)) {
    out.note = '인스타그램은 직접 가져올 수 없어요. APIFY_TOKEN을 설정하거나 장별 캡처를 올려 주세요.';
  } else {
    for (const m of html.matchAll(/<img[^>]+src=["'](https?:[^"']+)["']/gi)) { if (urls.size >= MAX_IMG) break; urls.add(m[1].replace(/&amp;/g, '&')); }
  }
  for (const u of urls) {
    try {
      const ir = await fetch(u, { headers: { 'User-Agent': UA, Referer: url } });
      const type = (ir.headers.get('content-type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp|gif)$/.test(type)) continue;
      const buf = Buffer.from(await ir.arrayBuffer());
      if (buf.length < 8000 || buf.length > 3e6) continue;
      out.images.push({ media_type: type, data: buf.toString('base64') });
    } catch { /* 건너뜀 */ }
  }
  return out;
}

// schema를 넘기면 답변이 그 JSON 형식으로 강제된다.
// 이 모델은 생각(thinking)도 max_tokens 안에서 쓰므로 한도를 넉넉히 잡아야 답이 잘리지 않는다.
async function claude(content, system, maxTokens, schema) {
  if (!API_KEY()) throw new Error('서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.');
  const output_config = { effort: 'medium' };
  if (schema) output_config.format = { type: 'json_schema', schema };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': API_KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: maxTokens, system, output_config, messages: [{ role: 'user', content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || `Claude API 오류 (${r.status})`);
  if (j.stop_reason === 'max_tokens') throw new Error('답변이 너무 길어 중간에 잘렸어요. 장 수를 줄여 다시 시도해 주세요.');
  if (j.stop_reason === 'refusal') throw new Error('AI가 이 요청에 답하지 않았어요. 문구를 조금 바꿔 다시 시도해 주세요.');
  const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('응답에서 JSON을 찾지 못했어요. 다시 시도해 주세요.');
  try { return JSON.parse(m[0]); } catch {
    console.error('JSON 파싱 실패 원문:', text.slice(0, 3000));
    throw new Error('응답 JSON을 해석하지 못했어요. 다시 시도해 주세요.');
  }
}

async function analyze(body) {
  let images = (body.images || []).filter(i => /^image\/(jpeg|png|webp|gif)$/.test(i.media_type) && i.data).slice(0, MAX_IMG);
  const uploaded = images.length;
  let text = '', note = '';
  if (body.url) {
    const got = await fetchRefImages(String(body.url).trim());
    images = images.concat(got.images).slice(0, MAX_IMG); text = got.text; note = got.note;
  }
  if (!images.length) throw new Error('이미지를 가져오지 못했어요. 카드뉴스를 캡처해서 직접 올려 주세요.');
  const content = images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } }));
  content.push({ type: 'text', text: `레퍼런스 이미지 ${images.length}장(순서대로). 게시물 설명: ${text || '없음'}` });
  // URL에서 가져온 이미지는 브라우저에 없으므로 돌려준다(Canva 디자인 배경으로 씀). 응답 용량 제한(4.5MB) 안에서만.
  const fetched = [];
  let size = 0;
  for (const im of images.slice(uploaded)) { size += im.data.length; if (size > 3.3e6) break; fetched.push(im); }
  return { analysis: await claude(content, ANALYZE_SYS, 16000, ANALYZE_SCHEMA), note, usedImages: images.length, fetchedImages: fetched };
}

async function compose(body) {
  if (!body.analysis) throw new Error('먼저 레퍼런스를 분석해 주세요.');
  const st = STAGES[body.stage] || STAGES.conversion;
  const p = body.pharmacist || {};
  const n = (body.analysis.slides || []).length || Math.min(10, Math.max(3, +body.slideCount || st.flow.length));
  const srcImgs = (list, label) => (Array.isArray(list) ? list : [])
    .filter(i => /^image\/(jpeg|png|webp)$/.test(i.media_type) && i.data).slice(0, 20)
    .map(i => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } }))
    .reduce((acc, im, k, arr) => (k === 0 ? [{ type: 'text', text: `[${label}] 이미지 ${arr.length}장(위에서 아래로 이어짐)` }, im] : [...acc, im]), []);
  const detail = srcImgs(body.detailImages, '상세페이지');
  const reviews = srcImgs(body.reviewImages, 'Q&A·베스트 리뷰');
  const prompt = `[마케팅 단계] ${st.label} - ${st.goal}
[반드시 포함할 내용]
${p.must || '(없음)'}
[참고 흐름(구성은 레퍼런스 우선)] ${st.flow.join(' → ')}
[약사] ${p.name || ''}  [제품/주제] ${p.product || ''}  [타깃·증상] ${p.target || ''}
[핵심 성분·근거] ${p.facts || ''}  [CTA] ${p.cta || ''}
[첨부 자료] 상세페이지 ${detail.length ? detail.length - 1 + '장' : '없음'}, Q&A·베스트 리뷰 ${reviews.length ? reviews.length - 1 + '장' : '없음'}
[장 수] ${n} (레퍼런스와 동일)
[레퍼런스 장별 글자 덩어리] 원래 문구와 글자 수
${(body.analysis.slides || []).map(sl => `${sl.no}장(${sl.role}): ` + (sl.texts || []).map(t => `${t.id}[${t.kind}, ${String(t.text || '').length}자] "${t.text}"`).join(' / ')).join('\n')}
[레퍼런스 디자인 분석]
${JSON.stringify({ ...body.analysis, slides: (body.analysis.slides || []).map(({ texts, ...r }) => r) })}`;
  const content = detail.length || reviews.length ? [...detail, ...reviews, { type: 'text', text: prompt }] : prompt;
  const r = await claude(content, COMPOSE_SYS, 16000, COMPOSE_SCHEMA);
  r.caption = captionText(r.captionParts);
  return r;
}

// 캡션 항목 → 인스타에 붙여넣을 글 (후킹 제목 → 일정 → 혜택 → 포인트 → 섭취법 → Q&A → 구매 → 표기)
function captionText(c) {
  if (!c) return '';
  const t = v => String(v || '').trim();
  const blocks = [
    t(c.hook),
    t(c.schedule),
    t(c.benefit) && `🎁 ${t(c.benefit)}`,
    (c.points || []).map(t).filter(Boolean).map(x => `✔ ${x}`).join('\n'),
    t(c.howTo) && `💊 ${t(c.howTo)}`,
    t(c.qna),
    t(c.cta) && `👉 ${t(c.cta)}`,
    t(c.notice),
  ];
  return blocks.filter(Boolean).join('\n\n');
}

// 공통 라우트 처리: (이름, 본문, 비밀번호 헤더) -> {code, json}
async function handle(name, body, pw) {
  try {
    if (name === 'config') return { code: 200, json: config() };
    if (!passwordOk(pw)) return { code: 401, json: { error: '접속 비밀번호가 맞지 않아요.' } };
    if (name === 'analyze') return { code: 200, json: await analyze(body || {}) };
    if (name === 'compose') return { code: 200, json: await compose(body || {}) };
    return { code: 404, json: { error: 'not found' } };
  } catch (e) {
    return { code: 500, json: { error: e.message } };
  }
}

module.exports = { handle };
