/**
 * Закрытие этапа «целиком»: что именно случится с незакрытым количеством.
 *
 * Кнопка «Завершить этап» (и дорожка «Завершено» на канбане, и чип на
 * производственном плане) пишет `qty_done = item.qty`, то есть **весь тираж**,
 * независимо от того, сколько цех реально сдал. Если сдали 40 из 100, в системе
 * окажется 100: следующий цех получит 100 шт, которых физически нет, а в
 * производственной статистике останется приписка.
 *
 * DESIGN.md требует подтверждения именно для «незакрытого количества», поэтому
 * здесь считается текст последствий, а сам диалог — в `confirmStageDone`.
 * Разделено, чтобы формулировку можно было проверить тестом без диалогов.
 */

import { confirm } from '../../store/useConfirmStore';
import type { ErpItemStage } from '../types';

export interface StageDoneInput {
  /** Закрываемый этап */
  stage: Pick<ErpItemStage, 'id' | 'qty_done'>;
  /** Тираж позиции */
  qty: number;
  /** Все этапы позиции — чтобы назвать те, что разблокируются */
  allStages: Pick<ErpItemStage, 'id' | 'department_id' | 'depends_on'>[];
  /** id цеха → короткое имя */
  deptNameById?: Map<string, string>;
}

/** Этапы, которые ждут именно этот (после закрытия они откроются) */
export function dependentStageNames(input: StageDoneInput): string[] {
  const { stage, allStages, deptNameById } = input;
  return allStages
    .filter((s) => s.depends_on.includes(stage.id))
    .map((s) => deptNameById?.get(s.department_id) || 'следующий этап');
}

/**
 * Текст предупреждения или `null`, если закрывать можно молча.
 * Молча — только когда цех уже отчитался за весь тираж: тогда «Завершить этап»
 * ничего не дописывает и подтверждать нечего.
 */
export function stageDoneWarning(input: StageDoneInput): string | null {
  const { stage, qty } = input;
  const done = stage.qty_done ?? 0;
  const remaining = qty - done;
  if (remaining <= 0) return null;

  const parts = [
    `Цех отчитался за ${done} из ${qty} шт.`,
    `Оставшиеся ${remaining} шт будут записаны как выполненные.`,
  ];
  const next = dependentStageNames(input);
  if (next.length > 0) {
    parts.push(`Следующий этап (${next.join(', ')}) откроется на полный тираж ${qty} шт.`);
  }
  return parts.join(' ');
}

/**
 * Спросить перед закрытием этапа. Единая точка для всех трёх мест, откуда этап
 * закрывается целиком: очередь цеха, дорожка «Завершено» на канбане и чип
 * производственного плана. Возвращает `true`, если можно закрывать.
 */
export async function confirmStageDone(input: StageDoneInput): Promise<boolean> {
  const warning = stageDoneWarning(input);
  if (!warning) return true;
  return confirm({
    title: 'Завершить этап не полностью?',
    message: warning,
    confirmLabel: 'Завершить',
    variant: 'danger',
  });
}
