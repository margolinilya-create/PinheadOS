/**
 * ЗАКУПКА ГОТОВОГО ИЗДЕЛИЯ (правка заказчика 16.09, п. 2).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Сейчас раздел закупки работает по логике материалов.
 * Если нужно закупить готовое изделие с размерной сеткой, для каждого размера
 * приходится создавать отдельную закупку… Если позиция в заказе является
 * готовым изделием, закупка должна формироваться НА ОСНОВАНИИ САМОЙ ПОЗИЦИИ
 * ЗАКАЗА, а не по логике закупки материалов… В закупке это должна быть одна
 * закупка на 100 футболок с разбивкой внутри».
 *
 * ОБЛАСТЬ ДЕЙСТВИЯ — «все готовые изделия независимо от категории: одежда,
 * головные уборы, аксессуары, сувенирная продукция». Поэтому признак берётся
 * у ТИПА ПРОИЗВОДСТВА и источника изделия (`production_type`,
 * `garment_source`), а не у категории: список категорий пришлось бы вести
 * в коде, и первая же новая («посуда») молча выпала бы из правила.
 *
 * ПОЧЕМУ ПРАВИЛО «НУЖНА ЛИ ЗАКУПКА» НЕ ПЕРЕПИСЫВАЕТСЯ ЗДЕСЬ. Оно уже есть —
 * `itemNeedsPurchase` (`utils/garmentSource`), и по нему же строится маршрут:
 * давальческое изделие и выдача со склада ГП закупки не требуют. Вторая
 * формулировка того же вопроса разошлась бы с маршрутом, и закупка появилась
 * бы у позиции, у которой этапа «Закупка» нет вовсе.
 */

import type { ErpMaterial, ErpOrderItem, SizeGridRow } from '../types';
import { itemNeedsPurchase } from './garmentSource';
import { gridRowsTotal } from './sizeGrid';

/** Позиция в объёме, достаточном для сбора закупки */
export type PurchasableItem = Pick<ErpOrderItem, 'id' | 'product_type' | 'qty'> & {
  variant?: string | null;
  production_type?: string | null;
  garment_source?: string | null;
  size_grid?: SizeGridRow[] | null;
};

/** Строка закупки описывает САМО изделие, а не материал для него */
export function isGarmentPurchase(
  material: Pick<ErpMaterial, 'kind'> | null | undefined,
): boolean {
  // Строго с новым значением, никогда отрицанием старых: у строк из кэша
  // и урезанных выборок вида может не быть вовсе
  return material?.kind === 'finished_good';
}

/**
 * Позиции заказа, по которым закупается готовое изделие.
 *
 * `ready_garment` + «закупаем мы». Пошив сюда не попадает: там изделие
 * появляется из нашего кроя, и закупается ткань, а не футболка.
 */
export function garmentPurchaseCandidates<T extends PurchasableItem>(
  items: readonly T[] | null | undefined,
): T[] {
  return (items ?? []).filter(
    (item) => item?.production_type === 'ready_garment' && itemNeedsPurchase(item),
  );
}

/** Уже заведена ли закупка изделия по этой позиции */
export function hasGarmentPurchase(
  materials: readonly Pick<ErpMaterial, 'kind' | 'item_id'>[] | null | undefined,
  itemId: string,
): boolean {
  return (materials ?? []).some((m) => isGarmentPurchase(m) && m.item_id === itemId);
}

/** Черновик строки закупки, собранный ИЗ ПОЗИЦИИ */
export interface GarmentPurchaseDraft {
  kind: 'finished_good';
  item_id: string;
  name: string;
  color: string | null;
  unit: string;
  qty_expected: number;
  size_grid: SizeGridRow[] | null;
}

/**
 * Собрать закупку из позиции заказа.
 *
 * Тираж берётся из СЕТКИ, когда она есть, и из `qty` иначе — то же правило,
 * что у `effectiveQty` в форме заказа. При сетке это число всё равно
 * пересчитает триггер `erp_material_grid_qty`: здесь оно нужно только чтобы
 * человек увидел в форме то же, что запишется.
 */
export function garmentPurchaseDraft(
  item: PurchasableItem | null | undefined,
): GarmentPurchaseDraft | null {
  if (!item?.id) return null;
  const grid = Array.isArray(item.size_grid) && item.size_grid.length > 0 ? item.size_grid : null;
  const total = grid ? gridRowsTotal(grid) : Math.max(Number(item.qty) || 0, 0);
  return {
    kind: 'finished_good',
    item_id: item.id,
    name: item.product_type || 'Готовое изделие',
    // Цвет позиции живёт в `variant` («чёрная»); у сетки с цветами он свой
    // в каждой строке, и дублировать его наверх не нужно
    color: item.variant?.trim() || null,
    unit: 'шт',
    qty_expected: total,
    size_grid: grid,
  };
}

/** Подпись строки закупки изделия человеку: «Футболка чёрная — 100 шт» */
export function garmentPurchaseLabel(
  material: Pick<ErpMaterial, 'name' | 'color' | 'qty_expected' | 'size_grid'> | null | undefined,
): string {
  const name = [material?.name, material?.color].filter(Boolean).join(' ');
  const total = gridRowsTotal(material?.size_grid) || Math.max(Number(material?.qty_expected) || 0, 0);
  return total > 0 ? `${name} — ${total} шт` : name;
}
