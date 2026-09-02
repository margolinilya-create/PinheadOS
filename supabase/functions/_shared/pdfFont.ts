/**
 * Шрифт с кириллицей для PDF, общий на все серверные функции.
 *
 * Стандартные шрифты PDF кодируют текст в WinAnsi и кириллицы не знают ВООБЩЕ:
 * drawText с русской строкой либо бросает, либо рисует мусор. Поэтому шрифт
 * встраивается в документ (DejaVu Sans), а fontkit подключается явно.
 *
 * Кэш живёт в памяти инстанса. Падение загрузки — отказ всей операции,
 * а не «сделаем без кириллицы».
 */

const FONT_URL = 'https://cdn.jsdelivr.net/npm/dejavu-fonts-ttf@2.37.3/ttf/DejaVuSans.ttf';

let fontCache: Uint8Array | null = null;

export async function loadPdfFont(): Promise<Uint8Array> {
  if (fontCache) return fontCache;
  const res = await fetch(FONT_URL);
  if (!res.ok) throw new Error(`шрифт не загрузился: ${res.status}`);
  fontCache = new Uint8Array(await res.arrayBuffer());
  return fontCache;
}
