/**
 * Прогресс производства по штукам (правка 7).
 *
 * Формула (решение заказчика): считаем по количеству изделий, прошедших стадии, —
 * Σ сделано по всем этапам маршрута / (тираж × число этапов маршрута).
 * Так «Швейка 45/100» видно честно, а заказ на 3 из 5 этапов не показывает 60%,
 * пока на текущем этапе не сделано ни штуки.
 *
 * Пропущенные этапы (skipped) в знаменатель не входят — они не работа.
 * Заменил прежний stageProgress, который считал завершённые ЭТАПЫ: он показывал
 * 60% на заказе с 3 закрытыми этапами из 5, даже если на текущем не сделано ни штуки.
 */

import type { ErpItemStage } from '../types';

export interface QtyProgress {
  /** Сделано штук */
  done: number;
  /** План штук */
  total: number;
  /** Процент готовности, 0..100 */
  pct: number;
}

/** Минимум этапа для расчёта прогресса */
type ProgressStage = Pick<ErpItemStage, 'status'> & {
  qty_done?: number | null;
  /** Образец или серия — образец в прогресс СЕРИИ не входит */
  origin?: string | null;
};
/** Минимум позиции */
interface ProgressItem {
  qty: number;
  stages: ProgressStage[];
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.round((done / total) * 100) : 0;
}

/**
 * Прогресс одного этапа относительно тиража позиции.
 * Завершённый этап считаем сделанным целиком: цех мог закрыть его кнопкой «Готово»
 * или переносом на канбане, не набивая qty_done по одной штуке.
 */
export function stageQtyProgress(stage: ProgressStage, itemQty: number): QtyProgress {
  const total = Math.max(itemQty, 0);
  if (stage.status === 'done') return { done: total, total, pct: pct(total, total) };
  const done = Math.min(Math.max(stage.qty_done ?? 0, 0), total);
  return { done, total, pct: pct(done, total) };
}

/**
 * Прогресс позиции: сделанное по всем этапам маршрута из (тираж × этапы).
 *
 * Этапы ОБРАЗЦА (`origin = 'experimental'`) в расчёт не входят. Они появляются
 * по решению технолога вне маршрута, тираж у них свой (три штуки против ста),
 * и в знаменателе они разбавляли бы прогресс серии: маршрут из четырёх этапов
 * с одним заходом образца показывал бы 80 % при полностью закрытой работе.
 *
 * Это не противоречит правилу «`origin` в маршрутную логику не входит»: то
 * правило про ПЕРЕХОДЫ и ГЕЙТЫ самого этапа — цех работает с образцом теми же
 * кнопками, под теми же правами и через тот же страж. Здесь считается доля
 * выполненного, а не решается, можно ли работать.
 */
export function itemProgress(item: ProgressItem): QtyProgress {
  const relevant = (item.stages ?? []).filter(
    (s) => s.status !== 'skipped' && s.origin !== 'experimental');
  const qty = Math.max(item.qty, 0);
  const total = relevant.length * qty;
  const done = relevant.reduce((sum, s) => sum + stageQtyProgress(s, qty).done, 0);
  return { done, total, pct: pct(done, total) };
}

/**
 * Прогресс заказа — сумма по позициям.
 * Складываем числители и знаменатели, поэтому позиция с бо́льшим тиражом
 * и более длинным маршрутом весит больше (а не «среднее по позициям»).
 */
export function orderProgress(order: { items?: ProgressItem[] }): QtyProgress {
  let done = 0;
  let total = 0;
  for (const item of order.items ?? []) {
    const p = itemProgress(item);
    done += p.done;
    total += p.total;
  }
  return { done, total, pct: pct(done, total) };
}

/**
 * ЭТАПЫ СЧИТАЮТСЯ ШТУКАМИ ЭТАПОВ (правка заказчика 22.08, п. 3.11).
 *
 * «Формат 100/500 шт:этапов и похожие значения плохо читаются для обычного
 * пользователя. Лучше показывать прогресс этапов в понятной форме, например
 * 1 из 5 этапов завершено, 20 процентов».
 *
 * Величина ДРУГАЯ, а не то же число другими словами: «шт·этапов» — это сумма
 * изделий по всем этапам маршрута, а здесь — сколько этапов закрыто целиком.
 * Обе честны, но на вопрос «далеко ли до конца» отвечает вторая, и её же
 * человек может проверить глазами по списку этапов.
 *
 * Пропущенные и этапы образца не считаются — тем же отбором, что `itemProgress`:
 * два разных представления одного маршрута обязаны говорить об одном наборе.
 */
export function stageCountProgress(item: ProgressItem): {
  done: number; total: number; pct: number | null;
} {
  const relevant = (item.stages ?? []).filter(
    (s) => s.status !== 'skipped' && s.origin !== 'experimental');
  const done = relevant.filter((s) => s.status === 'done').length;
  const total = relevant.length;
  // Ноль в знаменателе — «неизвестно», а не «готово»: правило проекта
  return { done, total, pct: total > 0 ? pct(done, total) : null };
}
