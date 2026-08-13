/**
 * Сколько штук ПРИНЯТО в работу на этап (правки заказчика 10.08, волна 3).
 *
 * Документ требует, чтобы каждый цех отчитывался числами и было видно
 * «принято → сделано → брак → передано». «Принято» нигде не хранится: это
 * выход предыдущего этапа, и считать его надо по графу `depends_on`.
 *
 * Считает КЛИЕНТ, и это правило проекта, а не удобство: обход `depends_on`
 * уже реализован здесь (маршрут, возврат брака, готовность этапа), и вторая
 * реализация на SQL — та самая рассинхронизация, из-за которой текст
 * подтверждения когда-то разошёлся с фактом. Сервер получает посчитанное число
 * снимком в журнал: это аудит («цех видел столько»), а не источник правды.
 */

import type { ErpItemStage } from '../types';
import { stagesById } from './stagesById';

/** Минимум этапа для расчёта входа */
export type InputStage = Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & {
  qty_done?: number | null;
};

/**
 * Закрытый этап считаем сданным целиком: цех мог закрыть его кнопкой «Готово»
 * или переносом на канбане, не набивая `qty_done` по одной штуке. То же
 * допущение, что в `utils/progress` — иначе «принято» и «прогресс» разойдутся.
 */
function stageOutput(stage: InputStage, itemQty: number): number {
  if (stage.status === 'done') return itemQty;
  if (stage.status === 'skipped') return itemQty;
  return Math.min(Math.max(stage.qty_done ?? 0, 0), itemQty);
}

/**
 * Вход этапа в штуках.
 *
 * · нет предшественников (первый в маршруте) → весь тираж позиции;
 * · один предшественник → сколько он сдал;
 * · НЕСКОЛЬКО → МИНИМУМ, а не сумма.
 *
 * Последнее — главное здесь. Параллельные ветки нанесения (шелкография и ДТФ
 * на одной позиции) обрабатывают ОДНИ И ТЕ ЖЕ единицы: тираж 100 проходит обе,
 * и сумма выходов дала бы 200 — вдвое больше, чем существует. Швейка может
 * начать ровно столько, сколько прошло через самую отстающую ветку.
 */
export function stageInputQty(
  stage: InputStage,
  allStages: InputStage[],
  itemQty: number,
): number {
  const total = Math.max(itemQty ?? 0, 0);
  const deps = stage.depends_on ?? [];
  if (deps.length === 0) return total;

  const byId = stagesById(allStages);
  const outputs = deps
    .map((id) => byId.get(id))
    .filter((s): s is InputStage => Boolean(s))
    .map((s) => stageOutput(s, total));

  // Зависимости есть, но самих этапов в наборе нет (урезанный select) — не
  // выдумываем: считаем по тиражу, как для первого этапа. Fail-open, потому что
  // заниженный вход запретил бы цеху отчитаться за реально сделанное.
  if (outputs.length === 0) return total;

  return Math.min(...outputs);
}

/** Сколько ещё можно принять/сдать на этапе: вход минус уже сделанное */
export function stageRemainingQty(
  stage: InputStage,
  allStages: InputStage[],
  itemQty: number,
): number {
  const input = stageInputQty(stage, allStages, itemQty);
  return Math.max(input - Math.max(stage.qty_done ?? 0, 0), 0);
}
