/**
 * Общие UI-хелперы этапов: цвет чипа по статусу и готовность заказа к отгрузке.
 * Единый источник для OrdersScreen / OrderCard / ProductionBoard и др.
 * Прогресс считается в штуках — см. utils/progress.ts (правка 7).
 */

import type { ErpItemStage, ErpMaterial, StageStatus } from '../types';
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
