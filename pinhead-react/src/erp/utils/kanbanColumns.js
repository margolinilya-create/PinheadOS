import { isProductionDept } from '../data/departments';
import { EMPTY_FILTERS, applyStageFilters } from './filterStages';
import { buildQueueEntries } from './queueEntries';

/**
 * Группировка заданий по колонкам-цехам и дорожкам канбана.
 * Колонка = производственный процесс; дорожки: awaiting_materials / ready /
 * in_progress / blocked / done. «Завершено» показываем только последние 5.
 *
 * Порядок дорожек на доске задаёт `LANES` в `ErpKanban`: сверху то, с чем можно
 * работать сейчас, ожидания ниже (правка 23.08, п. 3). Отдельная дорожка
 * `awaiting_materials` появилась правкой менеджера 2026-08-03: заказ,
 * переданный на этап, но не запускаемый из-за материалов, раньше либо не попадал
 * на доску вовсе (`waiting` отбрасывался), либо ехал в «Готово к работе» вместе
 * с ручными блокировками — и понять, что цех стоит из-за снабжения, было нельзя.
 * `blocked` получил свою дорожку по той же причине.
 *
 * С 23.08 в `awaiting_materials` попадает и ожидание ЗАКУПКИ (`isSupplyWait`
 * в `utils/supply`), поэтому такие этапы на доске стали видны: прежде они
 * были `waiting` и отбрасывались, то есть заказ, стоящий из-за снабжения,
 * доска не показывала вовсе.
 *
 * ДОРОЖКА `waiting` ЗАВЕДЕНА 30.08 (правка заказчика, п. 7). До неё
 * `if (col[entry.group])` выбрасывал такой этап МОЛЧА — без дорожки в
 * `byDept` группа просто не находилась. Из-за этого доска и очередь
 * отвечали на «что будет делать цех» по-разному и притом каждая наполовину:
 * в очереди `waiting` был раскрыт, а `awaiting_materials` свёрнут; на доске
 * наоборот — `awaiting_materials` показывался, а `waiting` не показывался
 * вовсе. Заказ по маршруту «Закупка → Закрой → ДТФ → Пошив» был виден
 * в ДТФ (`waiting`) в очереди, но не на доске, а в Закрое
 * (`awaiting_materials`) — на доске, но свёрнутым в очереди. Документ
 * называет это «цех, который стоит раньше в маршруте, не видит будущую
 * работу»; починка нужна была с ОБЕИХ сторон.
 *
 * Отбрасывать группу молча нельзя в принципе: `buildQueueEntries` — единый
 * источник групп, и любая незаведённая здесь дорожка означает исчезнувшую
 * работу без единой ошибки. Сторожит `kanbanColumns.test.js` — он сверяет
 * ПЕРЕЧИСЛЕНИЯ, а не список имён.
 *
 * Порядок внутри дорожки задаёт сортировка фильтров: по умолчанию — приоритет
 * (queue_position, правка 3), поэтому перетаскивание карточки вверх-вниз внутри
 * колонки меняет её место и здесь. Чистая функция — покрыта юнит-тестами;
 * UI (ErpKanban) лишь рендерит результат.
 */
export function buildKanbanColumns(orders, departments, filters = EMPTY_FILTERS, bypasses = []) {
  const deps = departments.filter((d) => d.active && isProductionDept(d));
  const byDept = new Map(deps.map((d) => [
    d.id,
    {
      dept: d,
      waiting: [],
      awaiting_materials: [],
      ready: [],
      in_progress: [],
      blocked: [],
      done: [],
    },
  ]));

  const entries = applyStageFilters(buildQueueEntries(orders, departments, { bypasses }), filters);
  for (const entry of entries) {
    const col = byDept.get(entry.stage.department_id);
    if (!col) continue;
    col[entry.group].push(entry);
  }

  for (const col of byDept.values()) {
    col.done = col.done
      .slice()
      .sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''))
      .slice(0, 5);
  }
  return [...byDept.values()];
}
