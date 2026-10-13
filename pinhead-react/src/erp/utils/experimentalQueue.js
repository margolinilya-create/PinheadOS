import { buildQueueEntries } from './queueEntries';
import { EXPERIMENTAL_DEPT_CODE } from './routeDraft';

/**
 * Открытые задания УЧАСТКА «Экспериментальный цех» (правка 24.08, п. 4.1).
 *
 * Отдельный модуль, потому что читателей двое и вопрос у них разный:
 * вид «Очередь участка» рисует строки, а сам экран решает, показывать ли
 * переключатель видов вообще. Разойдись эти два ответа — переключатель
 * пропал бы ровно тогда, когда очередь не пуста, и до заданий было бы
 * не добраться. Такой отказ уже случался: экран существовал, назывался
 * правильно и прятал заказ целиком.
 */

/** Группы, отвечающие на вопрос «что делать»: закрытые в очередь не идут */
const OPEN_GROUPS = new Set(
  ['blocked', 'awaiting_materials', 'waiting', 'ready', 'in_progress']);

export function experimentalDept(departments) {
  return (departments ?? []).find((d) => d.code === EXPERIMENTAL_DEPT_CODE) ?? null;
}

/**
 * Строки очереди участка. БЕЗ отбора по `origin`, в отличие от очередей
 * нанесений: документ ставит участок в маршрут обычного заказа, и фильтр
 * «только образцы» скрыл бы ровно то, ради чего пункт и написан.
 */
export function experimentalDeptEntries(orders, departments) {
  const dept = experimentalDept(departments);
  if (!dept) return [];
  // `?? []`: `buildQueueEntries` перебирает заказы напрямую и на `null`
  // бросает. Экран зовёт эту функцию и до загрузки — падать там нечему,
  // но полагаться на то, что стор всегда успел, значит однажды получить
  // белый экран вместо пустой очереди
  return buildQueueEntries(orders ?? [], departments, { departmentId: dept.id })
    .filter((e) => OPEN_GROUPS.has(e.group));
}
