/**
 * Возврат брака на предыдущий этап: что именно откатится.
 *
 * `reportDefect` переоткрывает не только выбранный этап, но и ВСЕ промежуточные
 * между ним и текущим — перекроенные единицы обязаны заново пройти их, иначе
 * застрянут в `done`. Логика правильная, но в интерфейсе её не было видно:
 * в выпадающем списке рабочий выбирал «Вернуть: Швейка» и не знал, что заодно
 * откатятся ВТО и Печать, а цеха внезапно получали обратно сданную работу.
 *
 * Здесь считается тот же диапазон `sort_order`, что и в слайсе, — чтобы текст
 * подтверждения не разошёлся с фактическим действием.
 */

import { confirm } from '../../store/useConfirmStore';
import type { ErpItemStage } from '../types';

type DefectStage = Pick<ErpItemStage, 'id' | 'department_id' | 'sort_order' | 'status'>;

export interface DefectRollbackInput {
  /** Этап, на котором оформляют брак */
  stage: DefectStage;
  /** Этап, куда возвращают (null для спец-целей: закупка, подрядчик, текущий) */
  targetStage: DefectStage | null;
  /** Все этапы позиции */
  allStages: DefectStage[];
  /** id цеха → короткое имя */
  deptNameById?: Map<string, string>;
}

/**
 * Промежуточные этапы, которые переоткроются вместе с целевым.
 * Условия — копия слайса: строго внутри диапазона и только уже начатые.
 */
export function intermediateReopened(input: DefectRollbackInput): DefectStage[] {
  const { stage, targetStage, allStages } = input;
  if (!targetStage) return [];
  const lo = Math.min(targetStage.sort_order, stage.sort_order);
  const hi = Math.max(targetStage.sort_order, stage.sort_order);
  return allStages.filter((mid) => {
    if (mid.id === stage.id || mid.id === targetStage.id) return false;
    if (mid.sort_order <= lo || mid.sort_order >= hi) return false;
    return mid.status === 'done' || mid.status === 'in_progress';
  });
}

function name(s: DefectStage, map?: Map<string, string>): string {
  return map?.get(s.department_id) || 'этап';
}

/**
 * Текст подтверждения или `null`, если спрашивать нечего.
 * Спрашиваем только когда цель — конкретный этап: «устранить на текущем»,
 * «на закупку» и «подрядчику» ничего чужого не откатывают.
 */
export function defectRollbackWarning(
  input: DefectRollbackInput & { qty: number },
): string | null {
  const { targetStage, qty, deptNameById } = input;
  if (!targetStage) return null;

  const parts = [`${qty} шт вернутся в «${name(targetStage, deptNameById)}».`];
  const mids = intermediateReopened(input);
  if (mids.length > 0) {
    const names = mids.map((m) => name(m, deptNameById)).join(', ');
    parts.push(`Заодно переоткроются: ${names} — перекроенные единицы пройдут их заново.`);
  }
  return parts.join(' ');
}

/** Спросить перед возвратом брака. `true` — можно оформлять. */
export async function confirmDefectRollback(
  input: DefectRollbackInput & { qty: number },
): Promise<boolean> {
  const warning = defectRollbackWarning(input);
  if (!warning) return true;
  return confirm({
    title: 'Вернуть брак на предыдущий этап?',
    message: warning,
    confirmLabel: 'В переделку',
    variant: 'danger',
  });
}
