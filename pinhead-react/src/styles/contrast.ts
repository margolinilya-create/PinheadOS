/**
 * КОНТРАСТ ПО WCAG 2.1 — арифметика, вынесенная из сторожа.
 *
 * До 12.09 `relativeLuminance` и `contrastRatio` жили внутри
 * `contrast.test.ts`. Пока читатель был один, это было нормально; теперь их
 * читает ещё и инструмент подбора тона на витрине (`styles/oklch`), и копия
 * рядом стала бы вторым определением одной формулы. Ровно тот приём, ради
 * которого в проекте появились `.testutil`-модули: парсер `columnsOf` уехал
 * из `schema.test.ts` в `types/schema.testutil.ts`, когда понадобился
 * второму сторожу.
 *
 * Почему это `.ts`, а не `.testutil.ts`: модуль нужен и продуктовому коду
 * (секция витрины), а не только тестам.
 */

/** Порог AA для обычного текста. */
export const AA_TEXT = 4.5;

/** Порог AA для крупного текста и для НЕтекстовых индикаторов (рамки, точки). */
export const AA_LARGE = 3;

/** `#abc` → `#aabbcc`; остальное возвращается как есть. */
export function expandHex(hex: string): string {
  const h = hex.trim().replace('#', '');
  return h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
}

/** `#rrggbb` → [0…255, 0…255, 0…255]. */
export function hexToRgb(hex: string): [number, number, number] {
  const full = expandHex(hex);
  if (!/^[0-9a-fA-F]{6}$/.test(full)) throw new Error(`не hex-цвет: ${hex}`);
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as [number, number, number];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.round(Math.min(Math.max(v, 0), 255))
    .toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Линеаризация канала sRGB (гамма-коррекция назад). */
export function linearize(c255: number): number {
  const s = c255 / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Обратная к `linearize`. */
export function delinearize(lin: number): number {
  const s = lin <= 0.0031308 ? lin * 12.92 : 1.055 * lin ** (1 / 2.4) - 0.055;
  return s * 255;
}

/** Относительная яркость по WCAG (0…1). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** Отношение контраста по двум ЯРКОСТЯМ. Порядок аргументов не важен. */
export function contrastFromLuminance(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Отношение контраста двух цветов (1…21). Порядок аргументов не важен:
 * ярче/темнее определяется внутри.
 */
export function contrastRatio(a: string, b: string): number {
  return contrastFromLuminance(relativeLuminance(a), relativeLuminance(b));
}

/**
 * НАСКОЛЬКО ОТНОШЕНИЕ ЧУВСТВИТЕЛЬНО К ЯРКОСТИ — производная |d(ratio)/dL|.
 *
 * Нужна, чтобы не гадать допуски. Величина НЕ единичная: против белого
 * на среднем сером она около 15, то есть расхождение яркости 0.0012
 * превращается в расхождение отношения до 0.018 — а пара, стоящая на 4.505,
 * от такого уходит под порог AA. Писать «отклонение в третьем знаке»,
 * как это сделал я в первой редакции теста OKLCH, значит утверждать неправду
 * о собственном инструменте.
 */
export function ratioSensitivity(lum: number, other: number): number {
  const [hi, lo] = lum >= other ? [lum, other] : [other, lum];
  // Меняется тот из двух, чью яркость мы подбираем: в знаменателе — он,
  // если он темнее, иначе в числителе
  return lum <= other
    ? (hi + 0.05) / (lo + 0.05) ** 2
    : 1 / (lo + 0.05);
}
