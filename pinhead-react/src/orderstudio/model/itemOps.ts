/**
 * Операции с позициями заказа v4 (веха 3): копия в другом цвете, разнесение
 * по цветам, название позиции и проверка «макет ещё нужен».
 *
 * Чистые функции: исходная позиция не меняется, у каждой новой позиции,
 * нанесения и бирки — свой uuid (ключ уходит в базу первичным ключом, общий
 * ключ у двух позиций дал бы отказ сохранения или молчаливую склейку).
 *
 * Решение владельца 17.10, п. 5: один цвет = одна позиция. Отсюда обе
 * операции дают позиции ровно с одной строкой сетки.
 */
import { gridQty } from './factory';
import { retextilePrints, textileOfColor, textileOfItem, type TextileCatalogs } from './garmentTextile';
import type { SalesItem, SalesLabel, SalesOrder, SalesPrint } from './types';
import type { SizeGridRow } from '../../erp/types';

const newKey = (): string => crypto.randomUUID();

/** Нанесение-копия: новый ключ, макет (`artwork_path`) тот же — общий у позиций */
function clonePrint(p: SalesPrint): SalesPrint {
  return {
    ...p,
    key: newKey(),
    sizes: [...p.sizes],
    pantone: [...p.pantone],
    effects: [...p.effects],
    layout: p.layout ? structuredClone(p.layout) : null,
  };
}

function cloneLabel(l: SalesLabel): SalesLabel {
  return { ...l, key: newKey(), preview_paths: [...l.preview_paths] };
}

/**
 * «Цвет / поставщик» (`color_supplier`, как его собирает `wizardAdapter`):
 * у копии меняется только цвет, поставщик остаётся. Пустое поле не выдумываем.
 */
function recolorSupplier(colorSupplier: string, color: string): string {
  if (!colorSupplier.trim()) return '';
  const parts = colorSupplier.split(' / ');
  return parts.length > 1 ? [color, ...parts.slice(1)].join(' / ') : color;
}

/**
 * Позиция с одной строкой сетки `row`: новые ключи всего, что ей принадлежит.
 * Подложка нанесений — вслед за цветом (обход H-2, раунд 1): умолчание цвета
 * исходной позиции меняется на умолчание нового, выбранное руками остаётся,
 * как при смене цвета в буфере (`garmentPatch`).
 */
function cloneWithRow(item: SalesItem, row: SizeGridRow, key: string, cat: TextileCatalogs): SalesItem {
  const prints = retextilePrints(
    item.prints,
    textileOfItem(item, cat),
    textileOfColor(row.color, cat, item.fabric_code),
  );
  return {
    ...item,
    key,
    size_grid: { sizes: [...item.size_grid.sizes], rows: [{ color: row.color, sizes: { ...row.sizes } }] },
    prints: prints.map(clonePrint),
    labels: item.labels.map(cloneLabel),
    extras: [...item.extras],
    part_colors: { ...item.part_colors },
    color_supplier: recolorSupplier(item.color_supplier, row.color),
    // PDF ТЗ описывает исходную позицию целиком — копии он не принадлежит
    tz_pdf_path: '',
  };
}

/**
 * Копия позиции в другом цвете: та же модель, ткань, нанесения и бирки;
 * сетка — одна строка нового цвета с теми же размерами и нулём штук.
 * Ручная цена сбрасывается: тираж другой, цена считается заново.
 * `cat` — палитры поставщиков и ткани: по ним подложка нанесений копии.
 */
export function duplicateInColor(item: SalesItem, color: string, cat: TextileCatalogs): SalesItem {
  const zero = Object.fromEntries(item.size_grid.sizes.map((s) => [s, 0]));
  return {
    ...cloneWithRow(item, { color, sizes: zero }, newKey(), cat),
    manual_unit_price: null,
  };
}

/**
 * Разнесение многоцветной позиции: одна позиция на строку сетки.
 * Первая сохраняет ключ (и свои нанесения, бирки, PDF ТЗ), остальные — копии
 * с новыми ключами (подложка — по цвету своей строки). Сумма штук не меняется.
 */
export function splitByColor(item: SalesItem, cat: TextileCatalogs): SalesItem[] {
  const rows = item.size_grid.rows;
  if (rows.length <= 1) return [item];
  const [first, ...rest] = rows;
  return [
    {
      ...item,
      size_grid: { sizes: [...item.size_grid.sizes], rows: [{ color: first.color, sizes: { ...first.sizes } }] },
      color_supplier: recolorSupplier(item.color_supplier, first.color),
    },
    ...rest.map((row) => cloneWithRow(item, row, newKey(), cat)),
  ];
}

/**
 * Нужен ли макет `path` какому-то нанесению заказа, кроме `exceptPrintKey`.
 * Пока истинно, удаление нанесения и замена макета НЕ зовут `removeArtwork`:
 * после копии в другом цвете один файл бакета принадлежит нескольким позициям.
 */
export function artworkInUse(order: SalesOrder, path: string, exceptPrintKey: string): boolean {
  if (!path) return false;
  return order.items.some((it) => it.prints.some((p) => p.key !== exceptPrintKey && p.artwork_path === path));
}

/** Цвета позиции по строкам сетки, без пустых и повторов */
function itemColors(item: SalesItem): string[] {
  const colors = item.size_grid.rows.map((r) => r.color.trim()).filter(Boolean);
  return [...new Set(colors)];
}

/** Название позиции: «Худи · Чёрный · 45 шт» / «Худи · цвет не выбран» / «Новое изделие» */
export function itemTitle(item: SalesItem): string {
  const model = item.product_type.trim();
  if (!model) return 'Новое изделие';
  const colors = itemColors(item);
  if (colors.length === 0) return `${model} · цвет не выбран`;
  return `${model} · ${colors.join(', ')} · ${gridQty(item.size_grid)} шт`;
}
