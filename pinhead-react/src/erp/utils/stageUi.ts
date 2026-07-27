/**
 * Общие UI-хелперы этапов: цвет чипа по статусу и готовность заказа к отгрузке.
 * Единый источник для OrdersScreen / OrderCard / ProductionBoard и др.
 * Прогресс считается в штуках — см. utils/progress.ts (правка 7).
 */

import type { ErpItemStage, StageStatus } from '../types';

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
  items: { stages: Pick<ErpItemStage, 'status'>[] }[];
  materials?: { status: string }[];
}

/**
 * Стадия «Готов к отгрузке»: заказ активен, есть хотя бы один этап, ВСЕ этапы
 * завершены (done/skipped) И все материалы получены. Материальная проверка (аудит #5)
 * страхует «сиротские» материалы (packaging/other или цех вне маршрута), которые
 * не гейтят ни один этап, но не должны позволять отгрузку с непришедшим материалом.
 */
export function isOrderReadyToShip(order: OrderShipReadiness): boolean {
  if (order.status !== 'active') return false;
  const stages = order.items.flatMap((it) => it.stages);
  if (stages.length === 0) return false;
  if (!stages.every((s) => s.status === 'done' || s.status === 'skipped')) return false;
  return (order.materials ?? []).every(
    (m) => m.status === 'received' || m.status === 'reserved' || m.status === 'not_needed');
}
