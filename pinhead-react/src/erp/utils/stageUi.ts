/**
 * Общие UI-хелперы этапов: цвет чипа по статусу и прогресс «готово/всего».
 * Единый источник для OrdersScreen / OrderCard / ProductionBoard и др.
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
