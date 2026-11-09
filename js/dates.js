// 날짜 유틸 — 모든 날짜는 로컬 시간 기준 'YYYY-MM-DD' 문자열로 저장합니다.
export const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

export function addDays(d, n) {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

export function addMonths(d, n) {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1);
  const dim = daysInMonth(target.getFullYear(), target.getMonth());
  target.setDate(Math.min(d.getDate(), dim));
  return target;
}

export function addYears(d, n) {
  return addMonths(d, n * 12);
}

// 일요일 시작 주
export function startOfWeek(d) {
  return addDays(d, -d.getDay());
}

export function formatMD(d) {
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
}

export function formatYM(d) {
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
}
