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

export function colorVars(hex) {
  return `--c:${hex};--ct:${tint(hex)};--ink:${inkOn(hex)}`;
}
