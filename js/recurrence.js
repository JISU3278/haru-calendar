import { addDays, parseYmd, ymd } from './dates.js';
import { uid } from './store.js';

// 요일 반복 일정을 개별 할 일로 펼칩니다. (예: 월·화 미술학원 1년치)
export function expandWeekly({ title, weekdays, start, end, color, time }) {
  if (!weekdays.length || !start || !end || end < start) return [];
  const seriesId = uid();
  const out = [];
  for (let d = parseYmd(start); ymd(d) <= end; d = addDays(d, 1)) {
    if (weekdays.includes(d.getDay())) {
      out.push({ title, date: ymd(d), color, time: time || null, seriesId });
    }
  }
  return out;
}

export function countWeekly(weekdays, start, end) {
  if (!weekdays.length || !start || !end || end < start) return 0;
  let n = 0;
  for (let d = parseYmd(start); ymd(d) <= end; d = addDays(d, 1)) {
    if (weekdays.includes(d.getDay())) n++;
  }
  return n;
}
