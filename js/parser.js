// 붙여넣은 스케줄 텍스트를 날짜별 할 일로 정리합니다. (API 없이 규칙으로 처리)
//
// 알아보는 형식
//   11월 / 2027년 / 27년 / 2027년 3월      → 이후 항목의 월·연도
//   14일 (토) 제목 / 11월 14일 제목         → 날짜 + 제목
//   11/14 (토) 제목 / 11.14 제목            → 날짜 + 제목
//   (날짜 없는 줄)                          → 그 달 '날짜 미정' 항목
import { daysInMonth, today as getToday, ymd } from './dates.js';

const WD = '일월화수목금토';
const BULLET = /^[\s•·●○◦▪▫■□◆◇★☆✔✓\-*–—>]+/;
const WD_PART = String.raw`(?:\s*[(\[（]\s*([일월화수목금토])\s*(?:요일)?\s*[)\]）])?`;
const DAY_RE = new RegExp(String.raw`^(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일(?![가-힣])` + WD_PART);
const SLASH_RE = new RegExp(String.raw`^(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d])\.?` + WD_PART);
const YEAR_RE = /^(\d{2}|\d{4})\s*년$/;
const MONTH_RE = /^(?:(\d{2}|\d{4})\s*년\s*)?(\d{1,2})\s*월$/;

function toYear(s) {
  const n = Number(s);
  return n < 100 ? 2000 + n : n;
}

// 연도가 안 적힌 월은 오늘 기준으로 가까운 쪽으로 추정
// (11월에 "3월"을 보면 내년 3월, 1월에 "12월"을 보면 작년 12월)
export function inferYear(month, base) {
  const cur = base.getMonth() + 1;
  let y = base.getFullYear();
  const diff = month - cur;
  if (diff < -2) y += 1;
  else if (diff > 9) y -= 1;
  return y;
}

function matchDate(s) {
  let m = s.match(SLASH_RE);
  let mon = null;
  if (m) {
    mon = Number(m[1]);
  } else {
    m = s.match(DAY_RE);
    if (!m) return null;
    mon = m[1] ? Number(m[1]) : null;
  }
  const day = Number(m[2]);
  if ((mon !== null && (mon < 1 || mon > 12)) || day < 1 || day > 31) return null;
  return { mon, day, wd: m[3] || null, rest: s.slice(m[0].length).trim() };
}

function cleanTitle(s) {
  return s.replace(/^[\s:：\-–—|]+/, '').replace(/\s+/g, ' ').trim();
}

export function parseScheduleText(text, base = getToday()) {
  let year = null;
  let month = null;
  let yearExplicit = false;
  const items = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(BULLET, '').trim();
    if (!line) continue;
    const header = line.replace(/[\s:：]+$/, '');

    let m = header.match(YEAR_RE);
    if (m) {
      year = toYear(m[1]);
      yearExplicit = true;
      month = null;
      continue;
    }
    m = header.match(MONTH_RE);
    if (m) {
      if (m[1]) {
        year = toYear(m[1]);
        yearExplicit = true;
      }
      month = Number(m[2]);
      if (!yearExplicit) year = inferYear(month, base);
      continue;
    }

    const hit = matchDate(line);
    if (hit) {
      const reasons = [];
      let mo = hit.mon ?? month;
      let yr = year;
      if (mo === null) {
        mo = base.getMonth() + 1;
        reasons.push('월이 적혀 있지 않아 이번 달로 넣었어요');
      }
      if (hit.mon !== null && !yearExplicit) yr = inferYear(mo, base);
      if (yr === null) yr = inferYear(mo, base);

      let rest = hit.rest;
      const dup = matchDate(rest);
      if (dup) {
        rest = dup.rest;
        reasons.push(`날짜가 두 번 적혀 있어요 (${dup.day}일). 첫 번째 날짜로 넣었어요`);
      }

      let day = hit.day;
      const dim = daysInMonth(yr, mo - 1);
      if (day > dim) {
        reasons.push(`${mo}월에는 ${day}일이 없어요`);
        day = dim;
      }
      const d = new Date(yr, mo - 1, day);
      if (hit.wd && WD.indexOf(hit.wd) !== d.getDay()) {
        reasons.push(`요일이 맞지 않아요 (${hit.wd}요일로 적혀 있지만 실제로는 ${WD[d.getDay()]}요일)`);
      }
      items.push({ date: ymd(d), title: cleanTitle(rest) || '(제목 없음)', dateUndecided: false, reasons });
      continue;
    }

    // 날짜 없는 줄: 월 정보가 있으면 '날짜 미정'으로
    if (month !== null) {
      items.push({
        date: ymd(new Date(year, month - 1, 1)),
        title: cleanTitle(line),
        dateUndecided: true,
        reasons: [`날짜가 없어서 ${month}월 1일에 '날짜 미정'으로 넣었어요`],
      });
    }
  }
  return items;
}
