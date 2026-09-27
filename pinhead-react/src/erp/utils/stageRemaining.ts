/**
 * Сколько изделий на этапе ЕЩЁ НЕ УЧТЕНО (правка заказчика 27.09, п. 7).
 *
 * ЧТО СЛОМАЛОСЬ. «Выкроено и принято в пошив 472 изделия. После сдачи 368
 * сшитых оставшиеся 104 пропали из учёта». Этап закрывался по
 * `qty_done >= тираж` — а принято было больше тиража (плюс закроя), и
 * 368 ≥ 350 закрыло швейку, забрав 104 изделия из учёта. «Осталось сдать»
 * при этом считалось от тиража же.
 *
 * ОДНА ФОРМУЛА С СЕРВЕРОМ (`erp_stage_unaccounted`):
 *
 *   не учтено = greatest(тираж, принято) − сдано годных − списано в брак.
 *
 *   · «принято» — `stageInputQty` (минимум по предшественникам);
 *   · greatest с тиражом — потому что у предшественника В РАБОТЕ вход ещё
 *     растёт, и закрывать по нему рано (тот же потолок, что у `stageQtyCap`);
 *   · брак — окончательный, сумма `qty_defect` по отчётам этапа;
 *   · ПЕРЕДЕЛКА ОСТАТОК НЕ УМЕНЬШАЕТ: изделие в переделке вернётся годным
 *     или браком в следующей сдаче, а `qty_rework` — накопительный счётчик
 *     «сколько раз возвращали», а не «сколько сейчас в переделке».
 *
 * Этап закрывается сам, когда не учтено ≤ 0. Обычное «Завершить этап»
 * при остатке > 0 у участка, который отчитывается формой
 * (`erp_departments.result_fields`), запрещено: закрыть можно, сдав
 * оставшиеся или списав их в брак. У участков без формы результата
 * остаётся прежний диалог с недосдачей — им иначе нечем закрыть этап.
 */

import type { ErpDepartment, ErpItemStage } from '../types';
import { stageInputQty, type InputStage } from './stageInput';
import { sizeKey } from './stageSizes';
import { isFileResultStage } from './stageResult';
import { pluralize } from '../../utils/i18n';

/** Минимум отчёта для сумм: брак и размерные строки */
export interface AccountedReport {
  stage_id?: string | null;
  qty_defect?: number | null;
  sizes?: readonly {
    color?: string | null;
    size: string;
    qty_good?: number | null;
    qty_defect?: number | null;
  }[] | null;
}

/** Окончательный брак по отчётам этапа */
export function reportedDefect(
  reports: readonly AccountedReport[] | null | undefined,
  stageId?: string,
): number {
  return (reports ?? [])
    .filter((r) => !stageId || r.stage_id === stageId)
    .reduce((sum, r) => sum + Math.max(r.qty_defect ?? 0, 0), 0);
}

/** Уже учтено по размерам своими отчётами: годные + брак на ключ ячейки */
export function reportedAccountedBySize(
  reports: readonly AccountedReport[] | null | undefined,
  stageId?: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of reports ?? []) {
    if (stageId && r.stage_id !== stageId) continue;
    for (const row of r.sizes ?? []) {
      const key = sizeKey(row.color, row.size);
      out[key] = (out[key] ?? 0) + Math.max(row.qty_good ?? 0, 0) + Math.max(row.qty_defect ?? 0, 0);
    }
  }
  return out;
}

/** Участок отчитывается формой — значит остаток учитывается, а не дописывается */
export function deptAccountsByReports(
  dept: Pick<ErpDepartment, 'result_fields'> | null | undefined,
): boolean {
  return Array.isArray(dept?.result_fields) && dept.result_fields.length > 0;
}

/** Потолок учёта: большее из тиража и принятого — то же, что у `stageQtyCap` */
export function stageCeiling(stage: InputStage, allStages: InputStage[], itemQty: number): number {
  return Math.max(Math.max(itemQty ?? 0, 0), stageInputQty(stage, allStages, itemQty));
}

export interface UnaccountedInput {
  stage: InputStage;
  allStages: InputStage[];
  itemQty: number;
  /** Окончательный брак по отчётам этапа (`reportedDefect`) */
  defectReported: number;
  /** Приращения текущей сдачи — чтобы судить о закрытии до отправки */
  addedGood?: number;
  addedDefect?: number;
}

/** Не учтено: ноль и меньше — этап закрыт по факту */
export function stageUnaccounted(input: UnaccountedInput): number {
  const { stage, allStages, itemQty, defectReported, addedGood = 0, addedDefect = 0 } = input;
  const done = Math.max(stage.qty_done ?? 0, 0) + Math.max(addedGood, 0);
  const defect = Math.max(defectReported, 0) + Math.max(addedDefect, 0);
  return Math.max(stageCeiling(stage, allStages, itemQty) - done - defect, 0);
}

/**
 * Разбивка «не учтено» по размерам, если размерные данные есть:
 * принято по размеру − учтено своими отчётами. Только положительные.
 */
export function sizeUnaccounted(
  sizeInput: Record<string, number> | null | undefined,
  accountedBySize: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, qty] of Object.entries(sizeInput ?? {})) {
    const left = qty - (accountedBySize[key] ?? 0);
    if (left > 0) out[key] = left;
  }
  return out;
}

/** Подпись разбивки: «M — 60 шт, L — 44 шт» по человекочитаемым меткам */
export function sizeBreakdownText(
  unaccounted: Record<string, number>,
  labelByKey: ReadonlyMap<string, string>,
): string {
  return Object.entries(unaccounted)
    .map(([key, qty]) => `${labelByKey.get(key) ?? key} — ${qty} шт`)
    .join(', ');
}

/**
 * Почему этап нельзя завершить обычной кнопкой, или `null`.
 *
 * Только у участков с формой результата: у них «не учтено» — это изделия,
 * которые физически на участке, и дописать их выполненными значило бы
 * передать дальше то, чего нет, а списать в брак — решение мастера, не кнопки.
 * Текст называет ЧИСЛО и разбивку: «нельзя завершить» без цифр отправляет
 * мастера пересчитывать. Слова совпадают с серверным гейтом.
 */
export function stageUnaccountedBlock(
  input: UnaccountedInput & {
    dept: Pick<ErpDepartment, 'result_fields'> | null | undefined;
    breakdown?: string | null;
  },
): string | null {
  if (!deptAccountsByReports(input.dept)) return null;
  const left = stageUnaccounted(input);
  if (left <= 0) return null;
  const items = pluralize(left, 'изделие', 'изделия', 'изделий');
  const detail = input.breakdown ? ` (${input.breakdown})` : '';
  return `Нельзя завершить этап: не учтено ${left} ${items}${detail}. `
    + 'Сдайте оставшиеся изделия или укажите окончательный брак.';
}

/**
 * Что писать этапу при «Завершить этап» / дорожке «Завершено» / чипе доски.
 *
 * Участок с формой результата закрывается тем, что реально учтено, —
 * `qty_done` не трогается (дописать тираж значило бы вернуть ту самую
 * потерю 104 изделий, только в другую сторону). Файловый результат числа
 * не имеет вовсе (правка 13.09, п. 9). Остальным — как прежде, весь тираж:
 * у них нет формы, чтобы сдать иначе, и об этом спрашивает диалог.
 */
export function stageDonePatch(
  stage: Pick<ErpItemStage, 'id' | 'result_kind'>,
  itemQty: number,
  dept: Pick<ErpDepartment, 'result_fields'> | null | undefined,
): { qty_done?: number } {
  if (isFileResultStage(stage)) return {};
  if (deptAccountsByReports(dept)) return {};
  return { qty_done: itemQty };
}
