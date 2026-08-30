import type { ErpOrderItem } from '../types';

/**
 * Отгрузка клиенту: сколько отдано, сколько осталось (правка заказчика
 * 30.08, п. 6).
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Величину «весь тираж заказа» до сих пор считали
 * прямо по месту — `items.reduce(...)` продублирован в семи файлах (склад,
 * приёмка ГП, маркировка, строка заказа, карточка на планшете, список
 * заказов, дашборд). Частичная отгрузка добавляет к нему второй ряд величин
 * (отгружено, остаток), и восьмая копия арифметики означала бы, что «осталось
 * отгрузить» на карточке и в списке однажды разойдутся — молча, потому что
 * обе «работают».
 *
 * Модуль-лист без зависимостей: его читают и склад, и гейт отгрузки.
 */

export interface ShipmentLine {
  item: ErpOrderItem;
  /** Тираж позиции */
  qty: number;
  /** Уже передано клиенту (сумма журнала, ведёт триггер) */
  shipped: number;
  /** Осталось передать; никогда не отрицательный */
  left: number;
}

export interface ShipmentTotals {
  lines: ShipmentLine[];
  qty: number;
  shipped: number;
  left: number;
  /** Отгружено всё, что заказано */
  complete: boolean;
  /** Отгружено частично: что-то отдано, но не всё */
  partial: boolean;
}

interface OrderLike {
  items?: ErpOrderItem[] | null;
}

/**
 * Остатки по заказу и по каждой позиции.
 *
 * Пустой заказ (`items: []`) НЕ считается отгруженным: `complete` требует
 * непустого тиража. Иначе заказ без позиций объявлялся бы завершённым сам
 * собой — ровно так же осторожничает `isOrderReadyToShip`.
 */
export function shipmentTotals(order: OrderLike | null | undefined): ShipmentTotals {
  const lines: ShipmentLine[] = [];
  let qty = 0;
  let shipped = 0;
  for (const item of order?.items ?? []) {
    const itemQty = item.qty ?? 0;
    // `qty_shipped` может приехать `undefined` со старого бандла или урезанной
    // выборки — читаем как ноль, а не как «отгружено неизвестно сколько»
    const itemShipped = Math.max(item.qty_shipped ?? 0, 0);
    lines.push({
      item,
      qty: itemQty,
      shipped: itemShipped,
      left: Math.max(itemQty - itemShipped, 0),
    });
    qty += itemQty;
    shipped += itemShipped;
  }
  return {
    lines,
    qty,
    shipped,
    left: Math.max(qty - shipped, 0),
    complete: qty > 0 && shipped >= qty,
    partial: shipped > 0 && !(qty > 0 && shipped >= qty),
  };
}

/** Суммарный тираж заказа — та самая величина, что жила семью копиями */
export function orderQty(order: OrderLike | null | undefined): number {
  return shipmentTotals(order).qty;
}
