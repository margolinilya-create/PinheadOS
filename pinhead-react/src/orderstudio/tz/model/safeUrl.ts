/**
 * Ссылка карточки заметок ТЗ, которую можно сделать кликабельной (К4).
 *
 * Только `http:` и `https:` после разбора `new URL`; пробелы, управляющие
 * и невидимые знаки в строке — отказ (их не видно в PDF, а адрес с ними
 * ведёт не туда, куда написано). Прочее печатается текстом без ссылки.
 */

/** Невидимые разделители и знаки форматирования (пробелы — `\s`, управляющие — по коду) */
const INVISIBLE = /[\s\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/u;

function hasBadChar(s: string): boolean {
  if (INVISIBLE.test(s)) return true;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

export function isSafeHttpUrl(url: string): boolean {
  if (typeof url !== 'string' || url === '' || hasBadChar(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
}
