import type { ErpItemStage, ErpOrderItem } from '../types';
import { isPassthrough, itemProducedQty } from './stageInput';

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

/** Позиция со своим маршрутом — выпущенное считается по этапам */
type ShipItem = ErpOrderItem & { stages?: ErpItemStage[] | null };

export interface ShipmentLine {
  item: ShipItem;
  /** Тираж позиции */
  qty: number;
  /** Уже передано клиенту (сумма журнала, ведёт триггер) */
  shipped: number;
  /**
   * Выпущено производством (правка 05.10, п. 1): минимум выходов терминальных
   * этапов маршрута. Предел отгрузки — «не больше фактического остатка»
   */
  produced: number;
  /** Осталось передать из выпущенного; никогда не отрицательный */
  left: number;
  /** Цель отгрузки: тираж, а при закрытом маршруте — выпущенное (не больше тиража) */
  target: number;
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
  items?: ShipItem[] | null;
}

/**
 * Остатки по заказу и по каждой позиции.
 *
 * ОСТАТОК — ОТ ВЫПУЩЕННОГО, А НЕ ОТ ТИРАЖА (правка 05.10, п. 1): «отгрузить
 * можно не больше фактического остатка». После ВТО 100 из плана 150 и
 * отгрузки 60 осталось 40. Заказ завершён, когда отгружена ЦЕЛЬ: тираж,
 * а при закрытом маршруте — выпущенное. Сервер (`erp_ship_order`) держит
 * то же правило.
 *
 * Пустой заказ (`items: []`) НЕ считается отгруженным: `complete` требует
 * непустого тиража. Иначе заказ без позиций объявлялся бы завершённым сам
 * собой — ровно так же осторожничает `isOrderReadyToShip`.
 */
export function shipmentTotals(order: OrderLike | null | undefined): ShipmentTotals {
  const lines: ShipmentLine[] = [];
  let qty = 0;
  let shipped = 0;
  let target = 0;
  let left = 0;
  for (const item of order?.items ?? []) {
    const itemQty = item.qty ?? 0;
    // `qty_shipped` может приехать `undefined` со старого бандла или урезанной
    // выборки — читаем как ноль, а не как «отгружено неизвестно сколько»
    const itemShipped = Math.max(item.qty_shipped ?? 0, 0);
    const produced = itemProducedQty({ qty: itemQty, stages: item.stages });
    const itemTarget = itemProductionClosed(item) ? Math.min(itemQty, produced) : itemQty;
    const itemLeft = Math.max(produced - itemShipped, 0);
    lines.push({
      item,
      qty: itemQty,
      shipped: itemShipped,
      produced,
      left: itemLeft,
      target: itemTarget,
    });
    qty += itemQty;
    shipped += itemShipped;
    target += itemTarget;
    left += itemLeft;
  }
  const complete = target > 0 && shipped >= target;
  return {
    lines,
    qty,
    shipped,
    left,
    complete,
    partial: shipped > 0 && !complete,
  };
}

/**
 * Производственный маршрут позиции закрыт: все этапы, выпускающие изделия,
 * закрыты или пропущены. Прозрачные (склад, закупка) не держат — зеркало
 * `erp_item_production_closed` на сервере читает `is_production` участка,
 * а прозрачность непроизводственного этапа — тот же признак в данных.
 */
export function itemProductionClosed(item: Pick<ShipItem, 'stages'>): boolean {
  return (item.stages ?? [])
    .filter((s) => (s.origin ?? 'production') === 'production' && !isPassthrough(s))
    .every((s) => s.status === 'done' || s.status === 'skipped');
}

/** Суммарный тираж заказа — та самая величина, что жила семью копиями */
export function orderQty(order: OrderLike | null | undefined): number {
  return shipmentTotals(order).qty;
}
