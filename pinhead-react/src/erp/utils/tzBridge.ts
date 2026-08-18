/**
 * Мост «ТЗ → производственный заказ»: раскладывает заказ Order Studio
 * в черновик формы создания заказа ERP.
 *
 * ПОЧЕМУ В ФОРМУ, А НЕ СРАЗУ В БАЗУ. Кнопка «В производство» не создаёт заказ
 * молча — она открывает форму, предзаполненную из ТЗ. Причин две, и обе
 * практические:
 *
 *  1. В ТЗ ФИЗИЧЕСКИ НЕТ полей, без которых заказ не живёт: тип производства
 *     (пошив / готовое изделие / крой), нанесение на крое или на готовом, дата
 *     запуска. Угаданные молча — это заказ не по тому маршруту, и узнают об
 *     этом в цехе;
 *  2. валидация, конструктор маршрута, правило «правка человека или расчёт»
 *     (`formItemRoute`), загрузка файлов при выборе и проверка листа закупки
 *     уже написаны и покрыты тестами. Второй путь создания заказа означал бы
 *     вторую реализацию каждого из этих правил — ровно тот жанр расхождения,
 *     на котором проект уже ловился.
 *
 * Поэтому здесь — чистая функция: ни React, ни сети, ни стора. Всё, что она
 * знает о внешнем мире, приходит аргументами.
 *
 * ЧЕГО В ПРОИЗВОДСТВЕННОЙ МОДЕЛИ НЕТ ВОВСЕ (решение заказчика): цены и суммы,
 * обработки (extras), бирки и этикетки, макеты по зонам. Схема ERP под них
 * не расширяется — они уходят в ТЗ-документ и во вложения. То, что важно цеху
 * прямо в задании (бирки, комментарии дизайнера), кладётся в текстовые поля
 * позиции; остальное возвращается списком `notes`, чтобы вызывающий показал
 * человеку, что именно НЕ поехало, — молча терять данные нельзя.
 */

import { FMT_SIZES } from '../../utils/pricing';
import { EMPTY_ITEM, EMPTY_PRINT, emptyOrderForm } from './orderForm';
import type { DraftForm, DraftItem, DraftPrint, DraftPurchaseRow } from './orderForm';
import type { BrandingMethod } from '../types';

/** Заказ Order Studio в объёме, нужном мосту (полный тип — `types/order.ts`) */
export interface TzOrderLike {
  id?: string;
  order_number?: string | null;
  data?: Record<string, unknown> | null;
}

/** Каталоги для расшифровки кодов; любой может отсутствовать */
export interface BridgeCatalogs {
  /** Каталог SKU — из него берётся отделочный материал позиции (`trimCode`) */
  skuCatalog?: unknown[];
  /** Отделочные материалы: код → название */
  trimCatalog?: unknown[];
  /** Ткани: код → название */
  fabricsCatalog?: unknown[];
  /** Зоны нанесения: код → подпись */
  zonesCatalog?: unknown[];
  /** Код цвета → запись каталога цветов (в проекте — `data/colors.findColorEntry`) */
  findColor?: (code: string) => { code: string; name: string } | null;
}

export interface BridgeResult {
  form: DraftForm;
  items: DraftItem[];
  purchase: DraftPurchaseRow[];
  /** Что не поместилось в модель заказа и живёт только в ТЗ */
  notes: string[];
}

/**
 * Техника визарда → метод нанесения производства.
 *
 * `dtg` появился в производственной модели ровно ради этой таблицы (см.
 * миграцию 20260818110000): раньше его пришлось бы свести в «прочее», у которого
 * цеха нет, и позиция прошла бы маршрут вообще без этапа печати.
 */
export const TECH_TO_METHOD: Record<string, BrandingMethod> = {
  screen: 'silkscreen',
  embroidery: 'embroidery',
  dtf: 'dtf',
  dtg: 'dtg',
  flex: 'heat_transfer',
};

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function record(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function list(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
}

/**
 * Название по коду; каталога нет или код в нём не найден — остаётся сам код.
 *
 * Ключ ищется и в `code`, и в `id`, потому что каталоги проекта адресуются
 * ПО-РАЗНОМУ: у тканей, отделки и SKU это `code`, а у зон нанесения
 * (`ZoneDefinition`) — `id`. Проверка только по `code` молча оставляла бы
 * в нанесении «front» вместо «Грудь»: ошибки нет, а цех читает код.
 */
function nameByCode(catalog: unknown[] | undefined, code: string): string {
  if (!code) return '';
  const found = list(catalog).find((r) => str(r.code) === code || str(r.id) === code);
  return str(found?.name) || code;
}

/** Дата в формате `YYYY-MM-DD`; всё остальное читается как «срок не задан» */
function isoDateOrEmpty(v: unknown): string {
  const s = str(v);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
}

/** Параметры зоны по её технике — в визарде они разложены по разным картам */
function zoneParams(item: Record<string, unknown>, tech: string, zone: string): Record<string, unknown> {
  const byTech: Record<string, string> = {
    screen: 'zonePrints',
    flex: 'flexZones',
    dtg: 'dtgZones',
    embroidery: 'embZones',
    dtf: 'dtfZones',
  };
  const key = byTech[tech];
  return key ? record(record(item[key])[zone]) : {};
}

/**
 * Нанесение зоны → строка `erp_item_prints`.
 *
 * Размер в ТЗ выбирается ФОРМАТОМ (A4/A3/A3+/Max), а производство хранит
 * миллиметры. Перевод — общая таблица `FMT_SIZES` из расчёта цен, а не своя
 * копия. «Max» размера в миллиметрах не имеет вовсе: это «во всю доступную
 * площадь», и придуманное число цех принял бы за указание — поэтому поля
 * остаются пустыми, а формат уходит в комментарий, где его прочитает человек.
 */
function printFromZone(
  item: Record<string, unknown>,
  zone: string,
  tech: string,
  catalogs: BridgeCatalogs,
): DraftPrint {
  const params = zoneParams(item, tech, zone);
  const format = str(params.size) || str(params.fmt);
  const mm = FMT_SIZES[format];

  const comment: string[] = [];
  if (format && !mm) comment.push(`формат ${format}`);
  if (params.colors !== undefined && str(String(params.colors))) comment.push(`цветов: ${params.colors}`);
  if (params.area !== undefined && str(String(params.area))) comment.push(`площадь: ${params.area}`);
  if (str(params.textile)) comment.push(`ткань: ${str(params.textile) === 'white' ? 'светлая' : 'цветная'}`);
  if (str(params.fx) && str(params.fx) !== 'none') comment.push(`эффект: ${str(params.fx)}`);

  return {
    ...EMPTY_PRINT,
    method: TECH_TO_METHOD[tech] ?? 'other',
    zone: nameByCode(catalogs.zonesCatalog, zone) || zone,
    width_mm: mm ? mm.w : '',
    height_mm: mm ? mm.h : '',
    comment: comment.join(' · '),
  };
}

/** Размерная сетка ТЗ → сетка формы: одна строка на позицию, размеры с qty > 0 */
function sizeGrid(item: Record<string, unknown>, colorName: string): DraftItem['size_grid'] {
  const sizes = record(item.sizes);
  const custom = list(item.customSizes);

  const pairs: Array<[string, number]> = [];
  for (const [size, qty] of Object.entries(sizes)) {
    if (num(qty) > 0) pairs.push([size, num(qty)]);
  }
  for (const row of custom) {
    const label = str(row.label);
    const qty = Number(row.qty);
    if (label && Number.isFinite(qty) && qty > 0) pairs.push([label, qty]);
  }
  if (pairs.length === 0) return null;

  return {
    sizes: pairs.map(([size]) => size),
    rows: [{ color: colorName || '—', sizes: Object.fromEntries(pairs) }],
  };
}

/** Бирки и этикетки ТЗ — текстом в поле позиции: это читает цех в задании */
function labelsNote(item: Record<string, unknown>): string {
  const cfg = record(item.labelConfig);
  const out: string[] = [];

  const care = record(cfg.careLabel);
  if (care.enabled === true) {
    const parts = ['состав' + (str(care.composition) ? `: ${str(care.composition)}` : '')];
    if (str(care.country)) parts.push(`страна: ${str(care.country)}`);
    if (str(care.logoOption)) parts.push(`лого: ${str(care.logoOption)}`);
    if (str(care.comments)) parts.push(str(care.comments));
    out.push(`Составник — ${parts.join(', ')}`);
  }

  const main = record(cfg.mainLabel);
  if (str(main.option) && str(main.option) !== 'none') {
    const parts = [str(main.option)];
    if (str(main.placement)) parts.push(`место: ${str(main.placement)}`);
    if (str(main.material)) parts.push(`материал: ${str(main.material)}`);
    if (str(main.color)) parts.push(`цвет: ${str(main.color)}`);
    if (str(main.comments)) parts.push(str(main.comments));
    out.push(`Основная бирка — ${parts.join(', ')}`);
  }

  const tag = record(cfg.hangTag);
  if (str(tag.option) && str(tag.option) !== 'none') {
    out.push(`Хэнгтег — ${[str(tag.option), str(tag.comments)].filter(Boolean).join(', ')}`);
  }

  return out.join('\n');
}

/** Позиция ТЗ → позиция производственного заказа */
function itemFromTz(
  raw: Record<string, unknown>,
  catalogs: BridgeCatalogs,
  notes: string[],
  index: number,
): DraftItem {
  const sku = record(raw.sku);
  const colorCode = str(raw.color);
  const colorName = colorCode
    ? (catalogs.findColor?.(colorCode)?.name ?? colorCode)
    : '';

  const zones = Array.isArray(raw.zones) ? raw.zones.filter((z): z is string => typeof z === 'string') : [];
  const techs = record(raw.zoneTechs);
  const noPrint = raw.noPrint === true;

  const prints = noPrint ? [] : zones.map((zone) => {
    const tech = str(techs[zone]) || str(raw.tech);
    if (tech && !TECH_TO_METHOD[tech]) {
      notes.push(`Позиция ${index + 1}: техника «${tech}» неизвестна производству — нанесение помечено «Прочее»`);
    }
    return printFromZone(raw, zone, tech, catalogs);
  });

  // Крой: у SKU он уже проставлен, у позиции — выбран человеком
  const fit = str(raw.fit) || str(sku.fit);

  const itemNotes: string[] = [];
  if (str(raw.designNotes)) itemNotes.push(str(raw.designNotes));
  if (str(raw.sizeComment)) itemNotes.push(`Размеры: ${str(raw.sizeComment)}`);
  const extras = Array.isArray(raw.extras) ? raw.extras.filter((e) => typeof e === 'string') : [];
  if (extras.length > 0) itemNotes.push(`Обработки из ТЗ: ${extras.join(', ')}`);

  return {
    ...EMPTY_ITEM,
    product_type: str(sku.name) || str(raw.type),
    variant: colorName,
    fit,
    qty: '',
    trim_material: nameByCode(catalogs.trimCatalog, str(sku.trimCode)),
    labels_note: labelsNote(raw),
    notes: itemNotes.join('\n'),
    prints,
    size_grid: sizeGrid(raw, colorName),
    // `has_branding` включает блок нанесений и их валидацию
    has_branding: prints.length > 0,
  };
}

/** Строки листа закупки: ткань и отделка позиции — их уже знает ТЗ */
function purchaseRows(items: Array<Record<string, unknown>>, catalogs: BridgeCatalogs): DraftPurchaseRow[] {
  const rows: DraftPurchaseRow[] = [];
  items.forEach((raw, index) => {
    const sku = record(raw.sku);
    const colorCode = str(raw.color);
    const colorName = colorCode ? (catalogs.findColor?.(colorCode)?.name ?? colorCode) : '';

    const fabric = nameByCode(catalogs.fabricsCatalog, str(raw.fabric));
    if (fabric) {
      rows.push({
        key: `tz-fabric-${index}`,
        item_index: index,
        kind: 'fabric',
        role: 'main',
        name: fabric,
        color: colorName,
        // Количество менеджер считает сам: расход на изделие живёт в каталоге,
        // но зависит от размеров и раскладки, и подставленное число здесь
        // выглядело бы расчётом, которым оно не является
        qty_expected: '',
        unit: 'м',
        manager_note: 'Из ТЗ',
      });
    }

    const trim = nameByCode(catalogs.trimCatalog, str(sku.trimCode));
    if (trim) {
      rows.push({
        key: `tz-trim-${index}`,
        item_index: index,
        kind: 'fabric',
        role: 'trim',
        name: trim,
        color: colorName,
        qty_expected: '',
        unit: 'м',
        manager_note: 'Из ТЗ',
      });
    }
  });
  return rows;
}

/**
 * ТЗ → черновик формы производственного заказа.
 *
 * `today` передаётся аргументом, а не берётся из `Date`: календарная дата
 * в проекте считается только через `utils/date` (правило про UTC), и чистая
 * функция не должна знать, какой сегодня день.
 */
export function tzToOrderForm(
  order: TzOrderLike,
  catalogs: BridgeCatalogs = {},
  today = '',
): BridgeResult {
  const data = record(order.data);
  const notes: string[] = [];

  const rawItems = list(data.items);
  const items = rawItems.map((raw, i) => itemFromTz(raw, catalogs, notes, i));

  const customer = str(data.name);
  const number = str(order.order_number);
  const title = [number, customer].filter(Boolean).join(' · ') || 'Заказ из ТЗ';

  const orderNotes: string[] = [];
  if (str(data.notes)) orderNotes.push(str(data.notes));
  if (str(data.address)) orderNotes.push(`Адрес: ${str(data.address)}`);
  if (data.urgentOption === true) orderNotes.push('СРОЧНЫЙ (отмечено в ТЗ)');
  const contact = [str(data.contact), str(data.phone), str(data.email), str(data.messenger)]
    .filter(Boolean).join(', ');
  if (contact) orderNotes.push(`Контакт: ${contact}`);

  const form: DraftForm = {
    ...emptyOrderForm(today || ''),
    bitrix_id: str(data.bitrixDeal),
    title,
    customer,
    manager: str(data.managerName),
    due_date: isoDateOrEmpty(data.deadline),
    // Упаковку из ТЗ автоматически не разгадываем: `packOption` это «упаковать
    // как обычно», а вид пакета выбирает менеджер. Догадка тут хуже пустоты —
    // забытая упаковка видна, угаданная неверная нет.
    packaging: 'none',
    packaging_note: data.packOption === true ? 'ТЗ: упаковка требуется' : '',
    notes: orderNotes.join('\n'),
  };

  // Что осталось только в ТЗ — не молча, а списком для человека
  const total = num(data.total);
  if (total > 0) notes.push(`Сумма ТЗ ${total.toLocaleString('ru-RU')} ₽ в производственный заказ не переносится`);
  const hasArtworks = rawItems.some((it) => Object.keys(record(it.zoneArtworks)).length > 0);
  if (hasArtworks) notes.push('Макеты по зонам остаются в ТЗ — приложите файлы к позиции, если они нужны цеху');
  if (!form.due_date) notes.push('В ТЗ нет срока сдачи — заполните его в форме');

  return { form, items, purchase: purchaseRows(rawItems, catalogs), notes };
}
