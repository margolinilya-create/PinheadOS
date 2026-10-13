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
 *   не учтено = принято − сдано годных − списано в брак.
 *
 *   · «принято» — `stageInputQty` (минимум по предшественникам);
 *   · пока предшественник В РАБОТЕ, вход ещё растёт, и закрывать по нему
 *     рано — тогда потолок большее из тиража и принятого (правка 05.10);
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

/**
 * ПРОИЗВОДСТВЕННЫЙ участок с формой результата — остаток у него учитывается,
 * а не дописывается. Непроизводственные (склад, закупка) тоже носят
 * `result_fields`, но их этапы закрывают складские задачи и отгрузка
 * (`erp_warehouse_task_derive`, `erp_ship_order`), а не сдача изделий —
 * гейт «не учтено N изделий» им не по адресу. То же условие у сервера.
 */
export function deptAccountsByReports(
  dept: Pick<ErpDepartment, 'result_fields'> & { is_production?: boolean | null } | null | undefined,
): boolean {
  return Boolean(dept?.is_production)
    && Array.isArray(dept?.result_fields) && dept.result_fields.length > 0;
}

/**
 * Потолок учёта (правка 05.10, п. 1): ПРИНЯТОЕ, когда все предшественники
 * закрыты, — «цех не может сдать больше, чем получил», и недовыпуск закроя
 * не превращается в «ещё 50 к сдаче» у швейки. Пока предшественник в работе,
 * вход ещё растёт, и закрывать этап по нему рано — тогда большее из тиража
 * и принятого. Зеркало `erp_stage_unaccounted`.
 */
export function stageCeiling(stage: InputStage, allStages: InputStage[], itemQty: number): number {
  const input = stageInputQty(stage, allStages, itemQty);
  const byId = new Map(allStages.map((s) => [s.id, s]));
  const upstreamOpen = (stage.depends_on ?? []).some((id) => {
    const dep = byId.get(id);
    return dep ? dep.status !== 'done' && dep.status !== 'skipped' : false;
  });
  return upstreamOpen ? Math.max(Math.max(itemQty ?? 0, 0), input) : input;
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
  /**
   * Форма «изделий — N» одна и на сервере (`erp_stage_completion_block`):
   * в SQL число и предмет разводятся, чтобы не заводить второе склонение.
   */
  const detail = input.breakdown ? ` (${input.breakdown})` : '';
  return `Нельзя завершить этап: не учтено изделий — ${left}${detail}. `
    + 'Сдайте оставшиеся изделия или укажите окончательный брак.';
}

/**
 * Что писать этапу при «Завершить этап» / дорожке «Завершено» / чипе доски.
 *
 * Участок с формой результата закрывается тем, что реально учтено, —
 * `qty_done` не трогается. Файловый результат числа не имеет вовсе
 * (правка 13.09, п. 9). Остальным — ПРИНЯТОЕ, а не тираж (правка 05.10,
 * п. 1): «принудительное завершение не добавляет изделия до плана», и
 * обычное закрытие участка без формы тоже передаёт дальше то, что получил.
 */
export function stageDonePatch(
  stage: InputStage & Pick<ErpItemStage, 'result_kind'>,
  item: { qty: number; stages?: InputStage[] | null },
  dept: Pick<ErpDepartment, 'result_fields'> | null | undefined,
): { qty_done?: number } {
  if (isFileResultStage(stage)) return {};
  if (deptAccountsByReports(dept)) return {};
  return { qty_done: stageInputQty(stage, item.stages ?? [], item.qty) };
}
