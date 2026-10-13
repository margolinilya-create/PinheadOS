import type { ErpItemStage } from '../types';
import { isPassthrough } from './stageInput';

/**
 * ФАКТ И «ПЛЮС» ЭТАПА (правка заказчика 12.09, п. 5).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ: «не ограничивать фактический результат количеством
 * заказа. Сохранять полный фактический результат и отдельно считать
 * превышение: „плюс" = max(факт − количество заказа, 0). Для заказа 100 шт
 * и факта 105 шт должно сохраняться: основной тираж — 100 шт, плюс — +5 шт,
 * факт — 105 шт».
 *
 * «ПЛЮС» НЕ ХРАНИТСЯ, А СЧИТАЕТСЯ. Он полностью выводится из двух чисел,
 * которые уже есть: `qty_done` этапа и `qty` позиции. Колонка рядом означала
 * бы двух писателей одной величины, и проект на этом ловился дважды —
 * `qty_received` при пустом журнале приёмок (девять материалов «принято»
 * с нулевым количеством) и брак подряда, выводившийся разностью. Здесь тот же
 * довод, что у `subcontractShortfall`: если величина выводима, её выводят.
 *
 * ОДНА ФУНКЦИЯ НА ВСЕ ПОВЕРХНОСТИ. Читают её очередь цеха, страница задания,
 * история заказа и маршрут в карточке. Формула `qty_done − qty` короткая
 * и потому особенно охотно копируется по месту — а разойтись ей достаточно
 * в одном знаке, чтобы два экрана показали разное про один этап.
 */

/** Минимум этапа для расчёта факта */
export type QtyStage = Pick<ErpItemStage, 'status'> & {
  qty_done?: number | null;
  qty_passthrough?: boolean | null;
};

/**
 * Сколько ФАКТИЧЕСКИ сдано на этапе — `qty_done`, и только он (правка 05.10,
 * п. 1). Прежде закрытый этап считался сданным не меньше тиража, и швейка,
 * закрытая принудительно на 100 из 150, показывала «Факт 150».
 *
 * Исключение — ПРОЗРАЧНЫЙ этап без числа (пропущенный, непроизводственный,
 * старый закрытый с нулём): у него факта нет вовсе, и подпись показывает
 * тираж, как раньше. Сколько он передаёт дальше, считает `stageInputQty`.
 */
export function stageFactQty(stage: QtyStage, itemQty: number): number {
  const total = Math.max(itemQty ?? 0, 0);
  const done = Math.max(stage.qty_done ?? 0, 0);
  if (done === 0 && isPassthrough(stage)) return total;
  return done;
}

/** Недовыпуск закрытого этапа: план − факт. Ноль — этап не закрыт или добрал план */
export function stageShortfallQty(stage: QtyStage, itemQty: number): number {
  if (stage.status !== 'done') return 0;
  return Math.max(Math.max(itemQty ?? 0, 0) - stageFactQty(stage, itemQty), 0);
}

/** Сверх тиража: «плюс» этапа. Ноль — перевыполнения нет */
export function stageExtraQty(stage: QtyStage, itemQty: number): number {
  return Math.max(stageFactQty(stage, itemQty) - Math.max(itemQty ?? 0, 0), 0);
}

/** Есть ли на этапе перевыполнение — для показа чипа «+N» */
export function hasStageExtra(stage: QtyStage, itemQty: number): boolean {
  return stageExtraQty(stage, itemQty) > 0;
}

/**
 * Подпись «Заказ 100 · Факт 105 · Плюс +5» одной строкой.
 *
 * Документ просит показывать все три числа вместе («Для каждого завершённого
 * этапа отображать: „Заказ — 100 шт / Факт — 105 шт / Плюс — +5 шт"»). Когда
 * перевыполнения нет, «плюс» не пишется вовсе: «Плюс +0» — это шум, от
 * которого через неделю перестают отличать настоящее перевыполнение.
 */
export function stageFactLabel(stage: QtyStage, itemQty: number): string {
  const total = Math.max(itemQty ?? 0, 0);
  const fact = stageFactQty(stage, itemQty);
  const extra = stageExtraQty(stage, itemQty);
  const base = `Заказ ${total} · Факт ${fact}`;
  return extra > 0 ? `${base} · Плюс +${extra}` : base;
}
