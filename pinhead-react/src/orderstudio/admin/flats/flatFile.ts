/**
 * Выбранный администратором SVG силуэта → очищенный текст (веха 5б, К9).
 * Обёртка над `design/edit/newFlat.readFlatSvg` с текстами экрана: размер —
 * числом («Файл весит 1,4 МБ…»), отказ санитайзера — одной понятной фразой.
 */
import {
  MSG_NO_GARMENT, MSG_NO_VIEWBOX, MSG_ONLY_SVG, MSG_TOO_BIG, MSG_UTF8, readFlatSvg, type FlatSvgRead,
} from '../../design/edit/newFlat';
import { SANITIZE_FAILED_TEXT, tooBigText } from './flatEditorView';

const OWN_TEXTS = new Set([MSG_ONLY_SVG, MSG_UTF8, MSG_NO_GARMENT, MSG_NO_VIEWBOX]);

async function bytesOf(file: Blob): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Прочитать файл силуэта; отказ — текстом для экрана */
export async function readSvgFile(file: File): Promise<FlatSvgRead> {
  let bytes: Uint8Array;
  try {
    bytes = await bytesOf(file);
  } catch {
    return { ok: false, error: 'Файл не прочитался — выберите его ещё раз' };
  }
  const res = readFlatSvg(bytes, file.name);
  if (res.ok) return res;
  if (res.error === MSG_TOO_BIG) return { ok: false, error: tooBigText(bytes.length) };
  return { ok: false, error: OWN_TEXTS.has(res.error) ? res.error : SANITIZE_FAILED_TEXT };
}
