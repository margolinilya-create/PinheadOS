/**
 * Чек-лист «Отправить в работу» (веха 6+7; T2 — целиком, T5 и T6 только показывают).
 *
 * Отдаёт только пункты-проблемы: заказ готов — пусто. Блокирующие у продавца —
 * действие со ссылкой на место правки (`?tab=item&item=…` / `?tab=client`), у МС
 * (`audience: 'ms'`) — факт «… — верните менеджеру» без ссылки.
 *
 * Сервер при отправке (миграция J, К18) проверяет `SERVER_SEND_RULES`; клиент
 * не мягче сервера: пункты с `rule` дают те же условия (паритет — тест и сторож T1).
 * PDF у позиции проверяется у МС и при `withTzPdf` (продавцу PDF собирает отправка).
 *
 * Расхождения внутри группы ТЗ вне ключа К3 (бирки, упаковка, подрядчик, эффекты…) —
 * НЕблокирующий пункт `group-diff:<hash8>` (`groupDivergence`): документ берёт их у первой позиции.
 *
 * Глифы — по полям `TzDoc` каждой группы (К10), без раскладки и `fitText`
 * (сторож `tzModelGuards`): чек-лист живёт в графе рабочего места.
 */
import type { SalesItem, SalesOrder } from '../../model/types';
import { gridQty } from '../../model/factory';
import { parseDateLocal } from '../../../utils/date';
import { glyphItems, itemHref, itemName } from './sendGlyphs';
import { groupDivergence } from './groupDiff';
import { hashFromTzPath } from './tzHash';
import { tzDocument } from './tzDocument';
import { tzGroups } from './tzGroups';
import type { TzCatalogs } from './tzDocTypes';
import { parseLayout } from '../../design/model/layoutMark';
import { flatMismatch } from '../../design/catalog/pickFlat';
import type { GarmentFlat } from '../../design/types';

export const SERVER_SEND_RULES = ['tz_pdf_path', 'artwork_path_except_other'] as const;
export type ServerSendRule = (typeof SERVER_SEND_RULES)[number];

/** Предел файла в `erp-attachments` (решение 24; 30 МБ — правка 19.10, Р9) */
export const ERP_FILE_MAX_BYTES = 30 * 1024 * 1024;

export interface CheckItem {
  id: string;
  ok: boolean;
  blocking: boolean;
  text: string;
  href: string | null;
  rule?: ServerSendRule;
}

export interface CheckCtx {
  marginPct: number | null;
  minMarginPct: number | null;
  audience?: 'seller' | 'ms';
  bridgeWarnings?: string[];
  /** Проверять PDF ТЗ у позиций (у МС — всегда) */
  withTzPdf?: boolean;
  /** Размеры файлов макетов, байт (путь → размер), если известны */
  fileSizes?: Record<string, number>;
}


type Push = (id: string, seller: string, fact: string, href: string | null, rule?: ServerSendRule) => void;

function orderChecks(order: SalesOrder, push: Push): void {
  if (!order.customer.trim()) push('client', 'Укажите клиента', 'Не указан клиент', '?tab=client');
  if (!parseDateLocal(order.due_date)) push('due', 'Укажите срок сдачи', 'Не указан срок сдачи', '?tab=client');
  if (order.items.length === 0) push('items', 'Добавьте хотя бы одно изделие', 'В заказе нет изделий', '?tab=item');
}

/**
 * Силуэт, на котором стоят раскладки позиции, — от другой модели (B1, веха 5в).
 * Судим по тому, что попадёт в ТЗ, — по `layout.flat_id` (снятые флэты тоже:
 * ТЗ рисует и их), а не по `item.flat_id`: снять нанесения с изделия — выход есть.
 * Модель неизвестна (нет в каталоге) — не судим
 */
function foreignFlat(item: SalesItem, cat: TzCatalogs): GarmentFlat | null {
  const category = item.sku_code ? cat.skuCategories?.[item.sku_code] : undefined;
  const flats = cat.garmentFlats?.flats ?? [];
  if (!category || flats.length === 0) return null;
  for (const p of item.prints) {
    const flatId = parseLayout(p.layout)?.flat_id;
    const flat = flatId ? flats.find((f) => f.id === flatId) : undefined;
    if (flat && flatMismatch(flat, item, { category })) return flat;
  }
  return null;
}

function itemChecks(order: SalesOrder, item: SalesItem, cat: TzCatalogs, ctx: CheckCtx, push: Push): void {
  const name = `«${itemName(item)}»`;
  const href = itemHref(item);
  const id = (s: string) => `${s}:${item.key}`;
  if (!item.client_pattern.trim() && !item.product_type.trim()) push(id('model'), `Выберите модель или лекала у позиции ${name}`, `У позиции ${name} не выбрана модель`, href);
  if (!item.fabric_code.trim() && !item.main_fabric.trim()) push(id('fabric'), `Выберите ткань у позиции ${name}`, `У позиции ${name} не выбрана ткань`, href);
  if (item.size_grid.rows.length === 0 || item.size_grid.rows.some((r) => !r.color.trim())) push(id('color'), `Выберите цвет у позиции ${name}`, `У позиции ${name} не выбран цвет`, href);
  if (gridQty(item.size_grid) === 0) push(id('grid'), `Заполните размерную сетку позиции ${name}`, `У позиции ${name} пустая размерная сетка`, href);
  const foreign = foreignFlat(item, cat);
  if (foreign) {
    push(id('flat'), `Нанесения позиции ${name} стоят на силуэте «${foreign.name}» — он от другой модели. Откройте «Дизайн» и перенесите их на силуэт модели`,
      `У позиции ${name} нанесения на силуэте другой модели («${foreign.name}»)`, `?tab=design&item=${item.key}`);
  }
  item.prints.forEach((p, i) => {
    if (p.method === 'other') return;
    const n = i + 1;
    if (!p.artwork_path) push(id(`artwork:${n}`), `Добавьте макет к нанесению ${n} позиции ${name}`, `У нанесения ${n} ${name} нет макета`, href, 'artwork_path_except_other');
    if (!(Number(p.width_mm) > 0 && Number(p.height_mm) > 0)) push(id(`mm:${n}`), `Укажите размер в мм у нанесения ${n} позиции ${name}`, `У нанесения ${n} ${name} нет размера в мм`, href);
    const size = p.artwork_path ? ctx.fileSizes?.[p.artwork_path] : undefined;
    if (size && size > ERP_FILE_MAX_BYTES) {
      push(id(`size:${n}`), `Файл макета нанесения ${n} ${name} больше 30 МБ — производство его не примет. Замените файл`,
        `Файл макета нанесения ${n} ${name} больше 30 МБ — производство его не примет`, href);
    }
  });
  item.labels.forEach((l, i) => {
    if (!l.blank && l.preview_paths.filter(Boolean).length === 0) {
      push(id(`label:${i + 1}`), `Добавьте превью бирки ${i + 1} позиции ${name} или отметьте её бланком`, `У бирки ${i + 1} ${name} нет превью`, href);
    }
  });
  const pdfOk = item.tz_pdf_path.startsWith(`orders/${order.id.toLowerCase()}/tz/`) && hashFromTzPath(item.tz_pdf_path) !== null;
  if ((ctx.audience === 'ms' || ctx.withTzPdf) && !pdfOk) push(id('tzpdf'), `Сформируйте ТЗ позиции ${name}`, `У позиции ${name} нет PDF ТЗ`, href, 'tz_pdf_path');
}

export function sendChecklist(order: SalesOrder, cat: TzCatalogs, ctx: CheckCtx): CheckItem[] {
  const ms = ctx.audience === 'ms';
  const out: CheckItem[] = [];
  const push: Push = (id, seller, fact, href, rule) => out.push({
    id, ok: false, blocking: true, text: ms ? `${fact} — верните менеджеру` : seller, href: ms ? null : href, ...(rule ? { rule } : {}),
  });
  orderChecks(order, push);
  order.items.forEach((item) => itemChecks(order, item, cat, ctx, push));
  for (const g of tzGroups(order)) {
    const doc = tzDocument(order, g, cat, { issuedOn: '', appOrigin: '' });
    out.push(...glyphItems(doc, g.items[0], ms));
    const diff = groupDivergence(g.items);
    if (diff.length > 0) {
      const names = g.items.map((i) => `«${itemName(i)}»`).join(', ');
      const fact = `У позиций одного ТЗ (${names}) разное: ${diff.join(', ')} — в ТЗ попадёт вариант первой позиции`;
      out.push({ id: `group-diff:${g.hash8}`, ok: false, blocking: false, href: ms ? null : itemHref(g.items[0]),
        text: ms ? `${fact} — верните менеджеру` : `${fact}. Выровняйте или вынесите позицию в отдельное изделие` });
    }
  }
  if (ctx.marginPct != null && ctx.minMarginPct != null && ctx.marginPct < ctx.minMarginPct) {
    out.push({ id: 'margin', ok: false, blocking: false, href: null,
      text: `Маржа ${Math.round(ctx.marginPct)} % ниже порога ${Math.round(ctx.minMarginPct)} %` });
  }
  (ctx.bridgeWarnings ?? []).forEach((w, i) => out.push({ id: `bridge:${i}`, ok: false, blocking: false, text: w, href: null }));
  return out;
}

/** «Футболка, чёрный» — имя позиции в пунктах (общее с экранами T5/T6) */
export { itemName };

/** Отправлять можно: нет ни одного блокирующего пункта */
export function canSend(items: readonly CheckItem[]): boolean {
  return !items.some((i) => i.blocking && !i.ok);
}
