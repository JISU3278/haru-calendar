// 한국 공휴일 계산 (서버 없이, 해마다 자동)
// - 양력 공휴일: 날짜 고정
// - 음력 공휴일(설날·추석·부처님오신날): 브라우저의 한국 음력(단기력, Intl 'dangi')으로 양력 날짜를 찾음
// - 대체공휴일: '관공서의 공휴일에 관한 규정' 기준 (2023년 개정)
// - 선거일 같은 임시공휴일은 계산할 수 없어서 EXTRA에 직접 적음
import { addDays, parseYmd, ymd } from './dates.js';

const FIXED = [
  ['01-01', '신정', false],
  ['03-01', '삼일절', true],
  ['05-05', '어린이날', true],
  ['06-06', '현충일', false],
  ['08-15', '광복절', true],
  ['10-03', '개천절', true],
  ['10-09', '한글날', true],
  ['12-25', '성탄절', true],
]; // [월-일, 이름, 대체공휴일 적용]

// 임시공휴일 (정부 발표 때마다 추가)
const EXTRA = {
  '2025-01-27': '임시공휴일',
  '2025-06-03': '대통령선거',
  '2026-06-03': '지방선거',
};

let lunarFmt = null;
function lunarMD(d) {
  if (!lunarFmt) {
    try {
      lunarFmt = new Intl.DateTimeFormat('en-u-ca-dangi', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });
    } catch {
      lunarFmt = new Intl.DateTimeFormat('en-u-ca-chinese', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Seoul' });
    }
  }
  const parts = lunarFmt.formatToParts(new Date(`${ymd(d)}T12:00:00+09:00`));
  const month = parts.find((p) => p.type === 'month')?.value || '';
  const day = parts.find((p) => p.type === 'day')?.value || '';
  return { month, day: Number(day) }; // 윤달은 month가 '4bis'처럼 나옴
}

// 그 해 양력 중 음력 m월 d일 (윤달 제외)
function lunarToSolar(year, m, d, searchFrom, searchTo) {
  for (let dt = new Date(year, searchFrom[0], searchFrom[1]); dt <= new Date(year, searchTo[0], searchTo[1]); dt = addDays(dt, 1)) {
    const l = lunarMD(dt);
    if (l.month === String(m) && l.day === d) return dt;
  }
  return null;
}

const cache = new Map();

// year → Map('YYYY-MM-DD' → 이름)
export function holidaysOfYear(year) {
  if (cache.has(year)) return cache.get(year);
  const map = new Map();
  const add = (d, name) => { const k = ymd(d); map.set(k, map.has(k) ? `${map.get(k)} · ${name}` : name); };

  for (const [md, name] of FIXED) add(parseYmd(`${year}-${md}`), name);
  for (const [k, name] of Object.entries(EXTRA)) if (k.startsWith(`${year}-`)) add(parseYmd(k), name);

  let seol = null;
  let chuseok = null;
  let buddha = null;
  try {
    seol = lunarToSolar(year, 1, 1, [0, 15], [1, 25]);
    buddha = lunarToSolar(year, 4, 8, [3, 15], [5, 15]);
    chuseok = lunarToSolar(year, 8, 15, [8, 1], [9, 15]);
  } catch { /* 음력 계산을 못 하는 브라우저면 음력 공휴일은 생략 */ }

  const periods = []; // 설날·추석 연휴 (대체공휴일 규칙이 다름)
  for (const [center, name] of [[seol, '설날'], [chuseok, '추석']]) {
    if (!center) continue;
    const days = [addDays(center, -1), center, addDays(center, 1)];
    days.forEach((d, i) => add(d, i === 1 ? name : `${name} 연휴`));
    periods.push(days);
  }
  if (buddha) add(buddha, '부처님오신날');

  // ── 대체공휴일 ──
  const isHoliday = (d) => map.has(ymd(d));
  const nextWorkday = (d) => {
    let n = addDays(d, 1);
    while (n.getDay() === 0 || n.getDay() === 6 || isHoliday(n)) n = addDays(n, 1);
    return n;
  };
  const subs = [];
  // 설날·추석: 연휴 중 일요일이 있거나 다른 공휴일과 겹치면 → 연휴 다음 첫 평일
  for (const days of periods) {
    const overlap = days.filter((d) => d.getDay() === 0 || map.get(ymd(d)).includes('·')).length;
    let last = days[2];
    for (let i = 0; i < overlap; i++) { last = nextWorkday(last); subs.push(last); }
  }
  // 그 밖의 공휴일: 토·일이거나 다른 공휴일과 겹치면 → 다음 첫 평일
  const subTargets = [
    ...FIXED.filter(([, , s]) => s).map(([md]) => parseYmd(`${year}-${md}`)),
    ...(buddha ? [buddha] : []),
  ];
  for (const d of subTargets) {
    const name = map.get(ymd(d)) || '';
    if (d.getDay() === 0 || d.getDay() === 6 || name.includes('·')) subs.push(nextWorkday(d));
  }
  for (const d of subs) if (!isHoliday(d)) add(d, '대체공휴일');

  cache.set(year, map);
  return map;
}

// 'YYYY-MM-DD' → 공휴일 이름 (없으면 '')
export function holidayName(ds) {
  return holidaysOfYear(Number(ds.slice(0, 4))).get(ds) || '';
}
