import { COLORS, DEFAULT_COLOR, colorVars } from './colors.js';
import {
  WEEKDAYS, addDays, addMonths, addYears, daysInMonth, formatMD, formatYM,
  parseYmd, startOfWeek, today, ymd,
} from './dates.js';
import { parseScheduleText } from './parser.js';
import { countWeekly, expandWeekly } from './recurrence.js';
import { store } from './store.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VIEW_KEY = 'haru.view';
const state = {
  view: readView(),
  cursor: today(), // 선택된 날짜
};

function readView() {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return ['month', 'week', 'day'].includes(v) ? v : 'month';
  } catch {
    return 'month';
  }
}

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
  if (view === 'month') main.innerHTML = renderMonth();
  else if (view === 'week') main.innerHTML = renderWeek();
  else main.innerHTML = renderDay();
}

function renderTaskItem(t) {
  const badges = [];
  if (t.time) badges.push(`<span class="badge time">${esc(t.time)}</span>`);
  if (t.dateUndecided) badges.push('<span class="badge warn">날짜 미정</span>');
  if (t.seriesId) badges.push('<span class="badge">반복</span>');
  return `
    <li class="task ${t.done ? 'done' : ''}" data-id="${t.id}" style="${colorVars(t.color)}">
      <button class="check" type="button" data-action="toggle" aria-label="${t.done ? '완료 취소' : '완료'}">${CHECK_SVG}</button>
      <button class="task-body" type="button" data-action="edit">
        <span class="t-title">${esc(t.title)}</span>
        <span class="t-meta">${badges.join('')}</span>
        ${t.note ? `<span class="t-note">${esc(t.note)}</span>` : ''}
      </button>
    </li>`;
}

function renderTaskList(list) {
  return `<ul class="tasks">${list.map(renderTaskItem).join('')}</ul>`;
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
        ${shown.map((t) => `<span class="lbl ${t.done ? 'done' : ''}" style="${colorVars(t.color)}">${esc(t.title)}</span>`).join('')}
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
      <div class="panel-head">
        <h2>${formatMD(cursor)}</h2>
        <span class="count">${selList.length ? `${selList.filter((t) => t.done).length}/${selList.length} 완료` : ''}</span>
      </div>
      ${selList.length ? renderTaskList(selList) : '<p class="empty">할 일이 없어요</p>'}
      <button class="add-inline" type="button" data-action="add" data-for="${selStr}">+ 할 일 추가</button>
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
        <button class="wday-head" type="button" data-goto-day="${ds}" aria-label="${formatMD(d)} 일간 보기">
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

function renderDay() {
  const ds = ymd(state.cursor);
  const list = store.byDate(ds);
  const untimed = list.filter((t) => !t.time);
  const timed = list.filter((t) => t.time);
  const done = list.filter((t) => t.done).length;
  return `
    <section class="dayview">
      <div class="panel-head">
        <h2>${formatMD(state.cursor)}</h2>
        <span class="count">${list.length ? `${done}/${list.length} 완료` : ''}</span>
      </div>
      ${!list.length ? '<p class="empty">오늘은 할 일이 없어요</p>' : ''}
      ${untimed.length ? `${timed.length ? '<p class="section-label">할 일</p>' : ''}${renderTaskList(untimed)}` : ''}
      ${timed.length ? `<p class="section-label">시간 일정</p>${renderTaskList(timed)}` : ''}
      <button class="add-inline" type="button" data-action="add" data-for="${ds}">+ 할 일 추가</button>
    </section>`;
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
$('#prevBtn').addEventListener('click', () => step(-1));
$('#nextBtn').addEventListener('click', () => step(1));
$('#todayBtn').addEventListener('click', () => { state.cursor = today(); render(); });
$('#settingsBtn').addEventListener('click', openSettingsSheet);
$('#fab').addEventListener('click', openActionSheet);

$('#main').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action], [data-date], [data-goto-day]');
  if (!el) return;
  if (el.dataset.action === 'toggle') {
    const id = el.closest('[data-id]').dataset.id;
    const t = store.get(id);
    if (t) store.update(id, { done: !t.done });
  } else if (el.dataset.action === 'edit') {
    openTaskSheet(store.get(el.closest('[data-id]').dataset.id));
  } else if (el.dataset.action === 'add') {
    openTaskSheet(null, el.dataset.for);
  } else if (el.dataset.gotoDay) {
    state.cursor = parseYmd(el.dataset.gotoDay);
    setView('day');
  } else if (el.dataset.date) {
    state.cursor = parseYmd(el.dataset.date);
    render();
  }
});

// 좌우 스와이프로 이전/다음
let touchStart = null;
$('#main').addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touchStart = { x: t.clientX, y: t.clientY };
}, { passive: true });
$('#main').addEventListener('touchend', (e) => {
  if (!touchStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touchStart.x;
  const dy = t.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 50) step(dx < 0 ? 1 : -1);
}, { passive: true });

store.subscribe(render);

/* ───────────────── 공통: 시트·토스트 ───────────────── */

const sheetRoot = $('#sheetRoot');

function openSheet(title, bodyHTML, onMount) {
  sheetRoot.innerHTML = `
    <div class="backdrop" data-close></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <button class="link-btn" type="button" data-close>닫기</button>
        <h3>${esc(title)}</h3>
        <span></span>
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
      <button type="button" data-act="task">
        <span class="action-icon">✏️</span>
        <span class="action-text"><strong>할 일 추가</strong><small>날짜를 정해 하나씩 등록</small></span>
      </button>
      <button type="button" data-act="bulk">
        <span class="action-icon">🔁</span>
        <span class="action-text"><strong>반복 일정 한 번에 등록</strong><small>예: 월·화 미술학원, 수·목·금 편의점 1년치</small></span>
      </button>
      <button type="button" data-act="import">
        <span class="action-icon">📋</span>
        <span class="action-text"><strong>텍스트로 가져오기</strong><small>복사한 스케줄을 붙여넣으면 날짜별로 정리</small></span>
      </button>
    </div>`, (sheet) => {
    sheet.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'task') openTaskSheet(null, ymd(state.cursor));
      if (b.dataset.act === 'bulk') openBulkSheet();
      if (b.dataset.act === 'import') openImportSheet();
    });
  });
}

/* ───────────────── 할 일 추가/수정 ───────────────── */

function openTaskSheet(task, dateStr) {
  const editing = !!task;
  const t = task || { title: '', date: dateStr || ymd(state.cursor), color: DEFAULT_COLOR, time: null, note: '' };
  const seriesCount = editing && t.seriesId ? store.countSeries(t.seriesId, t.date) : 0;

  openSheet(editing ? '할 일 수정' : '할 일 추가', `
    <form id="taskForm" autocomplete="off">
      <input class="field big" name="title" placeholder="할 일을 입력하세요" value="${esc(t.title)}" required>
      <div class="row" style="margin-top:6px"><span>날짜</span><input type="date" name="date" value="${t.date}" required></div>
      ${timeToggleHTML(t.time)}
      <p class="field-label">색상</p>
      ${paletteHTML(t.color)}
      <p class="field-label">메모</p>
      <textarea class="field" name="note" rows="3" placeholder="메모 (선택)">${esc(t.note || '')}</textarea>
      <button class="btn primary" type="submit">${editing ? '저장' : '추가'}</button>
      ${editing ? '<button class="btn danger" type="button" data-act="delete">이 할 일 삭제</button>' : ''}
      ${seriesCount > 1 ? `<button class="btn soft" type="button" data-act="delete-series">이후 반복 일정 모두 삭제 (${seriesCount}개)</button>` : ''}
    </form>`, (sheet) => {
    const form = $('#taskForm', sheet);
    bindPalette(sheet);
    bindTimeToggle(sheet);
    if (!editing) setTimeout(() => form.title.focus(), 280);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = {
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

/* ───────────────── 반복 일정 한 번에 등록 ───────────────── */

const BULK_PLACEHOLDERS = ['예: 미술학원', '예: 편의점', '예: 운동'];
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

  openSheet('반복 일정 한 번에 등록', `
    <p class="help">요일을 고르면 기간 동안의 날짜에 한꺼번에 등록돼요. 나중에 일정 하나를 눌러 <b>이후 반복 일정 모두 삭제</b>도 할 수 있어요.</p>
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
      const items = readRows()
        .filter((r) => r.title && r.weekdays.length)
        .flatMap((r) => expandWeekly({ title: r.title, weekdays: r.weekdays, start: s, end: e, color: r.color, time: r.time }));
      if (!items.length) return;
      store.add(items);
      closeSheet();
      toast(`${items.length}개 등록했어요`);
    });

    update();
  });
}

/* ───────────────── 텍스트로 가져오기 ───────────────── */

const IMPORT_EXAMPLE = `11월
• 14일 (토) MMA 📍고척돔
• 19일 (목) 에터뷰 시즌2 2화
12월
• 3일 (목) 에터뷰 시즌2 3화`;

function openImportSheet() {
  openSheet('텍스트로 가져오기', `
    <p class="help">사진 앱에서 이미지 글자를 길게 눌러 <b>모두 선택 → 복사</b>한 뒤 붙여넣으세요. "11월", "14일 (토) 제목", "11/14 제목" 같은 형식을 알아봐요.</p>
    <textarea class="field" id="imText" rows="8" placeholder="${esc(IMPORT_EXAMPLE)}"></textarea>
    <button class="btn primary" type="button" id="imParse">정리하기</button>
    <div id="imResult"></div>`, (sheet) => {
    const textEl = $('#imText', sheet);
    const resultEl = $('#imResult', sheet);
    let items = [];

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

    $('#imParse', sheet).addEventListener('click', () => {
      items = parseScheduleText(textEl.value);
      if (!items.length) {
        resultEl.innerHTML = '<p class="empty">날짜를 찾지 못했어요. "11월", "14일 (토) 제목" 같은 형식인지 확인해 주세요.</p>';
        return;
      }
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
                <input type="date" value="${it.date}" data-pv-date>
                <input class="field" value="${esc(it.title)}" data-pv-title>
                ${it.reasons.map((r) => `<p class="warn-text">⚠︎ ${esc(r)}</p>`).join('')}
              </div>
            </li>`).join('')}
        </ul>
        <button class="btn primary" type="button" id="imSave"></button>`;
      bindPalette(resultEl);
      refreshSaveBtn();
      resultEl.querySelector('.field-label').scrollIntoView({ behavior: 'smooth', block: 'start' });

      $('#imSave', resultEl).addEventListener('click', () => {
        const color = pickedColor(resultEl);
        const toSave = $$('.pv', resultEl)
          .filter((li) => $('input[type="checkbox"]', li).checked)
          .map((li) => {
            const it = items[Number(li.dataset.i)];
            const date = $('[data-pv-date]', li).value;
            return {
              title: $('[data-pv-title]', li).value.trim(),
              date,
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
    });
  });
}

/* ───────────────── 설정: 백업 ───────────────── */

function openSettingsSheet() {
  openSheet('설정', `
    <p class="field-label">백업</p>
    <p class="help">할 일은 이 기기의 브라우저에만 저장돼요. 가끔 백업 파일을 내보내 두면 앱을 옮기거나 데이터가 지워졌을 때 되살릴 수 있어요.</p>
    <button class="btn primary" type="button" id="exportBtn">백업 파일 내보내기</button>
    <button class="btn soft" type="button" id="importBtn">백업 파일 불러오기</button>
    <input type="file" id="importFile" accept="application/json,.json" hidden>`, (sheet) => {
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
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
