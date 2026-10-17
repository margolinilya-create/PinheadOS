/**
 * Сборка SVG строкой без дыр (проверка безопасности H1): каждое число —
 * через `num()` (не конечное число — исключение, а не «NaN» в атрибуте),
 * каждая строка — через `esc`/`escAttr`, каждая картинка — только
 * `data:image/(png|svg+xml);base64,` (`safeImageHref`).
 */

/** Конечное число для атрибута; иначе — исключение (данные битые, сцену не собирать) */
export function num(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Не число в сцене: ${String(v).slice(0, 40)}`);
  return String(Math.round(v * 1000) / 1000);
}

/** Текст узла */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Значение атрибута в двойных кавычках */
export function escAttr(s: unknown): string {
  return esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const IMAGE_HREF = /^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/;

/** Картинка в сцене — только встроенный PNG/SVG в base64; иначе `null` (картинка не ставится) */
export function safeImageHref(href: unknown): string | null {
  return typeof href === 'string' && IMAGE_HREF.test(href) ? href : null;
}

/** Содержимое корневого `<svg>` (разметка флэта уже очищена `sanitizeSvg`) */
export function innerSvg(markup: string): string {
  const m = markup.match(/<svg[^>]*>([\s\S]*)<\/svg>\s*$/i);
  return m ? m[1] : '';
}
