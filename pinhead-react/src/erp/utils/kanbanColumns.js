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
 * Порядок внутри дорожки задаёт сортировка фильтров: по умолчанию — приоритет
 * (queue_position, правка 3), поэтому перетаскивание карточки вверх-вниз внутри
 * колонки меняет её место и здесь. Чистая функция — покрыта юнит-тестами;
 * UI (ErpKanban) лишь рендерит результат.
 */
export function buildKanbanColumns(orders, departments, filters = EMPTY_FILTERS, bypasses = []) {
  const deps = departments.filter((d) => d.active && isProductionDept(d));
  const byDept = new Map(deps.map((d) => [
    d.id,
    { dept: d, awaiting_materials: [], ready: [], in_progress: [], blocked: [], done: [] },
  ]));

  const entries = applyStageFilters(buildQueueEntries(orders, departments, { bypasses }), filters);
  for (const entry of entries) {
    const col = byDept.get(entry.stage.department_id);
    if (!col) continue;
    // waiting (ждёт предыдущий этап или ТЗ) на доске не показываем — это очередь цеха
    if (col[entry.group]) col[entry.group].push(entry);
  }

  for (const col of byDept.values()) {
    col.done = col.done
      .slice()
      .sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''))
      .slice(0, 5);
  }
  return [...byDept.values()];
}
