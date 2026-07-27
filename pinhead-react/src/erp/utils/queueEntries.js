import { isStageAwaitingProcurement, isStageReady, waitingReason } from './routes';
import { stageMissingTz } from './tz';

/**
 * Задания производства как плоский список: этап позиции + вычисленная группа
 * очереди и человекочитаемая причина ожидания.
 *
 * Единый источник для очереди цеха, канбана и фильтров (правки 2, 4, 9) — раньше
 * очередь и канбан считали группы каждый по-своему и расходились в деталях
 * (например, канбан не показывал причину ожидания).
 *
 * Группы: ready — можно запускать; in_progress — взято в работу; waiting — ждёт
 * зависимости или материалы (с причиной); blocked — ручная блокировка цехом
 * (со своей причиной); done — завершено.
 */
export function buildQueueEntries(orders, departments, { departmentId = null } = {}) {
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  const list = [];

  for (const order of orders) {
    if (order.status !== 'active') continue;
    for (const item of order.items ?? []) {
      for (const stage of item.stages ?? []) {
        if (departmentId && stage.department_id !== departmentId) continue;
        if (stage.status === 'skipped') continue;
        const dept = deptById.get(stage.department_id);
        if (!dept) continue;

        const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, stage.id);
        const noTz = stageMissingTz(order, item.id, stage.department_id, dept);
        let group = stage.status;
        let reason = null;

        if (stage.status === 'blocked') {
          reason = stage.block_reason || 'Заблокирован цехом';
        } else if (stage.status !== 'done' && stage.status !== 'in_progress') {
          const ready = isStageReady(
            stage, item.stages, order.materials, dept.code, awaitProc, noTz);
          group = ready ? 'ready' : 'waiting';
          if (!ready) {
            reason = waitingReason(
              stage, item.stages, order.materials, deptNameById, dept.code, awaitProc, noTz);
          }
        }

        list.push({ order, item, stage, group, reason });
      }
    }
  }
  return list;
}
