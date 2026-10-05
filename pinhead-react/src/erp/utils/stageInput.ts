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

/** Минимум этапа для расчёта входа */
export type InputStage = Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & {
  qty_done?: number | null;
  /** Этап изделий не выпускает и передаёт дальше свой вход (ведёт сервер) */
  qty_passthrough?: boolean | null;
  origin?: string | null;
  result_kind?: string | null;
};

/**
 * ПРОЗРАЧНЫЙ ЭТАП (правка 05.10, п. 1) — изделий не выпускает и передаёт
 * дальше то, что получил сам: пропущенный, непроизводственного участка
 * (закупка, склад), с файловым результатом и СТАРЫЙ — закрытый до правки
 * с нулём и без отчётов. Признак ведёт сервер (`erp_item_stages.qty_passthrough`,
 * триггер `erp_stage_passthrough`), и формула здесь та же, что в
 * `erp_stage_input_qty`.
 *
 * Колонки может не быть в строке (оптимистичная вставка, старый select) —
 * тогда закрытый с нулём считается прозрачным: заниженный вход запретил бы
 * цеху отчитаться за сделанное, это fail-open, а не правило.
 */
export function isPassthrough(
  stage: Pick<InputStage, 'status' | 'qty_done' | 'qty_passthrough'>,
): boolean {
  if (stage.status === 'skipped') return true;
  if (typeof stage.qty_passthrough === 'boolean') return stage.qty_passthrough;
  return stage.status === 'done' && Math.max(stage.qty_done ?? 0, 0) === 0;
}

/**
 * ВЫХОД ЭТАПА — ЕГО ФАКТ (правка 05.10, п. 1).
 *
 * «Покроили 102 — в пошив передаётся 102. Пошили 100 — в ВТО передаётся 100».
 * Прежде закрытый этап считался сданным не меньше тиража (`max(факт, тираж)`),
 * и принудительное завершение швейки на 100 из 150 отдавало ВТО 150. Теперь
 * выход — `qty_done` (включая перевыполнение закроя, правка 12.09), а план
 * заказа показывается отдельно. Прозрачный этап отдаёт свой вход.
 */
function stageOutput(
  stage: InputStage,
  byId: ReadonlyMap<string, InputStage>,
  total: number,
  depth: number,
): number {
  if (isPassthrough(stage)) return inputOf(stage, byId, total, depth + 1);
  return Math.max(stage.qty_done ?? 0, 0);
}

function inputOf(
  stage: InputStage,
  byId: ReadonlyMap<string, InputStage>,
  total: number,
  depth: number,
): number {
  const deps = stage.depends_on ?? [];
  // Петля в графе (кривые данные) — тираж, как у сервера
  if (deps.length === 0 || depth > 32) return total;
  const outputs = deps
    .map((id) => byId.get(id))
    .filter((s): s is InputStage => Boolean(s))
    .map((s) => stageOutput(s, byId, total, depth));
  // Зависимости есть, но самих этапов в наборе нет (урезанный select) — не
  // выдумываем: считаем по тиражу, как для первого этапа. Fail-open, потому что
  // заниженный вход запретил бы цеху отчитаться за реально сделанное.
  if (outputs.length === 0) return total;
  return Math.min(...outputs);
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
 * и сумма выходов дала бы 200 — вдвое больше, чем существует. Швейный цех может
 * начать ровно столько, сколько прошло через самую отстающую ветку.
 */
export function stageInputQty(
  stage: InputStage,
  allStages: InputStage[],
  itemQty: number,
): number {
  const total = Math.max(itemQty ?? 0, 0);
  const byId = new Map(allStages.map((s) => [s.id, s]));
  return inputOf(stage, byId, total, 0);
}

/** Выход этапа: факт, у прозрачного — его вход. Зеркало `erp_stage_output_qty` */
export function stageOutputQty(
  stage: InputStage,
  allStages: InputStage[],
  itemQty: number,
): number {
  const total = Math.max(itemQty ?? 0, 0);
  const byId = new Map(allStages.map((s) => [s.id, s]));
  return stageOutput(stage, byId, total, 0);
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

/**
 * ВЫПУЩЕНО ПО ПОЗИЦИИ (правка 05.10, п. 1): минимум выходов терминальных
 * этапов маршрута — на которые никто не ссылается. Этапы образца и файловые
 * не считаются. Маршрута нет — тираж. Предел приёмки склада готовой продукции
 * и отгрузки: «отгрузить можно не больше фактического остатка». Зеркало
 * серверной `erp_item_produced_qty`.
 */
export function itemProducedQty(item: { qty: number; stages?: InputStage[] | null }): number {
  const total = Math.max(item.qty ?? 0, 0);
  const stages = item.stages ?? [];
  const serial = stages.filter((s) => (s.origin ?? 'production') === 'production' && !s.result_kind);
  const referenced = new Set(stages.flatMap((s) => s.depends_on ?? []));
  const terminal = serial.filter((s) => !referenced.has(s.id));
  if (terminal.length === 0) return total;
  const byId = new Map(stages.map((s) => [s.id, s]));
  return Math.min(...terminal.map((s) => stageOutput(s, byId, total, 0)));
}
