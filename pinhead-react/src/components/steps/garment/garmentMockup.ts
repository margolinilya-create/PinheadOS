import { getGarmentSVG } from '../../../utils/mockup';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Силуэт модели для `<img src>` (веха 8, задача 6): раньше строка SVG шла
 * в DOM разметкой (`dangerouslySetInnerHTML`). Картинкой SVG не исполняет
 * ни скриптов, ни обработчиков, а вид тот же. `<img>` рисует SVG только
 * с пространством имён — у встроенных силуэтов его нет, добавляем.
 */
export function mockupSrc(type: string | null | undefined, colorCode: string): string {
  const svg = getGarmentSVG(type, colorCode);
  if (!svg) return '';
  const withNs = /^<svg[^>]*\sxmlns=/.test(svg) ? svg : svg.replace(/^<svg\b/, `<svg xmlns="${SVG_NS}"`);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNs)}`;
}
