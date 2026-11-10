import {
  COLORS, DEFAULT_COLOR, DEFAULT_THEME, colorVars, themeVars,
} from './colors.js';
import {
  WEEKDAYS, addDays, addMonths, addYears, daysInMonth, formatMD, formatYM,
  parseYmd, startOfWeek, today, ymd,
} from './dates.js';
import {
  PROXY_URL, canReadPhotos, getApiKey, getInvite, readScheduleImage, setApiKey, setInvite,
} from './ai.js';
import { parseScheduleText } from './parser.js';
import { countWeekly, expandWeekly } from './recurrence.js';
import { store } from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VIEW_KEY = 'haru.view';
const THEME_KEY = 'haru.theme';
const GRAY_KEY = 'haru.gray';
const GRAYS = { cool: '쿨톤', neutral: '뉴트럴', warm: '웜톤' };

// 회색 톤 (기본: 웜톤)
function readGray() {
  try {
    const v = localStorage.getItem(GRAY_KEY);
    return v in GRAYS ? v : 'warm';
  } catch {
    return 'warm';
  }
}
function applyGray(g) {
  if (g === 'warm') document.documentElement.removeAttribute('data-gray');
  else document.documentElement.setAttribute('data-gray', g);
}
applyGray(readGray());

// 테마색 적용 (설정에서 고른 색, 없으면 기본 노랑)
function readTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return /^#[0-9a-f]{6}$/i.test(v || '') ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}
function applyTheme(hex) {
  const isDefault = hex.toUpperCase() === DEFAULT_THEME.toUpperCase();
  for (const [k, v] of Object.entries(themeVars(hex))) {
    // 기본 노랑은 styles.css에 맞춰 둔 원래 값을 그대로 씀
    if (isDefault) document.documentElement.style.removeProperty(k);
    else document.documentElement.style.setProperty(k, v);
  }
}
function saveTheme(hex) {
  try {
    if (hex.toUpperCase() === DEFAULT_THEME.toUpperCase()) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, hex);
  } catch { /* 저장 실패는 무시 */ }
}
applyTheme(readTheme());
const state = {
  view: readView(),
  cursor: today(), // 선택된 날짜
  editing: null, // 순서 편집 중인 날짜 'YYYY-MM-DD' (null이면 편집 아님)
};
const isEditing = () => state.editing === ymd(state.cursor) && state.view !== 'week';

function readView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return ['month', 'week'].includes(v) ? v : 'month'; // 예전 '일간'은 월간으로
  } catch {
    return 'month';
  }
}

const HANDLE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M5 8h14M5 12h14M5 16h14"/></svg>';
const CHECK_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

/* ───────────────── 렌더링 ───────────────── */

function render() {
  const { view, cursor } = state;
  $('#title').textContent = formatYM(cursor);

  $$('.seg button').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', on);
  });
  const main = $('#main');
  main.innerHTML = view === 'week' ? renderWeek() : renderMonth();
}

const isTodo = (t) => t.kind === 'todo';
const KIND_LABEL = { event: '일정', todo: '할 일' };

// 일정: 보기만 / 할 일: 오른쪽 끝에 완료 체크
function renderTaskItem(t, editing = false) {
  const todo = isTodo(t);
  const badges = [];
  if (t.dateUndecided) badges.push('<span class="badge warn">날짜 미정</span>');
  return `
    <li class="task ${todo ? 'todo' : 'event'} ${todo && t.done ? 'done' : ''}" data-id="${t.id}" style="${colorVars(t.color)}">
      <button class="task-body" type="button" data-action="edit">
        <span class="t-head"><span class="t-title">${esc(t.title)}</span>${t.time ? `<span class="badge time">${esc(t.time)}</span>` : ''}${t.seriesId ? '<span class="badge">반복</span>' : ''}</span>
        <span class="t-meta">${badges.join('')}</span>
        ${t.note ? `<span class="t-note">${esc(t.note)}</span>` : ''}
      </button>
      ${editing ? `<span class="handle" aria-label="끌어서 순서 바꾸기">${HANDLE_SVG}</span>` : ''}
      ${todo && !editing ? `<button class="check" type="button" data-action="toggle" aria-label="${t.done ? '완료 취소' : '완료'}">${CHECK_SVG}</button>` : ''}
    </li>`;
}

function renderTaskList(list, editing = false) {
  return `<ul class="tasks ${editing ? 'editing' : ''}">${list.map((t) => renderTaskItem(t, editing)).join('')}</ul>`;
}

// 하루 목록: 일정 / 할 일 두 묶음으로
function renderSections(list) {
  const events = list.filter((t) => !isTodo(t));
  const todos = list.filter(isTodo);
  const editing = isEditing();
  return `
    ${events.length ? `<p class="section-label">일정</p>${renderTaskList(events, editing)}` : ''}
    ${todos.length ? `<p class="section-label">할 일<span class="count">${todoCount(list)}</span></p>${renderTaskList(todos, editing)}` : ''}`;
}

// 날짜 목록 머리: 날짜 · 완료 개수 · 편집 버튼(2개 이상일 때)
function panelHead(d, list) {
  const editing = isEditing();
  return `
      <div class="panel-head">
        <h2>${formatMD(d)}</h2>
        <div class="panel-right">
          ${list.length > 1 ? `<button class="edit-btn ${editing ? 'on' : ''}" type="button" data-action="edit-order">${editing ? '완료' : '편집'}</button>` : ''}
        </div>
      </div>`;
}

function todoCount(list) {
  const todos = list.filter(isTodo);
  return todos.length ? `할 일 ${todos.filter((t) => t.done).length}/${todos.length} 완료` : '';
}

function addButtons(ds) {
  if (isEditing()) return '';
  return `
    <div class="add-row">
      <button class="add-inline" type="button" data-action="add" data-kind="event" data-for="${ds}">+ 일정</button>
      <button class="add-inline" type="button" data-action="add" data-kind="todo" data-for="${ds}">+ 할 일</button>
    </div>`;
}

function renderMonth() {
  const { cursor } = state;
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1);
  const gridStart = startOfWeek(first);
  const rows = Math.ceil((first.getDay() + daysInMonth(y, m)) / 7);
  const gridEnd = addDays(gridStart, rows * 7 - 1);
  const map = store.groupByDate(ymd(gridStart), ymd(gridEnd));
  const todayStr = ymd(today());
  const selStr = ymd(cursor);

  let cells = '';
  for (let i = 0; i < rows * 7; i++) {
    const d = addDays(gridStart, i);
    const ds = ymd(d);
    const list = map.get(ds) || [];
    const cls = [
      'cell',
      d.getMonth() !== m && 'out',
      d.getDay() === 0 && 'sun',
      d.getDay() === 6 && 'sat',
      ds === todayStr && 'today',
      ds === selStr && 'sel',
    ].filter(Boolean).join(' ');
    const shown = list.slice(0, 3);
    const more = list.length - shown.length;
    cells += `
      <button class="${cls}" type="button" data-date="${ds}" aria-label="${formatMD(d)}, 할 일 ${list.length}개">
        <span class="num">${d.getDate()}</span>
        ${shown.map((t) => `<span class="lbl ${isTodo(t) ? 'todo' : ''} ${isTodo(t) && t.done ? 'done' : ''}" style="${colorVars(t.color)}">${esc(t.title)}</span>`).join('')}
        ${more > 0 ? `<span class="more">+${more}</span>` : ''}
      </button>`;
  }

  const selList = store.byDate(selStr);
  return `
    <section class="month">
      <div class="wk-head">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
      <div class="grid">${cells}</div>
    </section>
    <section class="panel">
      ${panelHead(cursor, selList)}
      ${selList.length ? renderSections(selList) : '<p class="empty">일정과 할 일이 없어요</p>'}
      ${addButtons(selStr)}
    </section>`;
}

function renderWeek() {
  const start = startOfWeek(state.cursor);
  const end = addDays(start, 6);
  const map = store.groupByDate(ymd(start), ymd(end));
  const todayStr = ymd(today());
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(start, i);
    const ds = ymd(d);
    const list = map.get(ds) || [];
    const cls = ['wday', d.getDay() === 0 && 'sun', d.getDay() === 6 && 'sat', ds === todayStr && 'today'].filter(Boolean).join(' ');
    html += `
      <section class="${cls}">
        <button class="wday-head" type="button" data-goto-day="${ds}" aria-label="${formatMD(d)} 월간에서 보기">
          <span class="wd">${WEEKDAYS[d.getDay()]}</span>
          <span class="dn">${d.getDate()}</span>
        </button>
        <div class="wday-body">
          ${list.length ? renderTaskList(list) : `<button class="wday-empty" type="button" data-action="add" data-for="${ds}">+ 추가</button>`}
        </div>
      </section>`;
  }
  return `<div class="week">${html}</div>`;
}

/* ───────────────── 이동 ───────────────── */

function setView(v) {
  state.view = v;
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* 저장 실패해도 무시 */ }
  render();
  window.scrollTo(0, 0);
}

function step(dir) {
  const { view, cursor } = state;
  if (view === 'month') state.cursor = addMonths(cursor, dir);
  else if (view === 'week') state.cursor = addDays(cursor, 7 * dir);
  else state.cursor = addDays(cursor, dir);
  render();
}

$$('.seg button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
$('#todayBtn').addEventListener('click', () => { state.cursor = today(); render(); });
$('#settingsBtn').addEventListener('click', openSettingsSheet);
$('#shareBtn').addEventListener('click', openShareSheet);
$('#fab').addEventListener('click', openActionSheet);

$('#main').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-date], [data-goto-day]');
  if (!el) return;
  if (el.dataset.action === 'edit-order') {
    state.editing = isEditing() ? null : ymd(state.cursor);
    render();
    return;
  }
  // 순서 편집 중에는 카드 눌러 수정·체크하지 않음
  if (isEditing() && (el.dataset.action === 'edit' || el.dataset.action === 'toggle')) return;
  if (el.dataset.action === 'toggle') {
    const id = el.closest('[data-id]').dataset.id;
    const t = store.get(id);
    if (t) store.update(id, { done: !t.done });
  } else if (el.dataset.action === 'edit') {
    openTaskSheet(store.get(el.closest('[data-id]').dataset.id));
  } else if (el.dataset.action === 'add') {
    openTaskSheet(null, el.dataset.for, el.dataset.kind || 'event');
  } else if (el.dataset.gotoDay) {
    // 주간에서 날짜를 누르면 월간으로 가서 그 날짜를 선택
    state.cursor = parseYmd(el.dataset.gotoDay);
    setView('month');
    // 달력 마지막 줄이 상단 고정바 바로 아래(윗줄이 18px 살짝 보이게)에 오도록 스크롤
    // → 달력 한 줄 + 그 아래 날짜 목록이 함께 보여서 월간이라는 걸 알 수 있음
    const cells = $$('.grid .cell');
    const panel = $('.panel');
    if (cells.length && panel) {
      const barBottom = $('.topbar').getBoundingClientRect().bottom;
      const lastRowTop = cells[cells.length - 1].getBoundingClientRect().top + window.scrollY;
      const y = Math.max(0, lastRowTop - barBottom - 18);
      // 일정이 적어 페이지가 짧으면 그 위치까지 스크롤할 수 있도록 아래 공간을 늘림
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      if (y > maxY) panel.style.minHeight = `${panel.offsetHeight + (y - maxY)}px`;
      window.scrollTo(0, y);
    }
  } else if (el.dataset.date) {
    state.cursor = parseYmd(el.dataset.date);
    render();
  }
});

// 스와이프로 이전/다음 기간
// - 월간: 좌우로 넘기기
// - 주간: 위아래로 넘기기. 목록을 읽으며 스크롤하는 것과 겹치지 않게,
//   맨 아래에서 위로 밀면 다음 주 / 맨 위에서 아래로 당기면 지난주
let touchStart = null;
const atTop = () => window.scrollY <= 2;
const atBottom = () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
$('#main').addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY, top: atTop(), bottom: atBottom() };
}, { passive: true });
$('#main').addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  const start = touchStart;
  touchStart = null;
  if (isEditing()) return; // 편집 중에는 넘기지 않음
  if (state.view === 'week') {
    if (Math.abs(dy) < 80 || Math.abs(dx) > 60) return;
    if (dy < 0 && start.bottom) { step(1); window.scrollTo(0, 0); }
    else if (dy > 0 && start.top) { step(-1); window.scrollTo(0, 0); }
    return;
  }
  if (Math.abs(dx) > 60 && Math.abs(dy) < 50) step(dx < 0 ? 1 : -1);
}, { passive: true });

// 순서 편집: 손잡이(≡)를 잡고 위아래로 끌기 — 같은 묶음(일정/할 일) 안에서만
$('#main').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.handle');
  if (!handle) return;
  e.preventDefault();
  const li = handle.closest('.task');
  const ul = li.parentElement;
  const grab = e.clientY - li.getBoundingClientRect().top; // 카드 안에서 잡은 위치
  let offset = 0;
  li.classList.add('dragging');
  handle.setPointerCapture(e.pointerId);

  const move = (ev) => {
    const want = ev.clientY - grab; // 카드 윗변이 있어야 할 위치
    const center = want + li.offsetHeight / 2;
    const prev = li.previousElementSibling;
    const next = li.nextElementSibling;
    if (prev) {
      const r = prev.getBoundingClientRect();
      if (center < r.top + r.height / 2) ul.insertBefore(li, prev);
    }
    if (next) {
      const r = next.getBoundingClientRect();
      if (center > r.top + r.height / 2) ul.insertBefore(next, li);
    }
    const natural = li.getBoundingClientRect().top - offset; // 끌기 전 원래 자리
    offset = want - natural;
    li.style.transform = `translateY(${offset}px)`;
  };
  const end = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('pointerup', end);
    handle.removeEventListener('pointercancel', end);
    li.classList.remove('dragging');
    li.style.transform = '';
    store.reorder($$('.task', ul).map((x) => x.dataset.id));
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
});

store.subscribe(render);

/* ───────────────── 공통: 시트·토스트 ───────────────── */

const sheetRoot = $('#sheetRoot');

function openSheet(title, bodyHTML, onMount) {
  sheetRoot.innerHTML = `
    <div class="backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <span></span>
        <h3>${esc(title)}</h3>
        <button class="link-btn" type="button" data-close>닫기</button>
      </div>
      <div class="sheet-body">${bodyHTML}</div>
    </div>`;
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => sheetRoot.classList.add('open'));
  const sheet = $('.sheet', sheetRoot);
  $$('[data-close]', sheetRoot).forEach((el) => el.addEventListener('click', closeSheet));
  onMount?.(sheet);
}

function closeSheet() {
  sheetRoot.classList.remove('open');
  document.body.classList.remove('no-scroll');
  setTimeout(() => { if (!sheetRoot.classList.contains('open')) sheetRoot.innerHTML = ''; }, 260);
}

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function paletteHTML(selected) {
  return `<div class="palette" role="radiogroup" aria-label="색상">
    ${COLORS.map((c) => `<button type="button" class="swatch ${c === selected ? 'on' : ''}" data-color="${c}" style="${colorVars(c)}" role="radio" aria-checked="${c === selected}" aria-label="색상 ${c}">${CHECK_SVG}</button>`).join('')}
  </div>`;
}

function bindPalette(root, onChange) {
  $$('.palette', root).forEach((pal) => {
    pal.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      $$('.swatch', pal).forEach((s) => {
        const on = s === sw;
        s.classList.toggle('on', on);
        s.setAttribute('aria-checked', on);
      });
      onChange?.(sw.dataset.color);
    });
  });
}

const pickedColor = (root) => $('.swatch.on', root)?.dataset.color || DEFAULT_COLOR;

function timeToggleHTML(time) {
  return `
    <div class="row"><span>시간 설정</span><input type="checkbox" class="switch" data-time-on ${time ? 'checked' : ''} aria-label="시간 설정"></div>
    <div class="row" data-time-row ${time ? '' : 'hidden'}><span>시간</span><input type="time" data-time value="${time || '09:00'}"></div>`;
}

function bindTimeToggle(root, onChange) {
  const sw = $('[data-time-on]', root);
  const row = $('[data-time-row]', root);
  sw.addEventListener('change', () => { row.hidden = !sw.checked; onChange?.(); });
}

const pickedTime = (root) => ($('[data-time-on]', root).checked ? $('[data-time]', root).value || null : null);

/* ───────────────── + 버튼: 무엇을 추가할지 ───────────────── */

function openActionSheet() {
  openSheet('추가하기', `
    <div class="action-list">
      <button type="button" data-act="import">
        <span class="action-icon">📋</span>
        <span class="action-text"><strong>사진·텍스트로 가져오기</strong><small>스케줄 사진이나 복사한 글을 날짜별로 정리</small></span>
      </button>
      <button type="button" data-act="event">
        <span class="action-icon">📅</span>
        <span class="action-text"><strong>일정 추가</strong><small>캘린더에 보여주기만 하는 일정</small></span>
      </button>
      <button type="button" data-act="todo">
        <span class="action-icon">✅</span>
        <span class="action-text"><strong>할 일 추가</strong><small>완료 체크를 할 수 있는 할 일</small></span>
      </button>
      <button type="button" data-act="bulk">
        <span class="action-icon">🔁</span>
        <span class="action-text"><strong>반복 일정 등록하기</strong><small>예: 월·화 미술학원, 수·목·금 디자인 외주 1년치</small></span>
      </button>
    </div>`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'event' || b.dataset.act === 'todo') openTaskSheet(null, ymd(state.cursor), b.dataset.act);
      if (b.dataset.act === 'bulk') openBulkSheet();
      if (b.dataset.act === 'import') openImportSheet();
    });
  });
}

/* ───────────────── 할 일 추가/수정 ───────────────── */

function kindSegHTML(kind) {
  return `<div class="kind-seg" role="radiogroup" aria-label="종류">
    ${['event', 'todo'].map((k) => `<button type="button" data-kind="${k}" class="${k === kind ? 'on' : ''}" role="radio" aria-checked="${k === kind}">${KIND_LABEL[k]}</button>`).join('')}
  </div>`;
}

function bindKindSeg(root, onChange) {
  const seg = $('.kind-seg', root);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    $$('[data-kind]', seg).forEach((x) => {
      x.classList.toggle('on', x === b);
      x.setAttribute('aria-checked', x === b);
    });
    onChange?.(b.dataset.kind);
  });
}

const pickedKind = (root) => $('.kind-seg .on', root)?.dataset.kind || 'event';

const PLACEHOLDER = { event: '일정 이름을 입력하세요', todo: '할 일을 입력하세요' };

function openTaskSheet(task, dateStr, kind = 'event') {
  const editing = !!task;
  const t = task || { kind, title: '', date: dateStr || ymd(state.cursor), color: DEFAULT_COLOR, time: null, note: '' };
  const seriesCount = editing && t.seriesId ? store.countSeries(t.seriesId, t.date) : 0;
  const sheetTitle = (k) => `${KIND_LABEL[k]} ${editing ? '수정' : '추가'}`;

  openSheet(sheetTitle(t.kind), `
    <form id="taskForm" autocomplete="off">
      ${kindSegHTML(t.kind)}
      <input class="field big" name="title" placeholder="${PLACEHOLDER[t.kind]}" value="${esc(t.title)}" required>
      <div class="row" style="margin-top:6px"><span>날짜</span><input type="date" name="date" value="${t.date}" required></div>
      ${timeToggleHTML(t.time)}
      <p class="field-label">색상</p>
      ${paletteHTML(t.color)}
      <p class="field-label">메모</p>
      <textarea class="field" name="note" rows="3" placeholder="메모 (선택)">${esc(t.note || '')}</textarea>
      <button class="btn primary" type="submit">${editing ? '저장' : '추가'}</button>
      ${editing ? '<button class="btn danger" type="button" data-act="delete">삭제</button>' : ''}
      ${seriesCount > 1 ? `<button class="btn soft" type="button" data-act="delete-series">이후 반복 일정 모두 삭제 (${seriesCount}개)</button>` : ''}
    </form>`, (sheet) => {
    const form = $('#taskForm', sheet);
    bindPalette(sheet);
    bindTimeToggle(sheet);
    bindKindSeg(sheet, (k) => {
      $('.sheet-head h3', sheet).textContent = sheetTitle(k);
      form.title.placeholder = PLACEHOLDER[k];
    });
    if (!editing) setTimeout(() => form.title.focus(), 280);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {
        kind: pickedKind(sheet),
        title: form.title.value.trim(),
        date: form.date.value,
        color: pickedColor(sheet),
        time: pickedTime(sheet),
        note: form.note.value.trim(),
      };
      if (!data.title || !data.date) return;
      if (editing) {
        if (data.date !== t.date) data.dateUndecided = false;
        store.update(t.id, data);
        toast('저장했어요');
      } else {
        store.add(data);
        state.cursor = parseYmd(data.date);
        toast('추가했어요');
      }
      closeSheet();
      render();
    });

    $('[data-act="delete"]', sheet)?.addEventListener('click', () => {
      store.remove(t.id);
      closeSheet();
      toast('삭제했어요');
    });
    $('[data-act="delete-series"]', sheet)?.addEventListener('click', () => {
      if (!confirm(`'${t.title}' 반복 일정 중 ${t.date} 이후 ${seriesCount}개를 삭제할까요?`)) return;
      store.removeSeries(t.seriesId, t.date);
      closeSheet();
      toast(`${seriesCount}개 삭제했어요`);
    });
  });
}

/* ───────────────── 반복 일정 등록하기 ───────────────── */

const BULK_PLACEHOLDERS = ['예: 미술학원', '예: 디자인 외주', '예: 운동'];
const BULK_COLORS = ['#5B9CF2', '#7CC46A', '#F2668B', '#B57BE0', '#FF8A5B'];

function bulkRowHTML(i) {
  return `
    <div class="card" data-bulk-row>
      <div class="card-top">
        <input class="field" data-title placeholder="${BULK_PLACEHOLDERS[i % BULK_PLACEHOLDERS.length]}">
        <button class="icon-btn" type="button" data-remove-row aria-label="이 일정 빼기">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="wd-chips">
        ${WEEKDAYS.map((w, d) => `<button type="button" class="wd-chip ${d === 0 ? 'sun' : d === 6 ? 'sat' : ''}" data-wd="${d}" aria-pressed="false">${w}</button>`).join('')}
      </div>
      ${timeToggleHTML(null)}
      ${paletteHTML(BULK_COLORS[i % BULK_COLORS.length])}
    </div>`;
}

function openBulkSheet() {
  const start = ymd(today());
  const end = ymd(addDays(addYears(parseYmd(start), 1), -1));

  openSheet('반복 일정 등록하기', `
    <p class="help">요일을 고르면 기간 동안의 날짜에 한꺼번에 등록돼요. 나중에 일정 하나를 눌러 <b>이후 반복 일정 모두 삭제</b>도 할 수 있어요.</p>
    ${kindSegHTML('event')}
    <div class="row"><span>시작일</span><input type="date" id="bStart" value="${start}"></div>
    <div class="row"><span>종료일</span><input type="date" id="bEnd" value="${end}"></div>
    <div class="quick">
      <button type="button" data-months="3">3개월</button>
      <button type="button" data-months="6">6개월</button>
      <button type="button" data-months="12" class="on">1년</button>
    </div>
    <div id="bRows">${bulkRowHTML(0)}${bulkRowHTML(1)}</div>
    <button class="btn ghost" type="button" id="bAddRow">+ 일정 하나 더</button>
    <p class="summary" id="bSummary"></p>
    <button class="btn primary" type="button" id="bSave" disabled>등록하기</button>`, (sheet) => {
    const rowsEl = $('#bRows', sheet);
    const startEl = $('#bStart', sheet);
    const endEl = $('#bEnd', sheet);
    let rowCount = 2;
    bindKindSeg(sheet);

    const readRows = () => $$('[data-bulk-row]', sheet).map((row) => ({
      row,
      title: $('[data-title]', row).value.trim(),
      weekdays: $$('.wd-chip.on', row).map((c) => Number(c.dataset.wd)),
      color: pickedColor(row),
      time: pickedTime(row),
    }));

    const update = () => {
      const s = startEl.value;
      const e = endEl.value;
      const rows = readRows().filter((r) => r.title && r.weekdays.length);
      const total = rows.reduce((n, r) => n + countWeekly(r.weekdays, s, e), 0);
      const bad = !s || !e || e < s;
      $('#bSummary', sheet).innerHTML = bad
        ? '종료일이 시작일보다 빨라요'
        : rows.length
          ? rows.map((r) => `${esc(r.title)} ${r.weekdays.map((d) => WEEKDAYS[d]).join('·')}`).join(', ') + ` → 총 <b>${total}개</b>`
          : '이름을 쓰고 요일을 골라 주세요';
      $('#bSave', sheet).disabled = bad || total === 0;
      $('#bSave', sheet).textContent = total ? `${total}개 등록하기` : '등록하기';
    };

    const bindRow = (row) => {
      bindPalette(row);
      bindTimeToggle(row, update);
      $('[data-title]', row).addEventListener('input', update);
      $('.wd-chips', row).addEventListener('click', (e) => {
        const chip = e.target.closest('.wd-chip');
        if (!chip) return;
        chip.classList.toggle('on');
        chip.setAttribute('aria-pressed', chip.classList.contains('on'));
        update();
      });
      $('[data-remove-row]', row).addEventListener('click', () => { row.remove(); update(); });
    };
    $$('[data-bulk-row]', sheet).forEach(bindRow);

    $('#bAddRow', sheet).addEventListener('click', () => {
      rowsEl.insertAdjacentHTML('beforeend', bulkRowHTML(rowCount++));
      bindRow(rowsEl.lastElementChild);
      update();
    });

    $('.quick', sheet).addEventListener('click', (e) => {
      const b = e.target.closest('[data-months]');
      if (!b || !startEl.value) return;
      $$('.quick button', sheet).forEach((x) => x.classList.toggle('on', x === b));
      endEl.value = ymd(addDays(addMonths(parseYmd(startEl.value), Number(b.dataset.months)), -1));
      update();
    });
    [startEl, endEl].forEach((el) => el.addEventListener('change', () => {
      $$('.quick button', sheet).forEach((x) => x.classList.remove('on'));
      update();
    }));

    $('#bSave', sheet).addEventListener('click', () => {
      const s = startEl.value;
      const e = endEl.value;
      const kind = pickedKind(sheet);
      const items = readRows()
        .filter((r) => r.title && r.weekdays.length)
        .flatMap((r) => expandWeekly({ kind, title: r.title, weekdays: r.weekdays, start: s, end: e, color: r.color, time: r.time }));
      if (!items.length) return;
      store.add(items);
      closeSheet();
      toast(`${items.length}개 등록했어요`);
    });

    update();
  });
}

/* ───────────────── 사진·텍스트로 가져오기 ───────────────── */

const IMPORT_EXAMPLE = `11월
• 14일 (토) MMA 📍고척돔
• 19일 (목) 에터뷰 시즌2 2화
12월
• 3일 (목) 에터뷰 시즌2 3화`;

function openImportSheet() {
  openSheet('사진·텍스트로 가져오기', `
    <p class="field-label">사진으로</p>
    <p class="help">스케줄 사진을 고르면 Claude가 읽어서 날짜별로 정리해요. ${canReadPhotos() ? '' : '<b>설정에서 초대 코드를 먼저 넣어 주세요.</b>'}</p>
    <button class="btn primary" type="button" id="imPhoto">사진 고르기</button>
    <input type="file" id="imFile" accept="image/*" hidden>
    <p class="field-label im-gap">텍스트로</p>
    <p class="help">사진 앱에서 이미지 글자를 길게 눌러 <b>모두 선택 → 복사</b>한 뒤 붙여넣으세요. "11월", "14일 (토) 제목", "11/14 제목" 같은 형식을 알아봐요.</p>
    <textarea class="field" id="imText" rows="6" placeholder="${esc(IMPORT_EXAMPLE)}"></textarea>
    <button class="btn soft" type="button" id="imParse">텍스트 정리하기</button>
    <div id="imResult"></div>`, (sheet) => {
    const textEl = $('#imText', sheet);
    const fileEl = $('#imFile', sheet);
    const resultEl = $('#imResult', sheet);
    let items = [];
    let lastFile = null;
    let busy = false;

    const refreshSaveBtn = () => {
      const n = $$('.pv input[type="checkbox"]:checked', resultEl).length;
      const btn = $('#imSave', resultEl);
      if (!btn) return;
      btn.disabled = n === 0;
      btn.textContent = n ? `${n}개 저장` : '선택한 항목이 없어요';
    };

    resultEl.addEventListener('change', (e) => {
      if (e.target.matches('.pv input[type="checkbox"]')) {
        e.target.closest('.pv').classList.toggle('off', !e.target.checked);
        refreshSaveBtn();
      }
    });

    const showMessage = (html) => {
      resultEl.innerHTML = html;
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    // 찾은 항목 미리보기 (fromPhoto면 'Opus로 다시 읽기' 버튼도)
    const showPreview = (fromPhoto, usedStrong) => {
      const warnCount = items.filter((it) => it.reasons.length).length;
      resultEl.innerHTML = `
        <p class="field-label">색상 (전체)</p>
        ${paletteHTML(DEFAULT_COLOR)}
        <p class="field-label">${items.length}개를 찾았어요${warnCount ? ` · 확인 필요 ${warnCount}개` : ''}</p>
        <ul class="preview">
          ${items.map((it, i) => `
            <li class="pv ${it.reasons.length ? 'warn' : ''}" data-i="${i}">
              <input type="checkbox" checked aria-label="저장할 항목">
              <div class="pv-main">
                <div class="pv-when">
                  <input type="date" value="${it.date}" data-pv-date>
                  ${it.time ? `<input type="time" value="${it.time}" data-pv-time>` : ''}
                  ${it.kind === 'todo' ? '<span class="badge">할 일</span>' : ''}
                </div>
                <input class="field" value="${esc(it.title)}" data-pv-title>
                ${it.reasons.map((r) => `<p class="warn-text">⚠︎ ${esc(r)}</p>`).join('')}
              </div>
            </li>`).join('')}
        </ul>
        <button class="btn primary" type="button" id="imSave"></button>
        ${fromPhoto && !usedStrong ? '<button class="btn soft" type="button" id="imRetry">결과가 이상하면: 더 정확한 모델(Opus)로 다시 읽기</button>' : ''}`;
      bindPalette(resultEl);
      refreshSaveBtn();
      resultEl.querySelector('.field-label').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('#imRetry', resultEl)?.addEventListener('click', () => readPhoto(lastFile, true));

      $('#imSave', resultEl).addEventListener('click', () => {
        const color = pickedColor(resultEl);
        const toSave = $$('.pv', resultEl)
          .filter((li) => $('input[type="checkbox"]', li).checked)
          .map((li) => {
            const it = items[Number(li.dataset.i)];
            const date = $('[data-pv-date]', li).value;
            const timeEl = $('[data-pv-time]', li);
            return {
              kind: it.kind === 'todo' ? 'todo' : 'event', // [할일] 표시가 있던 항목만 할 일
              title: $('[data-pv-title]', li).value.trim(),
              date,
              time: timeEl && timeEl.value ? timeEl.value : null,
              color,
              dateUndecided: it.dateUndecided && date === it.date,
            };
          })
          .filter((t) => t.title && t.date);
        if (!toSave.length) return;
        store.add(toSave);
        state.cursor = parseYmd(toSave[0].date);
        closeSheet();
        render();
        toast(`${toSave.length}개 저장했어요`);
      });
    };

    const readPhoto = async (file, strong = false) => {
      if (!file || busy) return;
      busy = true;
      lastFile = file;
      showMessage(`<div class="im-loading"><span class="spinner"></span>${strong ? 'Opus로 다시 읽는 중… (조금 더 걸려요)' : '사진을 읽는 중…'}</div>`);
      try {
        items = await readScheduleImage(file, { strong });
        if (!items.length) {
          showMessage(`<p class="empty">사진에서 일정을 찾지 못했어요.</p>${strong ? '' : '<button class="btn soft" type="button" id="imRetry">더 정확한 모델(Opus)로 다시 읽기</button>'}`);
          $('#imRetry', resultEl)?.addEventListener('click', () => readPhoto(lastFile, true));
        } else {
          showPreview(true, strong);
        }
      } catch (err) {
        showMessage(`<p class="empty im-error">${esc(err.message)}</p>`);
      } finally {
        busy = false;
      }
    };

    $('#imPhoto', sheet).addEventListener('click', () => {
      if (!canReadPhotos()) {
        toast('설정에서 초대 코드를 먼저 넣어 주세요');
        return;
      }
      fileEl.click();
    });
    fileEl.addEventListener('change', () => {
      const f = fileEl.files[0];
      fileEl.value = '';
      readPhoto(f);
    });

    $('#imParse', sheet).addEventListener('click', () => {
      items = parseScheduleText(textEl.value).map((it) => ({ time: null, ...it }));
      if (!items.length) {
        showMessage('<p class="empty">날짜를 찾지 못했어요. "11월", "14일 (토) 제목" 같은 형식인지 확인해 주세요.</p>');
        return;
      }
      showPreview(false);
    });
  });
}

/* ───────────────── 이번 달 일정 공유 (텍스트) ───────────────── */

// 받은 사람이 '사진·텍스트로 가져오기'에 그대로 붙여넣을 수 있는 형식
const TODO_TAG = '[할일]';

// 공유 범위: 월간이면 이번 달, 주간이면 이번 주
function shareRange() {
  const c = state.cursor;
  if (state.view === 'week') {
    const start = startOfWeek(c);
    const end = addDays(start, 6);
    const endLabel = start.getMonth() === end.getMonth() ? `${end.getDate()}일` : `${end.getMonth() + 1}월 ${end.getDate()}일`;
    const label = `${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${endLabel}`;
    return { week: true, start, end, label, title: `${label} 일정 공유`, header: `📅 ${label} 주간 일정`, unit: '이번 주' };
  }
  const y = c.getFullYear();
  const m = c.getMonth();
  return {
    week: false,
    start: new Date(y, m, 1),
    end: new Date(y, m, daysInMonth(y, m)),
    title: `${formatYM(c)} 일정 공유`,
    header: `📅 ${y}년 ${m + 1}월 일정`,
    unit: '이번 달',
  };
}

// 받은 사람이 '사진·텍스트로 가져오기'에 그대로 붙여넣을 수 있는 형식
// - 월간: "• 14일 (토) ..." (머리글의 연·월을 따름)
// - 주간: 달이 바뀔 수 있어서 "• 11월 14일 (토) ..."처럼 월까지 적음
function shareText(range, { withSeries = true, withTodos = false } = {}) {
  const map = store.groupByDate(ymd(range.start), ymd(range.end));
  const dated = [];
  const undecided = new Map(); // 월 → 줄들
  let events = 0;
  let todos = 0;
  for (const [ds, list] of [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const d = parseYmd(ds);
    for (const t of list) {
      if ((isTodo(t) && !withTodos) || (!withSeries && t.seriesId)) continue;
      if (isTodo(t)) todos += 1;
      else events += 1;
      const tag = isTodo(t) ? ` ${TODO_TAG}` : '';
      if (t.dateUndecided) {
        const mo = d.getMonth() + 1;
        if (!undecided.has(mo)) undecided.set(mo, []);
        undecided.get(mo).push(`• 날짜 미정 ·${tag} ${t.title}`);
        continue;
      }
      const day = range.week ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getDate()}일`;
      dated.push(`• ${day} (${WEEKDAYS[d.getDay()]})${tag}${t.time ? ` ${t.time}` : ''} ${t.title}`);
    }
  }
  const lines = [...dated];
  for (const [mo, list] of undecided) {
    if (range.week) lines.push(`${mo}월`); // 주간: 날짜 미정 항목이 몇 월인지 알 수 있게
    lines.push(...list);
  }
  return { events, todos, text: lines.length ? `${range.header}\n${lines.join('\n')}` : '' };
}

function openShareSheet() {
  const range = shareRange();
  const all = [...store.groupByDate(ymd(range.start), ymd(range.end)).values()].flat();
  const hasSeries = all.some((t) => t.seriesId);
  const hasTodos = all.some(isTodo);
  openSheet(range.title, `
    <p class="help">${range.unit} 일정을 글로 만들어 보내요. 받은 사람도 이 앱을 쓰면 글을 복사해서 <b>사진·텍스트로 가져오기</b>에 붙여넣으면 자기 달력에 넣을 수 있어요.</p>
    ${hasSeries ? `
    <label class="row share-opt">
      <span>반복 일정 포함</span>
      <input class="switch" type="checkbox" id="shareSeries" checked>
    </label>` : ''}
    ${hasTodos ? `
    <label class="row share-opt">
      <span>할 일 포함 <small class="share-hint">${TODO_TAG} 표시</small></span>
      <input class="switch" type="checkbox" id="shareTodos">
    </label>` : ''}
    <p class="field-label" id="shareCount"></p>
    <pre class="share-preview" id="sharePreview"></pre>
    <button class="btn primary" type="button" id="shareGo">공유하기</button>
    <button class="btn soft" type="button" id="shareCopy">복사하기</button>`, (sheet) => {
    const seriesEl = $('#shareSeries', sheet);
    const todosEl = $('#shareTodos', sheet);
    let current = '';
    const update = () => {
      const { events, todos, text } = shareText(range, {
        withSeries: seriesEl ? seriesEl.checked : true,
        withTodos: todosEl ? todosEl.checked : false,
      });
      const count = events + todos;
      current = text;
      $('#shareCount', sheet).textContent = [events && `일정 ${events}개`, todos && `할 일 ${todos}개`].filter(Boolean).join(' · ');
      $('#sharePreview', sheet).textContent = count ? text : `${range.unit}에 공유할 일정이 없어요.`;
      $('#shareGo', sheet).disabled = !count;
      $('#shareCopy', sheet).disabled = !count;
    };
    seriesEl?.addEventListener('change', update);
    todosEl?.addEventListener('change', update);
    update();

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(current);
        toast('복사했어요');
      } catch {
        toast('복사하지 못했어요');
      }
    };
    $('#shareCopy', sheet).addEventListener('click', copy);
    $('#shareGo', sheet).addEventListener('click', async () => {
      if (!navigator.share) {
        copy();
        return;
      }
      try {
        await navigator.share({ text: current });
      } catch (err) {
        if (err && err.name !== 'AbortError') copy();
      }
    });
  });
}

/* ───────────────── 설정: 백업 ───────────────── */

function openSettingsSheet() {
  const hasKey = !!getApiKey();
  const invite = getInvite();
  openSheet('설정', `
    ${PROXY_URL ? `
    <p class="field-label">사진 읽기 (초대 코드)</p>
    <p class="help">앱을 알려준 사람에게 받은 초대 코드를 넣으면 사진으로 일정을 가져올 수 있어요. ${invite ? '<b>초대 코드가 저장돼 있어요.</b>' : ''}</p>
    <input class="field" id="inviteInput" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="초대 코드" value="${esc(invite)}">
    <button class="btn primary" type="button" id="inviteSave">초대 코드 저장</button>
    <details class="key-more" ${hasKey ? 'open' : ''}>
      <summary>내 Claude API 키로 쓰기</summary>` : ''}
    <p class="field-label">사진 읽기 (Claude API 키)</p>
    <p class="help">키는 이 기기에만 저장되고 백업 파일에는 들어가지 않아요. ${hasKey ? '<b>저장된 키가 있어요.</b>' : ''}</p>
    <input class="field" id="apiKeyInput" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${hasKey ? '새 키로 바꾸려면 붙여넣기' : 'sk-ant-로 시작하는 키 붙여넣기'}">
    <button class="btn primary" type="button" id="apiKeySave">키 저장</button>
    ${hasKey ? '<button class="btn danger" type="button" id="apiKeyDelete">저장된 키 지우기</button>' : ''}
    ${PROXY_URL ? '</details>' : ''}
    <p class="field-label im-gap">테마색</p>
    <div class="theme-row">
      <label class="theme-pick">
        <input type="color" id="themeInput" value="${readTheme()}">
        <span>색 고르기</span>
      </label>
      <button class="btn soft theme-reset" type="button" id="themeReset">기본색으로</button>
    </div>
    <p class="field-label im-gap">회색</p>
    <div class="kind-seg gray-seg" role="radiogroup" aria-label="회색">
      ${Object.entries(GRAYS).map(([g, label]) => `<button type="button" data-gray="${g}" class="${g === readGray() ? 'on' : ''}" role="radio" aria-checked="${g === readGray()}">${label}</button>`).join('')}
    </div>
    <p class="field-label im-gap">백업</p>
    <p class="help">할 일은 이 기기의 브라우저에만 저장돼요. 가끔 백업 파일을 내보내 두면 앱을 옮기거나 데이터가 지워졌을 때 되살릴 수 있어요.</p>
    <button class="btn primary" type="button" id="exportBtn">백업 파일 내보내기</button>
    <button class="btn soft" type="button" id="importBtn">백업 파일 불러오기</button>
    <input type="file" id="importFile" accept="application/json,.json" hidden>`, (sheet) => {
    $('.gray-seg', sheet).addEventListener('click', (e) => {
      const b = e.target.closest('[data-gray]');
      if (!b) return;
      const g = b.dataset.gray;
      applyGray(g);
      try {
        if (g === 'warm') localStorage.removeItem(GRAY_KEY);
        else localStorage.setItem(GRAY_KEY, g);
      } catch { /* 저장 실패는 무시 */ }
      $$('.gray-seg button', sheet).forEach((x) => {
        x.classList.toggle('on', x === b);
        x.setAttribute('aria-checked', x === b);
      });
    });
    const themeEl = $('#themeInput', sheet);
    themeEl.addEventListener('input', () => applyTheme(themeEl.value)); // 고르는 동안 바로 보기
    themeEl.addEventListener('change', () => { applyTheme(themeEl.value); saveTheme(themeEl.value); });
    $('#themeReset', sheet).addEventListener('click', () => {
      themeEl.value = DEFAULT_THEME.toLowerCase();
      applyTheme(DEFAULT_THEME);
      saveTheme(DEFAULT_THEME);
      toast('기본색으로 바꿨어요');
    });
    $('#inviteSave', sheet)?.addEventListener('click', () => {
      const v = $('#inviteInput', sheet).value.trim();
      setInvite(v);
      closeSheet();
      toast(v ? '초대 코드를 저장했어요' : '초대 코드를 지웠어요');
    });
    $('#apiKeySave', sheet).addEventListener('click', () => {
      const v = $('#apiKeyInput', sheet).value.trim();
      if (!v.startsWith('sk-ant-')) {
        toast('sk-ant-로 시작하는 키를 넣어 주세요');
        return;
      }
      setApiKey(v);
      closeSheet();
      toast('API 키를 저장했어요');
    });
    $('#apiKeyDelete', sheet)?.addEventListener('click', () => {
      if (!confirm('저장된 API 키를 지울까요?')) return;
      setApiKey('');
      closeSheet();
      toast('API 키를 지웠어요');
    });

    $('#exportBtn', sheet).addEventListener('click', async () => {
      const name = `haru-backup-${ymd(today())}.json`;
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const file = new File([blob], name, { type: 'application/json' });
      try {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });

    const fileEl = $('#importFile', sheet);
    $('#importBtn', sheet).addEventListener('click', () => fileEl.click());
    fileEl.addEventListener('change', async () => {
      const f = fileEl.files[0];
      if (!f) return;
      try {
        const n = store.importJSON(await f.text());
        closeSheet();
        toast(n ? `${n}개 불러왔어요` : '새로 불러올 항목이 없어요');
      } catch (err) {
        toast(err.message || '파일을 읽지 못했어요');
      }
    });
  });
}

/* ───────────────── 시작 ───────────────── */

render();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  // 새 버전이 설치되어 이 화면을 넘겨받으면 한 번 새로고침해서 바로 새 버전으로 보여줌
  const hadController = !!navigator.serviceWorker.controller;
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    location.reload();
  });

  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      // 홈 화면 앱은 닫아도 백그라운드에 남아 있을 때가 많아서, 다시 볼 때마다 업데이트 확인
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}
