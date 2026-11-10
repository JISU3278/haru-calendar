export const COLORS = [
  '#FFCA2A', // 메인 노랑
  '#FF8A5B',
  '#F2668B',
  '#B57BE0',
  '#5B9CF2',
  '#3EBFB0',
  '#7CC46A',
  '#A68A73',
  '#9AA5B1',
];

export const DEFAULT_COLOR = COLORS[0];

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
}

// 배경용 옅은 색
export function tint(hex, alpha = 0.28) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// 색 위에 올릴 글자/체크 색 (밝은 색이면 진한 글자)
export function inkOn(hex) {
  const [r, g, b] = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#3D2F00' : '#FFFFFF';
}

// 테마색: 고른 색 하나로 버튼·강조색 4가지를 만듦
export const DEFAULT_THEME = COLORS[0];
const mix = (hex, to, amount) => {
  const t = hexToRgb(to);
  const [r, g, b] = hexToRgb(hex).map((v, i) => Math.round(v + (t[i] - v) * amount));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
export function themeVars(hex) {
  return {
    '--primary': hex,
    '--primary-strong': mix(hex, '#000000', 0.06),
    '--primary-soft': mix(hex, '#FFFFFF', 0.78),
    // 밝은 색이면 같은 색 계열의 아주 진한 글자, 어두운 색이면 흰 글자
    '--primary-ink': inkOn(hex) === '#FFFFFF' ? '#FFFFFF' : mix(hex, '#000000', 0.76),
    // 옅은 배경(--primary-soft) 위 글자: 항상 진한 색
    '--primary-soft-ink': mix(hex, '#000000', 0.7),
  };
}

export function colorVars(hex) {
  return `--c:${hex};--ct:${tint(hex)};--cl:${tint(hex, 0.08)};--ink:${inkOn(hex)}`;
}
