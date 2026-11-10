// 사진 속 일정을 Claude API로 읽기
// - API 키는 이 기기의 localStorage에만 저장 (백업 파일에도 넣지 않음)
// - 개인용: 브라우저에서 바로 API를 부름. 앱스토어 출시 때는 App Attest 등으로 바꿀 것
import { ymd } from './dates.js';

const KEY_STORAGE = 'haru.apiKey';
// 공식 SDK를 필요할 때만 불러옴 (앱 첫 화면은 인터넷 없이도 열리도록)
const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.4.0/+esm';

export const MODELS = {
  fast: 'claude-haiku-5-5', // 기본: 빠르고 저렴
  strong: 'claude-opus-5-5', // 다시 읽기: 손글씨·복잡한 표
};

export function getApiKey() {
  try { return localStorage.getItem(KEY_STORAGE) || ''; } catch { return ''; }
}
export function setApiKey(key) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* 저장 실패는 무시 */ }
}

let sdkPromise = null;
function loadSdk() {
  sdkPromise ??= import(SDK_URL).then((m) => m.default || m.Anthropic).catch((err) => {
    sdkPromise = null;
    throw err;
  });
  return sdkPromise;
}

// 사진을 긴 변 1568px 이하 JPEG로 줄여서 base64로 (비용·속도 절약)
async function imageToBase64(file, maxSide = 1568) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('사진을 열지 못했어요'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          title: { type: 'string' },
          time: { type: 'string', description: 'HH:MM (24시간), 없으면 빈 문자열' },
          date_undecided: { type: 'boolean' },
          note: { type: 'string', description: '확인이 필요한 이유, 없으면 빈 문자열' },
        },
        required: ['date', 'title', 'time', 'date_undecided', 'note'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};

function prompt(todayStr) {
  return `이 이미지에서 일정을 모두 찾아 날짜별 항목으로 정리해 주세요. 오늘은 ${todayStr}입니다.

- 연도가 없으면 오늘과 가장 가까운 미래(또는 아주 최근) 날짜가 되도록 연도를 정하세요.
- 날짜 없이 "11월 중"처럼 월만 있는 항목은 그 달 1일로 하고 date_undecided를 true로 하세요.
- 한 일정이 여러 날에 걸치면 날짜마다 따로 항목을 만드세요.
- title은 이미지에 적힌 표현을 살려 짧게 쓰고, 장소가 있으면 제목 뒤에 붙이세요. 이모지 장식은 빼세요.
- 시작 시간이 적혀 있으면 time에 24시간 HH:MM으로, 없으면 빈 문자열로 두세요.
- 글자가 흐리거나 날짜·요일이 서로 맞지 않는 등 확인이 필요하면 note에 한국어로 짧게 적고, 아니면 빈 문자열로 두세요.
- 일정이 아닌 글(광고, 안내 문구 등)은 넣지 마세요.`;
}

const VALID_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// 사진 → [{date, title, time, dateUndecided, reasons}]
export async function readScheduleImage(file, { strong = false } = {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('설정에서 Claude API 키를 먼저 넣어 주세요.');

  const [Anthropic, data] = await Promise.all([
    loadSdk().catch(() => { throw new Error('인터넷에 연결되어 있는지 확인해 주세요.'); }),
    imageToBase64(file),
  ]);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });

  const params = {
    model: strong ? MODELS.strong : MODELS.fast,
    max_tokens: 16000,
    output_config: { format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } },
        { type: 'text', text: prompt(ymd(new Date())) },
      ],
    }],
  };

  let res;
  try {
    res = strong
      // Opus가 안전 정책으로 거절하면 서버가 다른 모델로 자동 재시도
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (err) {
    throw new Error(explainError(Anthropic, err));
  }

  if (res.stop_reason === 'refusal') throw new Error('이 사진은 읽지 못했어요. 다른 사진으로 해 주세요.');
  if (res.stop_reason === 'max_tokens') throw new Error('일정이 너무 많아요. 사진을 나눠서 해 주세요.');
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('결과를 읽지 못했어요. 다시 시도해 주세요.'); }

  return (parsed.items || [])
    .filter((it) => it && VALID_DATE.test(it.date) && !Number.isNaN(Date.parse(it.date)))
    .map((it) => ({
      date: it.date,
      title: String(it.title || '').trim() || '(제목 없음)',
      time: VALID_TIME.test(it.time) ? it.time : null,
      dateUndecided: !!it.date_undecided,
      reasons: [it.note && it.note.trim(), it.date_undecided && '날짜가 정해지지 않아 1일로 넣었어요']
        .filter(Boolean),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function explainError(Anthropic, err) {
  if (err instanceof Anthropic.AuthenticationError) return 'API 키가 맞지 않아요. 설정에서 키를 확인해 주세요.';
  if (err instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 사용할 수 없어요. 콘솔에서 키 권한을 확인해 주세요.';
  if (err instanceof Anthropic.RateLimitError) return '요청이 많아요. 잠시 뒤 다시 해 주세요.';
  if (err instanceof Anthropic.BadRequestError) {
    const msg = err.error?.error?.message || err.message || '';
    if (/credit balance/i.test(msg)) return '크레딧이 부족해요. 콘솔에서 충전해 주세요.';
    if (/workspace/i.test(msg)) return '키에 워크스페이스가 지정되지 않았어요. 콘솔에서 워크스페이스를 지정한 키를 만들어 주세요.';
    return `요청 오류: ${msg}`;
  }
  if (err instanceof Anthropic.APIConnectionError) return '인터넷에 연결되어 있는지 확인해 주세요.';
  if (err instanceof Anthropic.APIError) return `Claude 서버 오류 (${err.status ?? '?'}). 잠시 뒤 다시 해 주세요.`;
  return err?.message || '알 수 없는 오류가 났어요.';
}
