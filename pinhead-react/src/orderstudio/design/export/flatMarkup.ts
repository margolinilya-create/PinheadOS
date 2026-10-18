// Разметка флэта: перекраска силуэта и data URL. Перенос DM
// `lib/export/flatMarkup.ts` без загрузки по сети (флэт читается из бакета
// флэтов (`FLATS_BUCKET`) — `api/garmentFlats.downloadFlatSvg`, задача 2) и без Buffer.
import { sanitizeHex } from '../../../utils/sanitizeHex';

/**
 * Перекрасить заливку силуэта (элемент `id="garment"`) в цвет ткани.
 * Цвет — только проверенный hex (`sanitizeHex`); пусто — без изменений.
 */
export function recolorGarment(svg: string, color: string): string {
  if (!color) return svg;
  const hex = sanitizeHex(color);
  return svg.replace(/(<[^>]*\bid="garment"[^>]*?)fill="[^"]*"/i, `$1fill="${hex}"`);
}

function utf8ToBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** SVG-строка → data URL (base64, UTF-8) */
export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
}

/** Текст data URL (base64 / percent / сырой UTF-8) */
export function decodeDataUrlText(url: string): string {
  const comma = url.indexOf(',');
  if (comma < 0) return '';
  const meta = url.slice(0, comma);
  const data = url.slice(comma + 1);
  if (/;base64/i.test(meta)) {
    const bin = atob(data);
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  try {
    return decodeURIComponent(data);
  } catch {
    return data;
  }
}
