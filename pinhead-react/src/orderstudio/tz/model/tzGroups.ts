/**
 * Группы ТЗ (К3): одно ТЗ — на позиции одной модели (или лекал клиента),
 * одной ткани, одних цветов деталей и одного дизайна (набора нанесений).
 *
 * - **Цвет позиции в ключ не входит**: «Копия в другом цвете» остаётся в своём
 *   ТЗ строкой сетки ЦВ/РАЗМ (спека, 6.1).
 * - **`tz_comment` не входит**: разный комментарий печатается по цветам.
 * - **Цвета деталей входят**: колорблок с другими деталями — другое ТЗ.
 * - Нанесения — отсортированным списком `(зона, техника, Ш, В, макет)`:
 *   порядок строк нанесений на ключ не влияет.
 *
 * Порядок групп и позиций — порядок `order.items`; номер ТЗ «k из m» —
 * по первой позиции группы. `hash8` — FNV-1a 32 ключа: синхронный, его
 * пишет имя файла PDF (`-g<hash8>`), криптостойкость не нужна.
 */
import type { SalesItem, SalesOrder, SalesPrint } from '../../model/types';

export interface TzGroup {
  key: string;
  hash8: string;
  items: SalesItem[];
  /** Номер ТЗ в заказе, с единицы («ТЗ k из m») */
  index: number;
  total: number;
}

const norm = (s: string | null | undefined): string => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

function modelPart(item: SalesItem): string {
  if (item.sku_code.trim()) return `sku:${item.sku_code.trim()}`;
  if (item.client_pattern.trim()) return `pattern:${norm(item.client_pattern)}`;
  return `type:${norm(item.product_type)}`;
}

function fabricPart(item: SalesItem): string {
  if (!item.client_fabric && item.fabric_code.trim()) return `code:${item.fabric_code.trim()}`;
  return `text:${norm(item.main_fabric)}`;
}

function partColorsPart(item: SalesItem): [string, string][] {
  return Object.entries(item.part_colors ?? {})
    .map(([part, color]): [string, string] => [norm(part), norm(color)])
    .filter(([part, color]) => part && color)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Ключ нанесения в группе: `(норм. зона, техника, Ш, В, макет)` — им же сопоставляются нанесения позиций */
export function tzPrintKey(p: SalesPrint): string {
  return JSON.stringify([norm(p.zone), p.method, p.width_mm ?? null, p.height_mm ?? null, p.artwork_path || '']);
}

function printsPart(item: SalesItem): string[] {
  return item.prints.map(tzPrintKey).sort();
}

/**
 * Нанесения позиции `item` в порядке нанесений `first` (той же группы): по ключу
 * `tzPrintKey`, а не по номеру — порядок строк у позиций группы может различаться.
 * Одинаковые ключи сопоставляются по очереди появления; нет пары — `undefined`.
 */
export function alignPrints(first: SalesItem, item: SalesItem): (SalesPrint | undefined)[] {
  const pool = new Map<string, SalesPrint[]>();
  for (const p of item.prints) {
    const k = tzPrintKey(p);
    pool.set(k, [...(pool.get(k) ?? []), p]);
  }
  return first.prints.map((p) => {
    const list = pool.get(tzPrintKey(p));
    return list && list.length > 0 ? list.shift() : undefined;
  });
}

/** Ключ группы ТЗ позиции (без цвета позиции и комментария) */
export function tzGroupKey(item: SalesItem): string {
  return JSON.stringify([modelPart(item), fabricPart(item), partColorsPart(item), printsPart(item)]);
}

/** FNV-1a 32 бита — 8 hex */
export function fnv1a8(s: string): string {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(s)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Группы ТЗ заказа по порядку позиций */
export function tzGroups(order: Pick<SalesOrder, 'items'>): TzGroup[] {
  const byKey = new Map<string, SalesItem[]>();
  for (const item of order.items) {
    const key = tzGroupKey(item);
    const list = byKey.get(key);
    if (list) list.push(item);
    else byKey.set(key, [item]);
  }
  const total = byKey.size;
  return [...byKey.entries()].map(([key, items], i) => ({ key, hash8: fnv1a8(key), items, index: i + 1, total }));
}
