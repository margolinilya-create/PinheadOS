import type { ErpDepartment, ErpItemStage } from '../types';
import type { InputStage } from './stageInput';
import { stageInputQty } from './stageInput';

/**
 * «ПЛЮСЫ» ПОЯВЛЯЮТСЯ ТОЛЬКО НА ЗАКРОЕ (правка заказчика 12.09, вторая
 * порция, п. 4).
 *
 * Документ: «дополнительное количество сверх тиража („плюсы") формируется
 * только на этапе закроя. Именно фактическое количество, переданное закроем,
 * задаёт максимальный объём, который может дальше двигаться по
 * производственным этапам… Если заказ 100 шт и закрой сдал 105 шт, дальше
 * можно работать максимум со 105 шт. Если закрой сдал ровно 100 шт,
 * на вышивке, шелкографии, швейке, ВТО и других последующих этапах нельзя
 * указать 101 и более».
 *
 * ЧТО БЫЛО. Правка 12.09 (первая порция, п. 5) сняла потолок факта ЦЕЛИКОМ
 * и ВЕЗДЕ — и в `erp_clamp_done`, и в BEFORE-триггере таблицы. У поля ввода
 * в форме отчёта не было даже атрибута `max`: числа «принято в работу»
 * и «осталось сдать» участвовали только в подсказке. На боевой базе 12.09
 * уже есть этап ВЫШИВКИ с `qty_done = 105` при тираже 100 — то есть «плюс»
 * возник мимо закроя ровно так, как описывает жалоба.
 *
 * ПРАВО НА ПРЕВЫШЕНИЕ — СВОЙСТВО УЧАСТКА В ДАННЫХ
 * (`erp_departments.allows_over_plan`), а не константа `code === 'cutting'`
 * в коде. Рядом уже живут два таких свойства — материальный гейт
 * (`gate_material_kinds`) и схема отчёта (`result_fields`), — и правило
 * проекта прямо запрещает держать в коде константы вида «ткань → закрой».
 *
 * ПОТОЛОК — БОЛЬШЕЕ ИЗ ТИРАЖА И ПЕРЕДАННОГО, и это читается прямо
 * из документа: «нельзя указать 101 и более» при заказе 100, «можно работать
 * максимум со 105», когда закрой сдал 105. Запрещено ПРЕВЫШЕНИЕ ЗАКАЗА,
 * а не «сдать больше, чем успел предыдущий этап»: тираж цех вправе закрыть
 * всегда — недосдача предыдущего этапа это другой разговор, и ведёт его
 * `stageDoneWarning`.
 *
 * Взять потолком один только вход было первой редакцией этой правки, и она
 * оказалась СТРОЖЕ ИНТЕРФЕЙСА: «Завершить этап» и перенос карточки на канбане
 * пишут `qty_done = тираж`, и у этапа, чей предшественник ещё в работе,
 * закрытие упиралось бы в отказ. Запрещённое «кнопка есть, действие падает»,
 * причём на самом частом действии цеха.
 *
 * Переданное считает тот же `stageInputQty`, что и «принято в работу»
 * в шапке формы: минимум по предшественникам, у закрытого факт не ниже
 * тиража. Второй формулы здесь не заводится.
 */

/** Участку разрешено сдавать больше, чем пришло на вход */
export function deptAllowsOverPlan(
  dept: Pick<ErpDepartment, 'allows_over_plan'> | null | undefined,
): boolean {
  // Строго с новым значением: у участков из старых фикстур и урезанных
  // выборок колонки нет вовсе, и `!== false` объявило бы «плюс» разрешённым
  // ВЕЗДЕ — то есть сняло бы правило целиком, ничего не сломав на вид.
  return dept?.allows_over_plan === true;
}

/**
 * Сколько ещё можно сдать на этапе. `null` — потолка нет (закрой).
 *
 * Считается от ОСТАТКА, а не от входа: `qty_done` уже записан, и цех вводит
 * приращение — потолок на вводимое число обязан это учитывать.
 */
export function stageQtyCap(
  stage: InputStage & { qty_done?: number | null },
  allStages: InputStage[],
  itemQty: number,
  dept: Pick<ErpDepartment, 'allows_over_plan'> | null | undefined,
): number | null {
  if (deptAllowsOverPlan(dept)) return null;
  const total = Math.max(itemQty ?? 0, 0);
  const input = stageInputQty(stage, allStages, itemQty);
  const done = Math.max(stage.qty_done ?? 0, 0);
  return Math.max(Math.max(total, input) - done, 0);
}

/**
 * Почему число не принимается. `null` — принимается.
 *
 * Текст называет ОБА числа: «нельзя больше 100» без объяснения, откуда взялось
 * сто, отправляет человека искать причину по экранам.
 */
export function overPlanBlock(
  qtyGood: number,
  stage: InputStage & { qty_done?: number | null },
  allStages: InputStage[],
  itemQty: number,
  dept: Pick<ErpDepartment, 'allows_over_plan'> | null | undefined,
): string | null {
  const cap = stageQtyCap(stage, allStages, itemQty, dept);
  if (cap === null || qtyGood <= cap) return null;
  const total = Math.max(itemQty ?? 0, 0);
  const ceiling = Math.max(total, stageInputQty(stage, allStages, itemQty));
  return `Больше ${cap} шт сдать нельзя: потолок этапа ${ceiling} шт`
    + (ceiling > total ? ` (закрой передал ${ceiling})` : ` (тираж заказа ${total})`)
    + '. Сверх заказа количество появляется только на закрое.';
}

/**
 * Предупреждение о «плюсе» — для участка, которому превышение РАЗРЕШЕНО.
 * `null` — превышения нет.
 *
 * Решение владельца: потолка у закроя нет, но превышение тиража
 * спрашивает подтверждение с названной разницей. Опечатка «1000» вместо
 * «100» иначе поднимает потолок всем последующим этапам и снимает защиту,
 * ради которой правка делается.
 */
export function overPlanConfirm(
  qtyGood: number,
  stage: Pick<ErpItemStage, 'qty_done'>,
  itemQty: number,
  dept: Pick<ErpDepartment, 'allows_over_plan'> | null | undefined,
): string | null {
  if (!deptAllowsOverPlan(dept)) return null;
  const total = Math.max(itemQty ?? 0, 0);
  const fact = Math.max(stage.qty_done ?? 0, 0) + Math.max(qtyGood, 0);
  if (fact <= total) return null;
  return `Заказ ${total} шт, сдаёте ${fact} шт — плюс ${fact - total} шт.`
    + ' Это количество станет потолком для следующих этапов.';
}
