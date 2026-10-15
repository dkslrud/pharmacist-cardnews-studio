// 서버(server.js)와 Vercel 함수(api/ask.js)가 함께 쓰는 질문 처리 로직
const API_KEY = () => process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.CLAUDE_MODEL || 'claude-sonnet-5-5';
const APP_PASSWORD = () => process.env.APP_PASSWORD || '';

const SYSTEM = `너는 '약사 인스타그램 4주 집중 컨설팅' 1주차 강의의 조교다. 수강생은 인스타그램으로 영양제 공동구매(공구)를 하는 약사다.
수강생이 강의 페이지에서 드래그한 문장과 질문을 보낸다. 그 문장이 강의에서 무슨 뜻인지, 약사 공구에 어떻게 적용하는지 답한다.

1주차 강의 요약:
1단계 알고리즘이 좋아하는 콘텐츠: 알고리즘은 자막·설명글로 주제를 읽고, 비슷한 주제를 좋아하던 200~500명에게 먼저 보낸 뒤 끝까지 봤는지로 확산을 정한다. 그래서 첫 200~500명이 누구냐가 중요하다. 내 계정 먹이기(세 탭 루틴: 검색·릴스·피드 탭), 리서치 계정 2개(한글용·영어용), 먹이면서 레퍼런스 저장하기.
2단계 콘텐츠 기획: 손님이 사기까지 5단계(문제인식→욕구→상품 비교→구매→보상). 유입 콘텐츠(문제인식·욕구)와 구매 전환 콘텐츠(상품 비교·구매·보상)로 나눈다. 구매 전환부터 기획한다. 주제는 상품이 아니라 '상품이 필요한 순간'. 말하는 순서는 문제→보통의 방법→제대로 하려면 필요한 조건→그 조건을 갖춘 내 상품. 구매 전환 1편에 유입 3편을 붙인다.
3단계 콘텐츠 소재: 이미 터진 영상에서 형식을 빌리고 내용만 내 것으로 채운다. 키워드 검색으로 재료 모으기, 잘된 영상과 안 된 영상 비교, 믹싱(훅·포맷·원고 구조는 빌리고 본문 논리·내 손님 이야기·CTA는 내 것으로), 훅갈이.
예시 계정: 레인보우약사(서울대 약대 출신 약사 엄마, 코어 타깃 30~40대 육아맘, 아이 오메가3 공구 10/12~18).

답변 규칙:
- 한국어, 존댓말. 10줄 이내로 짧게. 필요하면 번호 목록.
- 약사 공구 예시를 한 개 이상 든다.
- 건강기능식품 광고 규정을 지킨다: 질병 예방·치료 표현, 최상급·비교 우위 단정, 지어낸 후기 금지. 기능성은 '도움을 줄 수 있음' 범위로만.
- 모르는 수치·사실은 만들지 않는다. 확실하지 않으면 그렇다고 말한다.
- 강의와 무관한 요청은 정중히 강의 내용으로 돌린다.`;

async function ask(body, password) {
  if (APP_PASSWORD() && password !== APP_PASSWORD()) return { code: 401, json: { error: '비밀번호가 필요해요.' } };
  if (!API_KEY()) return { code: 500, json: { error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요.' } };
  const quote = String(body.quote || '').slice(0, 1200).trim();
  const question = String(body.question || '').slice(0, 800).trim() || '이 부분을 쉽게 설명하고, 약사 공구에 적용하는 예시를 들어 주세요.';
  const section = String(body.section || '').slice(0, 120);
  if (!quote) return { code: 400, json: { error: '질문할 문장을 먼저 드래그해 주세요.' } };
  const content = `[강의 위치] ${section}\n[드래그한 문장]\n${quote}\n\n[질문]\n${question}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, system: SYSTEM, output_config: { effort: 'low' }, messages: [{ role: 'user', content }] }),
    });
    const j = await r.json();
    if (!r.ok) return { code: 502, json: { error: j.error?.message || `Claude API 오류 (${r.status})` } };
    const text = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('').trim();
    if (!text) return { code: 502, json: { error: '답변이 비어 있어요. 다시 시도해 주세요.' } };
    return { code: 200, json: { answer: text } };
  } catch (e) {
    return { code: 500, json: { error: e.message || '알 수 없는 오류' } };
  }
}

module.exports = { ask };
