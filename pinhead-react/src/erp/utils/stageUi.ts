/**
 * Общие UI-хелперы этапов: цвет чипа по статусу и готовность заказа к отгрузке.
 * Единый источник для OrdersScreen / OrderCard / ProductionBoard и др.
 * Прогресс считается в штуках — см. utils/progress.ts (правка 7).
 */

import type { ErpBypass, ErpItemStage, ErpMaterial, StageStatus } from '../types';
import { isBypassed } from './bypass';
import { isMaterialPending } from './routes';

/** Статус этапа → класс чипа из erp.module.css */
export const STAGE_CHIP_CLASS: Record<StageStatus, string> = {
  waiting: 'chipWaiting',
  ready: 'chipReady',
  in_progress: 'chipProgress',
  done: 'chipDone',
  skipped: 'chipSkipped',
  blocked: 'chipBlocked',
};

/** Минимум заказа, по которому судим о готовности к отгрузке */
export interface OrderShipReadiness {
  status: string;
  items: ShipReadinessItem[];
  materials?: ErpMaterial[];
}

/** Позиция глазами гейта отгрузки: этапы + признаки «производится вне цехов» */
export interface ShipReadinessItem {
  stages: Pick<ErpItemStage, 'status'>[];
  production_type?: string | null;
  material_source?: string | null;
}

/**
 * Позиция, у которой производственного маршрута нет ПО ПРАВИЛУ, а не по ошибке.
 *
 * `BASE_CHAIN.outsource` состоит из одного `supply`, и `buildItemRoute` вырезает его,
 * когда материал даёт подрядчик, — маршрут выходит пустым, и это верно: всю работу
 * ведёт подрядчик, она живёт в `erp_subcontracting`, а не в этапах. `no_product`
 * (только нанесение) тоже может остаться без этапов, если метод нанесения не имеет
 * своего цеха (`other` — пришив внутри швейки).
 *
 * Раньше `isOrderReadyToShip` отвечал `false` на любой заказ без этапов, а склад
 * отгружает только через него — такой заказ невозможно было закрыть вообще никогда,
 * и кладовщик получал отказ без объяснимой причины.
 */
function isExternallyProduced(item: ShipReadinessItem): boolean {
  return item.production_type === 'outsource' || item.production_type === 'no_product';
}

/**
 * Материалы, из-за которых заказ нельзя отгружать.
 *
 * Правило то же, что и у гейта этапа (`isMaterialPending`): упаковка, бирки и
 * «сиротские» материалы (цех вне маршрута) не блокируют ни один этап, но
 * отгружать без них нельзя. Пришедший закупочный материал годен только после
 * приёмки складом — раньше отгрузка считала годным любой `received`, поэтому
 * заказ с недостачей/пересортом/отказом склада доходил до «готов к отгрузке».
 */
export function shipBlockingMaterials(order: OrderShipReadiness): ErpMaterial[] {
  return (order.materials ?? []).filter(isMaterialPending);
}

/**
 * Стадия «Готов к отгрузке»: заказ активен, есть хотя бы один этап, ВСЕ этапы
 * завершены (done/skipped) И все материалы приняты.
 */
export function isOrderReadyToShip(order: OrderShipReadiness): boolean {
  if (order.status !== 'active') return false;
  if (order.items.length === 0) return false;
  const stages = order.items.flatMap((it) => it.stages);
  // Пустой маршрут допустим, только если ВСЕ позиции производятся вне цехов.
  // Иначе этапов нет по ошибке (маршрут не материализовался) — отгружать нельзя.
  if (stages.length === 0 && !order.items.every(isExternallyProduced)) return false;
  if (!stages.every((s) => s.status === 'done' || s.status === 'skipped')) return false;
  return shipBlockingMaterials(order).length === 0;
}

/**
 * Человекочитаемая причина, почему заказ ещё нельзя отгрузить (null — можно).
 * Показывается в карточке заказа и в задаче склада «Упаковка/отгрузка», чтобы
 * кладовщик видел не просто отсутствие кнопки, а конкретную причину.
 */
export function shipBlockReason(order: OrderShipReadiness): string | null {
  if (order.status !== 'active') return null;
  if (order.items.length === 0) return 'В заказе нет позиций';
  const stages = order.items.flatMap((it) => it.stages);
  if (stages.length === 0 && !order.items.every(isExternallyProduced)) {
    // Причина должна подсказывать действие: пустой маршрут у производственной
    // позиции — это сбой материализации при создании, чинится диспетчером,
    // а не кладовщиком.
    return 'У позиций нет этапов маршрута — обратитесь к диспетчеру';
  }

  const open = stages.filter((s) => s.status !== 'done' && s.status !== 'skipped');
  if (open.length > 0) {
    return `Не завершены этапы: ${open.length}`;
  }

  const blocking = shipBlockingMaterials(order);
  if (blocking.length > 0) {
    const names = blocking.map((m) => m.name).join(', ');
    const awaitingAcceptance = blocking.every((m) => m.status === 'received');
    return awaitingAcceptance
      ? `Склад не принял материалы: ${names}`
      : `Не получены материалы: ${names}`;
  }
  return null;
}

/**
 * Просрочен ли ЗАКАЗ (решение заказчика 03.08.2026).
 *
 * Не просто «срок клиента в прошлом»: заказ, у которого всё сделано и который
 * ждёт только логистики, производству больше не адресован — он не «горит»,
 * а лежит на складе. Считать его просроченным значит держать в списке
 * «что горит» работы, которой нет: на 03.08.2026 так набиралось 47 позиций
 * из 76, и метрика перестала на что-либо отвечать.
 *
 * `daysLeft` приходит параметром, а не считается здесь: у вызывающих он уже
 * есть, а модуль не должен зависеть от «сегодня».
 */
export function isOrderOverdue(
  order: OrderShipReadiness,
  daysLeftValue: number | null,
): boolean {
  if (daysLeftValue === null || daysLeftValue >= 0) return false;
  return !isOrderReadyToShip(order);
}

/** На сколько дней просрочен заказ; 0 — не просрочен (в т.ч. если готов к отгрузке) */
export function orderOverdueDays(
  order: OrderShipReadiness,
  daysLeftValue: number | null,
): number {
  return isOrderOverdue(order, daysLeftValue) ? -(daysLeftValue as number) : 0;
}

/**
 * Гейт отгрузки С УЧЁТОМ аварийного снятия — то, что должна спрашивать кнопка.
 *
 * `ordersSlice.shipOrder` снятие учитывает (`isBypassed('ship_gate', …)`),
 * а все три кнопки отгрузки — `warehouse/PackShipCard`, `orders/OrderRow`,
 * `orders/OrderCardMobile` — звали голый `isOrderReadyToShip`. Директор снимал
 * проверку в админке, с обязательной причиной, запись уходила в `erp_bypasses` —
 * и не менялось ничего: кнопка оставалась `disabled`, рядом висело «Не все
 * этапы/материалы готовы». Снятие, которое ничего не снимает, хуже отсутствия
 * снятия: человек считает, что действие разрешил, и ждёт результата.
 *
 * Расчёт держим здесь, а не в компонентах: девять мест применения гейтов —
 * ровно та причина, по которой `utils/bypass` вообще заведён отдельным модулем.
 *
 * ВАЖНО: это гейт ДЕЙСТВИЯ. Расчёт просрочки (`isOrderOverdue`) снятие
 * не спрашивает намеренно — иначе снятие задним числом объявляло бы
 * просроченный заказ непросроченным.
 */
export function canShipOrder(
  order: OrderShipReadiness & { id: string },
  bypasses: ErpBypass[] | null | undefined,
): boolean {
  return isOrderReadyToShip(order) || isBypassed('ship_gate', order.id, bypasses);
}

/**
 * Причина отказа с учётом снятия: если проверка снята — причины нет.
 * Второе значение объясняет цеху, ПОЧЕМУ кнопка активна вопреки незакрытым
 * этапам: молча снятая блокировка — тот же баг, только необъяснимый.
 */
export function shipGateState(
  order: OrderShipReadiness & { id: string },
  bypasses: ErpBypass[] | null | undefined,
): { canShip: boolean; blockReason: string | null; bypassed: boolean } {
  const ready = isOrderReadyToShip(order);
  const bypassed = !ready && isBypassed('ship_gate', order.id, bypasses);
  return {
    canShip: ready || bypassed,
    blockReason: ready || bypassed ? null : shipBlockReason(order),
    bypassed,
  };
}
