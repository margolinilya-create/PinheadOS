/**
 * ДАННЫЕ РУЛОНА В ЗАКРОЙКЕ И ЗАВЕРШЕНИЕ РУЛОНА (правка заказчика 05.10, п. 5).
 *
 * «Данные рулона в закройке: номер, материал, цвет, исходный метраж и откуда
 * он взят, записанный расход, доступный остаток». Доступное — то, что ведёт
 * сервер (`length_left_m` = метраж − ВЕСЬ сохранённый расход), то есть
 * число на экране и потолок проверки `erp_stage_submit_report` одно и то же.
 *
 * «Завершение рулона вынести отдельно: остаток, поле измеренного метража,
 * выбор „оставить пригодный остаток / списать непригодный" — ничего
 * не выбирать за пользователя. Измеренный остаток сохранить вместе
 * с уточнением, историю расхода не стирать».
 *
 * ПОЧЕМУ ЗАМЕР УЕЗЖАЕТ УТОЧНЕНИЕМ ПОЛНОГО МЕТРАЖА. Отдельной RPC «завершить
 * рулон» нет, а `erp_stage_submit_report` пишет замер только вместе
 * с расходом больше нуля — то есть новой строкой отчёта. Существующий путь
 * без отчёта — `erp_material_roll_set_params`: после начала расхода он
 * принимает новый ПОЛНЫЙ метраж, вычитает из него весь записанный расход
 * и пишет корректировку `length_refine` с причиной, автором и датой;
 * строки расхода не трогаются. Полный метраж для замера M:
 * `length_m + (M − доступно)` — сервер получит ровно M остатка.
 */

import type { ErpMaterialRoll } from '../types';
import type { RollOption } from './cutRolls';
import { roundM, rollAvailableM, rollWorkingLength } from './fabricMetres';
import type { LengthSource } from './fabricMetres';

export interface RollMetresSummary {
  /** Исходный (рабочий) метраж рулона */
  initial: number;
  /** Откуда он взят: расчёт, поставщик, замер */
  source: LengthSource;
  /** Записано расходом (и уточнениями) — исходный минус доступный */
  spent: number;
  /** Доступно сейчас — потолок проверки при сохранении */
  available: number;
}

/** Сводка метража рулона; `null` — у рулона нет записанного метража */
export function rollMetresSummary(
  option: Pick<RollOption, 'roll' | 'material'> | null | undefined,
): RollMetresSummary | null {
  if (!option) return null;
  const working = rollWorkingLength(option.roll, option.material);
  if (!working?.stored) return null;
  const available = rollAvailableM(option.roll, option.material) ?? working.length;
  return {
    initial: roundM(working.length),
    source: working.source,
    spent: Math.max(roundM(working.length - available), 0),
    available: roundM(available),
  };
}

export interface RollFinishPlan {
  /** Остаток, с которым рулон завершается: замер, а без него — по записям */
  left: number;
  /** Новый полный метраж для `erp_material_roll_set_params`; `null` — не уточняем */
  refineLengthM: number | null;
  error: string | null;
}

/** Что уйдёт на сервер при завершении рулона с этим замером */
export function rollFinishPlan(
  roll: Pick<ErpMaterialRoll, 'length_m' | 'length_left_m' | 'qty_left'> & Partial<ErpMaterialRoll>,
  measured: number | string | null | undefined,
): RollFinishPlan {
  const stored = Number(roll.length_m) > 0 ? Number(roll.length_m) : null;
  const available = stored === null
    ? Math.max(Number(roll.qty_left) || 0, 0)
    : Math.max(Number(roll.length_left_m ?? stored), 0);
  const blank = measured === null || measured === undefined || measured === '';
  if (blank) return { left: available, refineLengthM: null, error: null };
  const m = Number(measured);
  if (!Number.isFinite(m) || m < 0) {
    return { left: available, refineLengthM: null, error: 'Измеренный остаток не может быть отрицательным' };
  }
  if (stored === null) {
    return {
      left: available,
      refineLengthM: null,
      error: 'У рулона нет метража — замер остатка в метрах не записать, сначала заполните параметры рулона',
    };
  }
  if (Math.abs(m - available) <= 0.005) return { left: m, refineLengthM: null, error: null };
  const refine = stored + (m - available);
  if (!(refine > 0)) {
    return { left: available, refineLengthM: null, error: 'Замер не сходится с записанным расходом' };
  }
  return { left: m, refineLengthM: refine, error: null };
}

/** Текст отказа, когда замер расходится с записями, а причины нет */
export const ROLL_REFINE_REASON_REQUIRED = 'Замер расходится с записанным расходом — укажите причину расхождения';

/**
 * Почему рулон нельзя завершить; `null` — можно.
 *
 * `reason` — причина расхождения замера с записями. Обязательна, когда
 * замер уточняет метраж (QA 09.10): без неё в журнал корректировок уходила
 * общая фраза, и через месяц не понять, откуда взялись лишние метры.
 */
export function rollFinishBlock(
  plan: RollFinishPlan,
  kind: 'usable' | 'scrap' | null | undefined,
  reason = '',
): string | null {
  if (plan.error) return plan.error;
  if (plan.refineLengthM !== null && !reason.trim()) return ROLL_REFINE_REASON_REQUIRED;
  if (plan.left > 0.0005) {
    return kind ? null : 'Выберите, что сделать с остатком: оставить пригодный или списать непригодный';
  }
  return plan.refineLengthM !== null ? null : 'Остатка нет: рулон израсходован, решать нечего';
}
