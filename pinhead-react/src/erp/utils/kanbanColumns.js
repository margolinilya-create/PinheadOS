import { isProductionDept } from '../data/departments';
import { EMPTY_FILTERS, applyStageFilters } from './filterStages';
import { buildQueueEntries } from './queueEntries';

/**
 * Группировка заданий по колонкам-цехам и дорожкам канбана.
 * Колонка = производственный процесс; дорожки: ready / in_progress / blocked / done.
 * «Завершено» показываем только последние 5 (по finished_at).
 *
 * Порядок внутри дорожки задаёт сортировка фильтров: по умолчанию — приоритет
 * (queue_position, правка 3), поэтому перетаскивание карточки вверх-вниз внутри
 * колонки меняет её место и здесь. Чистая функция — покрыта юнит-тестами;
 * UI (ErpKanban) лишь рендерит результат.
 */
export function buildKanbanColumns(orders, departments, filters = EMPTY_FILTERS) {
  const deps = departments.filter((d) => d.active && isProductionDept(d));
  const byDept = new Map(deps.map((d) => [
    d.id,
    { dept: d, ready: [], in_progress: [], blocked: [], done: [] },
  ]));

  const entries = applyStageFilters(buildQueueEntries(orders, departments), filters);
  for (const entry of entries) {
    const col = byDept.get(entry.stage.department_id);
    if (!col) continue;
    // waiting (ещё не готово к запуску) на доске не показываем — это очередь цеха
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
