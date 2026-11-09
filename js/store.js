// 데이터 저장소 — 앱의 모든 읽기/쓰기는 이 파일을 거칩니다.
// 나중에 Capacitor로 감쌀 때 save() 안에서 위젯용 공유 저장소(App Group)에도
// "오늘 할 일"을 함께 쓰도록 한 군데만 고치면 됩니다.
import { DEFAULT_COLOR } from './colors.js';

const KEY = 'haru.tasks.v1';
let tasks = null;
const listeners = new Set();

function load() {
  if (tasks) return tasks;
  try {
    const raw = localStorage.getItem(KEY);
    tasks = raw ? JSON.parse(raw) : [];
  } catch {
    tasks = [];
  }
  return tasks;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(tasks));
  } catch {
    alert('저장 공간이 부족해서 저장하지 못했어요. 백업 후 오래된 일정을 정리해 주세요.');
  }
  listeners.forEach((fn) => fn());
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function normalize(t) {
  return {
    id: t.id || uid(),
    kind: t.kind === 'event' ? 'event' : 'todo', // 'event' 일정(보기만) / 'todo' 할 일(체크)
    date: t.date,
    title: String(t.title || '').trim() || '(제목 없음)',
    done: !!t.done,
    color: t.color || DEFAULT_COLOR,
    time: t.time || null, // 'HH:MM' 또는 null(시간 없음)
    note: t.note || '',
    seriesId: t.seriesId || null, // 반복 일괄 등록으로 만든 묶음
    dateUndecided: !!t.dateUndecided, // "3월 중"처럼 날짜 미정
    createdAt: t.createdAt || Date.now(),
  };
}

// 일정 먼저, 그다음 할 일. 각각 시간 없는 것 먼저, 그다음 시간순
function sortTasks(a, b) {
  if (a.kind !== b.kind) return a.kind === 'event' ? -1 : 1;
  if (!a.time && b.time) return -1;
  if (a.time && !b.time) return 1;
  if (a.time && b.time && a.time !== b.time) return a.time < b.time ? -1 : 1;
  return a.createdAt - b.createdAt;
}

export const store = {
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  get(id) {
    return load().find((t) => t.id === id);
  },

  byDate(date) {
    return load().filter((t) => t.date === date).sort(sortTasks);
  },

  // start~end(포함) 사이 할 일을 날짜별로 묶어서 반환
  groupByDate(start, end) {
    const map = new Map();
    for (const t of load()) {
      if (t.date < start || t.date > end) continue;
      if (!map.has(t.date)) map.set(t.date, []);
      map.get(t.date).push(t);
    }
    for (const list of map.values()) list.sort(sortTasks);
    return map;
  },

  add(items) {
    const list = Array.isArray(items) ? items : [items];
    load().push(...list.map(normalize));
    save();
  },

  update(id, patch) {
    const t = load().find((x) => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    save();
  },

  remove(id) {
    tasks = load().filter((t) => t.id !== id);
    save();
  },

  countSeries(seriesId, fromDate) {
    return load().filter((t) => t.seriesId === seriesId && t.date >= fromDate).length;
  },

  removeSeries(seriesId, fromDate) {
    tasks = load().filter((t) => !(t.seriesId === seriesId && t.date >= fromDate));
    save();
  },

  exportJSON() {
    return JSON.stringify(
      { app: 'haru-calendar', version: 1, exportedAt: new Date().toISOString(), tasks: load() },
      null,
      2,
    );
  },

  // 기존 데이터는 유지하고, 같은 id가 없는 항목만 추가
  importJSON(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : data && data.tasks;
    if (!Array.isArray(list)) throw new Error('백업 파일 형식이 아니에요.');
    const existing = new Set(load().map((t) => t.id));
    const fresh = list
      .filter((t) => t && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && !existing.has(t.id))
      .map(normalize);
    load().push(...fresh);
    save();
    return fresh.length;
  },
};
