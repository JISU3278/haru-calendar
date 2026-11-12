// 날짜·시간·색 선택 화면 — 휴대폰 기본 창 대신 앱 안에서 그려서 아이폰·갤럭시 모두 같은 모양
//
// 사용법: 화면에 <input type="date|time|color">를 그대로 쓰면, enhancePickers()가
// 그 칸을 '숨긴 입력칸 + 누르는 버튼'으로 바꿉니다. 값(.value)과 change/input 이벤트는
// 원래 입력칸 그대로라서 다른 코드는 고칠 필요가 없습니다.
// 날짜 칸의 min 속성(YYYY-MM-DD)이 있으면 그보다 앞 날짜는 고를 수 없습니다.
import { WEEKDAYS, addMonths, daysInMonth, parseYmd, today, ymd } from './dates.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHEV_L = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
const CHEV_R = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';

/* ───── 표시 형식 ───── */
export function dateLabel(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '')) return '날짜 선택';
  const d = parseYmd(v);
  const y = d.getFullYear() !== today().getFullYear() ? `${d.getFullYear()}년 ` : '';
  return `${y}${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}
export function timeLabel(v) {
  const m = /^(\d{2}):(\d{2})$/.exec(v || '');
  if (!m) return '시간 선택';
  const h = Number(m[1]);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${m[2]}`;
}

/* ───── 공통: 아래에서 올라오는 작은 창 ───── */
function openPicker(html, onMount) {
  const wrap = document.createElement('div');
  wrap.className = 'picker';
  wrap.innerHTML = `<div class="picker-backdrop" data-cancel></div><div class="picker-box" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = () => {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
  };
  onMount(wrap.querySelector('.picker-box'), close, wrap);
  return close;
}

function setValue(input, v, { live = false } = {}) {
  input.value = v;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  if (!live) input.dispatchEvent(new Event('change', { bubbles: true }));
}

/* ───── 날짜: 월 달력에서 탭하면 바로 선택 ───── */
function openDatePicker(input) {
  const selected = input.value;
  const min = input.min || '';
  let view = selected ? parseYmd(selected) : today();
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  const todayStr = ymd(today());

  openPicker('<div data-cal></div>', (box, close, wrap) => {
    const draw = () => {
      const y = view.getFullYear();
      const m = view.getMonth();
      const lead = new Date(y, m, 1).getDay();
      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<span></span>';
      for (let d = 1; d <= daysInMonth(y, m); d++) {
        const ds = ymd(new Date(y, m, d));
        const wd = (lead + d - 1) % 7;
        const cls = [
          'pk-day',
          ds === selected && 'on',
          ds === todayStr && 'today',
          wd === 0 && 'sun',
          wd === 6 && 'sat',
        ].filter(Boolean).join(' ');
        cells += `<button type="button" class="${cls}" data-d="${ds}" ${min && ds < min ? 'disabled' : ''}>${d}</button>`;
      }
      box.querySelector('[data-cal]').innerHTML = `
        <div class="pk-head">
          <button type="button" class="pk-nav" data-step="-1" aria-label="이전 달">${CHEV_L}</button>
          <strong>${y}년 ${m + 1}월</strong>
          <button type="button" class="pk-nav" data-step="1" aria-label="다음 달">${CHEV_R}</button>
        </div>
        <div class="pk-wk">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
        <div class="pk-grid">${cells}</div>
        <button type="button" class="pk-today" data-d="${todayStr}" ${min && todayStr < min ? 'disabled' : ''}>오늘</button>`;
    };
    draw();
    box.addEventListener('click', (e) => {
      const step = e.target.closest('[data-step]');
      if (step) { view = addMonths(view, Number(step.dataset.step)); draw(); return; }
      const day = e.target.closest('[data-d]');
      if (day && !day.disabled) { setValue(input, day.dataset.d); close(); }
    });
    wrap.querySelector('[data-cancel]').addEventListener('click', close);
    // 좌우로 밀어서 달 넘기기
    let sx = null;
    box.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx;
      sx = null;
      if (Math.abs(dx) > 50) { view = addMonths(view, dx < 0 ? 1 : -1); draw(); }
    }, { passive: true });
  });
}

/* ───── 시간: 위아래로 굴리는 휠 (오전/오후 · 시 · 분) ───── */
const ROW = 40; // 휠 한 칸 높이(px)

function wheelHTML(items, name) {
  return `<div class="wheel" data-wheel="${name}">${items.map((t) => `<div class="wheel-item">${t}</div>`).join('')}</div>`;
}

function openTimePicker(input) {
  const m = /^(\d{2}):(\d{2})$/.exec(input.value || '') || [null, '09', '00'];
  const h24 = Number(m[1]);
  const start = { ampm: h24 < 12 ? 0 : 1, hour: (h24 % 12 || 12) - 1, min: Number(m[2]) };
  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const mins = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  openPicker(`
    <div class="pk-bar">
      <button type="button" class="pk-text" data-cancel>취소</button>
      <strong>시간</strong>
      <button type="button" class="pk-text pk-done" data-done>완료</button>
    </div>
    <div class="wheels">
      <div class="wheel-band"></div>
      ${wheelHTML(['오전', '오후'], 'ampm')}
      ${wheelHTML(hours, 'hour')}
      ${wheelHTML(mins, 'min')}
    </div>`, (box, close, wrap) => {
    const wheels = {};
    box.querySelectorAll('[data-wheel]').forEach((w) => { wheels[w.dataset.wheel] = w; });
    // 처음 위치로 굴려 두기
    requestAnimationFrame(() => {
      for (const [k, w] of Object.entries(wheels)) w.scrollTop = start[k] * ROW;
    });
    // 칸을 탭하면 그 칸으로 굴러감
    box.addEventListener('click', (e) => {
      const item = e.target.closest('.wheel-item');
      if (!item) return;
      const w = item.parentElement;
      w.scrollTo({ top: [...w.children].indexOf(item) * ROW, behavior: 'smooth' });
    });
    const idx = (w) => Math.max(0, Math.min(w.children.length - 1, Math.round(w.scrollTop / ROW)));
    box.querySelector('[data-done]').addEventListener('click', () => {
      const h12 = idx(wheels.hour) + 1;
      const h = (h12 % 12) + (idx(wheels.ampm) === 1 ? 12 : 0);
      setValue(input, `${String(h).padStart(2, '0')}:${mins[idx(wheels.min)]}`);
      close();
    });
    box.querySelector('[data-cancel]').addEventListener('click', close);
    wrap.querySelector('.picker-backdrop').addEventListener('click', close);
  });
}

/* ───── 색: 색 영역(채도·밝기) + 색상 막대 ───── */
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function openColorPicker(input) {
  const original = /^#[0-9a-f]{6}$/i.test(input.value) ? input.value : '#ffca2a';
  let [h, s, v] = rgbToHsv(...hexToRgb(original));
  const current = () => rgbToHex(...hsvToRgb(h, s, v));

  openPicker(`
    <div class="pk-bar">
      <button type="button" class="pk-text" data-cancel>취소</button>
      <strong>테마색</strong>
      <button type="button" class="pk-text pk-done" data-done>완료</button>
    </div>
    <div class="cp-area" data-area><span class="cp-knob" data-area-knob></span></div>
    <div class="cp-hue" data-hue><span class="cp-knob" data-hue-knob></span></div>
    <div class="cp-row"><span class="cp-preview" data-preview></span><span class="cp-hex" data-hex></span></div>`, (box, close, wrap) => {
    const area = box.querySelector('[data-area]');
    const hue = box.querySelector('[data-hue]');
    const paint = () => {
      area.style.setProperty('--hue', `hsl(${h}, 100%, 50%)`);
      box.querySelector('[data-area-knob]').style.cssText = `left:${s * 100}%;top:${(1 - v) * 100}%;background:${current()}`;
      box.querySelector('[data-hue-knob]').style.cssText = `left:${(h / 360) * 100}%;background:hsl(${h}, 100%, 50%)`;
      box.querySelector('[data-preview]').style.background = current();
      box.querySelector('[data-hex]').textContent = current().toUpperCase();
      setValue(input, current(), { live: true }); // 고르는 동안 앱 색도 바로 바뀜
    };
    const drag = (el, onMove) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const move = (ev) => {
          const r = el.getBoundingClientRect();
          onMove(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height)));
          paint();
        };
        move(e);
        const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
      });
    };
    drag(area, (x, y) => { s = x; v = 1 - y; });
    drag(hue, (x) => { h = Math.min(359.9, x * 360); });
    paint();
    const cancel = () => { setValue(input, original, { live: true }); close(); };
    box.querySelector('[data-done]').addEventListener('click', () => { setValue(input, current()); close(); });
    box.querySelector('[data-cancel]').addEventListener('click', cancel);
    wrap.querySelector('.picker-backdrop').addEventListener('click', cancel);
  });
}

/* ───── 기본 입력칸 → 버튼으로 바꾸기 ───── */
const VALUE = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function enhance(input) {
  const kind = input.type;
  if (input.dataset.pk || !['date', 'time', 'color'].includes(kind)) return;
  input.dataset.pk = kind;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `pick-btn pick-${kind}`;
  const refresh = () => {
    const v = VALUE.get.call(input);
    if (kind === 'color') btn.style.background = v;
    else btn.textContent = kind === 'date' ? dateLabel(v) : timeLabel(v);
  };
  if (kind === 'color') btn.setAttribute('aria-label', '색 고르기');
  input.type = 'hidden';
  // 코드에서 .value를 바꿔도 버튼 글자가 따라 바뀌게
  Object.defineProperty(input, 'value', {
    configurable: true,
    get() { return VALUE.get.call(this); },
    set(v) { VALUE.set.call(this, v); refresh(); },
  });
  input.after(btn);
  refresh();
  btn.addEventListener('click', () => {
    if (kind === 'date') openDatePicker(input);
    else if (kind === 'time') openTimePicker(input);
    else openColorPicker(input);
  });
}

export function enhancePickers(root = document) {
  root.querySelectorAll('input[type="date"], input[type="time"], input[type="color"]').forEach(enhance);
}

// 바텀시트처럼 나중에 생기는 화면도 자동으로 바꿈
export function watchPickers(root) {
  enhancePickers(root);
  new MutationObserver(() => enhancePickers(root)).observe(root, { childList: true, subtree: true });
}
