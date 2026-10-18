/**
 * Пункты чек-листа о знаках вне шрифта PDF (К10): обход печатаемых полей
 * документа ТЗ группы, поле называется по-человечески, невидимые знаки —
 * словами («табуляция», «невидимый знак U+200B»). Только модель документа:
 * без раскладки и `fitText` (сторож `tzModelGuards`).
 */
import type { SalesItem } from '../../model/types';
import { charName, unsupportedChars } from './pdfGlyphs';
import { itemColors } from './tzDocument';
import type { TzDoc } from './tzDocTypes';
import type { CheckItem } from './sendChecklist';

/** «Футболка, чёрный» — модель и цвета позиции */
export function itemName(item: SalesItem): string {
  const model = item.client_pattern.trim() || item.product_type.trim() || 'Изделие';
  const colors = itemColors(item).map((c) => c.charAt(0).toLowerCase() + c.slice(1));
  return [model, ...colors].join(', ');
}

export const itemHref = (item: SalesItem) => `?tab=item&item=${encodeURIComponent(item.key)}`;

/** Названия печатаемых полей документа: путь → подпись и куда вести правку */
const FIELD_NAMES: [RegExp, string, 'client' | 'item' | null][] = [
  [/^header\.(title|bitrixId|orderNumber)$/, 'Название заказа', 'client'],
  [/^header\.manager$/, 'Менеджер', 'client'],
  [/^header\.(packaging|packagingNote|packagingSize)$/, 'Упаковка', 'item'],
  [/^header\.(stickers|stickersNote)$/, 'Стикеры', 'client'],
  [/^header\.productTitle$/, 'Вид изделия', 'item'],
  [/^header\.comments\./, 'Комментарий ТЗ', 'item'],
  [/^fabric\.(main|trim)$/, 'Ткань', 'item'],
  [/^fabric\.supplier$/, 'Поставщик', 'item'],
  [/^fabric\.(colors|grid)\./, 'Цвет', 'item'],
  [/^fabric\.modelDescription$/, 'Описание модели', 'item'],
  [/^fabric\.extraProcessing\./, 'Доп. обработки', 'item'],
  [/^fabric\.matrix\./, 'Зона нанесения', 'item'],
  [/^labels\./, 'Бирки', 'item'],
  [/^prints\.(\d+)\./, 'Нанесение', 'item'],
  [/^notes\./, 'Заметки к заказу', 'item'],
  [/^footer\.text$/, 'Подвал ТЗ в справочнике', null],
];

/** Пути, которые не печатаются текстом (пути файлов, мокап, ссылка подвала, дата) */
const NOT_PRINTED = /(Image|Path|previews|image|mockup|^footer\.link$|^header\.issuedOn$)/;

function walk(v: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof v === 'string') out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}.${i}`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (!NOT_PRINTED.test(p)) walk(x, p, out);
    }
  }
}

export function glyphItems(doc: TzDoc, first: SalesItem, ms: boolean): CheckItem[] {
  const strings: { path: string; text: string }[] = [];
  walk(doc, '', strings);
  const byField = new Map<string, { chars: string[]; target: 'client' | 'item' | null }>();
  for (const s of strings) {
    const bad = unsupportedChars(s.text);
    if (bad.length === 0) continue;
    const hit = FIELD_NAMES.find(([re]) => re.test(s.path));
    const n = /^prints\.(\d+)\./.exec(s.path);
    const name = n ? `Нанесение ${Number(n[1]) + 1}` : (hit?.[1] ?? 'Поле ТЗ');
    const cur = byField.get(name) ?? { chars: [], target: hit ? hit[2] : 'item' };
    bad.forEach((c) => { if (!cur.chars.includes(c)) cur.chars.push(c); });
    byField.set(name, cur);
  }
  return [...byField.entries()].map(([name, { chars, target }]) => {
    const list = chars.map(charName).join(', ');
    const tail = ms ? 'верните менеджеру' : (target ? 'замените их' : 'попросите руководителя поправить справочник');
    return {
      id: `glyphs:${first.key}:${name}`, ok: false, blocking: true,
      text: `${name} у «${itemName(first)}»: знаки ${list} не напечатаются в ТЗ — ${tail}`,
      href: ms || !target ? null : target === 'client' ? '?tab=client' : itemHref(first),
    };
  });
}
