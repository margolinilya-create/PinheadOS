/**
 * Общие UI-хелперы этапов: цвет чипа по статусу и прогресс «готово/всего».
 * Единый источник для OrdersScreen / OrderCard / ProductionBoard и др.
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

/** Прогресс позиции по этапам: skipped не считаются, done — числитель */
export function stageProgress(
  stages: Pick<ErpItemStage, 'status'>[],
): { done: number; total: number } {
  const relevant = stages.filter((s) => s.status !== 'skipped');
  return {
    done: relevant.filter((s) => s.status === 'done').length,
    total: relevant.length,
  };
}

/** Минимум заказа, по которому судим о готовности к отгрузке */
export interface OrderShipReadiness {
  status: string;
  items: { stages: Pick<ErpItemStage, 'status'>[] }[];
  materials?: ErpMaterial[];
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
  const stages = order.items.flatMap((it) => it.stages);
  if (stages.length === 0) return false;
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
  const stages = order.items.flatMap((it) => it.stages);
  if (stages.length === 0) return 'У заказа нет этапов маршрута';

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
