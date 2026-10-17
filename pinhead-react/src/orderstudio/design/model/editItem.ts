/**
 * Правки позиции заказа с вкладки «Дизайн» — чистые функции (веха 5а, задача 5).
 *
 * Холст правит у позиции ровно две вещи: нанесения (`prints` — одно нанесение
 * = одно размещение) и флэт (`flat_id`). Это же — снимок истории undo
 * (`DesignSnapshot`): откат возвращает оба поля разом, остальное в позиции
 * не трогает. Заказ не мутируется; без изменений — тот же объект (запись
 * не уходит).
 */
import type { SalesItem, SalesOrder, SalesPrint } from '../../model/types';

/** Что холст меняет у позиции — и что хранит снимок undo */
export interface DesignSnapshot {
  prints: SalesPrint[];
  flat_id: string;
}

export function itemOf(order: Pick<SalesOrder, 'items'> | null | undefined, key: string | null | undefined): SalesItem | null {
  if (!order || !key) return null;
  return order.items.find((it) => it.key === key) ?? null;
}

export function designSnapshotOf(item: Pick<SalesItem, 'prints' | 'flat_id'>): DesignSnapshot {
  return { prints: item.prints, flat_id: item.flat_id };
}

/** Нанесения и (или) флэт позиции; без изменений или нет позиции — тот же заказ */
export function setItemDesign(order: SalesOrder, key: string, patch: Partial<DesignSnapshot>): SalesOrder {
  const item = itemOf(order, key);
  if (!item) return order;
  const prints = patch.prints ?? item.prints;
  const flatId = patch.flat_id ?? item.flat_id;
  if (prints === item.prints && flatId === item.flat_id) return order;
  return {
    ...order,
    items: order.items.map((it) => (it.key === key ? { ...it, prints, flat_id: flatId } : it)),
  };
}

export function setItemPrints(order: SalesOrder, key: string, prints: SalesPrint[]): SalesOrder {
  return setItemDesign(order, key, { prints });
}

export function setItemFlat(order: SalesOrder, key: string, flatId: string): SalesOrder {
  return setItemDesign(order, key, { flat_id: flatId });
}
