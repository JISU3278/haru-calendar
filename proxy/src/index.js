// 하루 캘린더 중계 서버 (Cloudflare Worker)
// 친구 앱 → 이 서버(초대 코드 확인·하루 횟수 제한) → Claude API
// 비밀값(코드에 넣지 않음): ANTHROPIC_API_KEY, INVITE_CODE  ← `wrangler secret put`으로 등록
// 설정값: wrangler.toml의 [vars]

const ANTHROPIC = 'https://api.anthropic.com';
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const ALLOWED_KEYS = new Set(['model', 'max_tokens', 'messages', 'output_config', 'fallbacks']);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGINS.split(',').map((s) => s.trim());
    const cors = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || '*',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const fail = (status, type, message) => new Response(
      JSON.stringify({ type: 'error', error: { type, message } }),
      { status, headers: { ...cors, 'content-type': 'application/json', 'x-should-retry': 'false' } },
    );

    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== '/v1/messages') return fail(404, 'not_found_error', '없는 주소예요.');
    if (!allowed.includes(origin)) return fail(403, 'permission_error', '하루 캘린더 앱에서만 쓸 수 있어요.');

    // 초대 코드
    const invite = request.headers.get('x-haru-invite') || '';
    if (!env.INVITE_CODE || !(await sameText(invite, env.INVITE_CODE))) {
      return fail(403, 'permission_error', '초대 코드가 맞지 않아요. 설정에서 확인해 주세요.');
    }
    const device = (request.headers.get('x-haru-device') || '').slice(0, 64);
    if (!/^[a-z0-9-]{8,64}$/i.test(device)) return fail(400, 'invalid_request_error', '앱을 새로고침한 뒤 다시 해 주세요.');

    // 요청 내용 확인 (사진 읽기 용도로만)
    const len = Number(request.headers.get('content-length') || 0);
    if (len > MAX_BODY_BYTES) return fail(413, 'request_too_large', '사진이 너무 커요.');
    let body;
    try { body = await request.json(); } catch { return fail(400, 'invalid_request_error', '요청 형식이 잘못됐어요.'); }
    for (const k of Object.keys(body)) if (!ALLOWED_KEYS.has(k)) delete body[k];
    const strong = body.model === env.STRONG_MODEL;
    if (body.model !== env.FAST_MODEL && !strong) return fail(400, 'invalid_request_error', '지원하지 않는 모델이에요.');
    body.max_tokens = Math.min(Number(body.max_tokens) || 4000, 16000);

    // 하루 횟수 제한 (한국 날짜 기준)
    const day = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const keys = {
      all: `${day}:all`,
      dev: `${day}:dev:${device}`,
      ...(strong && { strong: `${day}:strong:${device}` }),
    };
    const limits = {
      all: Number(env.DAILY_LIMIT_TOTAL),
      dev: Number(env.DAILY_LIMIT_PER_DEVICE),
      strong: Number(env.DAILY_LIMIT_STRONG_PER_DEVICE),
    };
    const counts = {};
    for (const [name, key] of Object.entries(keys)) {
      counts[name] = Number(await env.RATE.get(key)) || 0;
      if (counts[name] >= limits[name]) {
        const msg = name === 'all' ? '오늘 전체 사용량이 다 찼어요. 내일 다시 해 주세요.'
          : name === 'strong' ? `Opus 다시 읽기는 하루 ${limits.strong}번까지예요.`
            : `사진 읽기는 하루 ${limits.dev}장까지예요. 내일 다시 해 주세요.`;
        return fail(429, 'rate_limit_error', msg);
      }
    }
    await Promise.all(Object.entries(keys).map(([name, key]) => env.RATE.put(key, String(counts[name] + 1), { expirationTtl: 3 * 86400 })));

    // Claude API로 전달 (키는 여기서만 붙임)
    const headers = {
      'content-type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': request.headers.get('anthropic-version') || '2023-06-01',
    };
    const beta = request.headers.get('anthropic-beta');
    if (beta) headers['anthropic-beta'] = beta;
    const res = await fetch(`${ANTHROPIC}/v1/messages${url.search}`, { method: 'POST', headers, body: JSON.stringify(body) });

    const out = new Headers(cors);
    out.set('content-type', res.headers.get('content-type') || 'application/json');
    const rid = res.headers.get('request-id');
    if (rid) out.set('request-id', rid);
    return new Response(res.body, { status: res.status, headers: out });
  },
};

// 초대 코드 비교 (글자 길이·내용으로 시간 차이가 나지 않게)
async function sameText(a, b) {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(ha, hb);
}
