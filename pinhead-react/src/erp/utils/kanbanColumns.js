import { isStageReady } from './routes';
import { isQueueDept } from '../data/departments';

/**
 * Группировка этапов активных заказов по цехам и дорожкам канбана.
 * Колонка = очередной цех; дорожки: ready/in_progress/blocked/done.
 * «Завершено» показываем только последние 5 (по finished_at). Чистая функция —
 * покрыта юнит-тестами; UI (ErpKanban) лишь рендерит результат.
 */
export function buildKanbanColumns(orders, departments) {
  const deps = departments.filter((d) => d.active && isQueueDept(d.code));
  const byDept = new Map(deps.map((d) => [d.id, { dept: d, ready: [], in_progress: [], blocked: [], done: [] }]));
  for (const order of orders) {
    if (order.status !== 'active') continue;
    for (const item of order.items) {
      for (const stage of item.stages) {
        const col = byDept.get(stage.department_id);
        if (!col) continue;
        const entry = { order, item, stage };
        if (stage.status === 'in_progress') col.in_progress.push({ ...entry, group: 'in_progress' });
        else if (stage.status === 'blocked') col.blocked.push({ ...entry, group: 'blocked' });
        else if (stage.status === 'done') col.done.push({ ...entry, group: 'done' });
        else if (
          stage.status === 'waiting' &&
          isStageReady(stage, item.stages, order.materials, col.dept.code)
        ) col.ready.push({ ...entry, group: 'ready' });
      }
    }
  }
  const byDue = (a, b) => (a.order.due_date || '9999').localeCompare(b.order.due_date || '9999');
  for (const col of byDept.values()) {
    col.ready.sort(byDue);
    col.in_progress.sort(byDue);
    col.done.sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''));
    col.done = col.done.slice(0, 5);
  }
  return [...byDept.values()];
}
