import {
  isStageAwaitingProcurement, isStageReady, materialsForItem,
  missingMaterialsForStage, waitingReason,
} from './routes';
import { stageMissingTz } from './tz';

/**
 * Задания производства как плоский список: этап позиции + вычисленная группа
 * очереди и человекочитаемая причина ожидания.
 *
 * Единый источник для очереди цеха, канбана и фильтров (правки 2, 4, 9) — раньше
 * очередь и канбан считали группы каждый по-своему и расходились в деталях
 * (например, канбан не показывал причину ожидания).
 *
 * Группы: awaiting_materials — не хватает материалов (со списком, правка менеджера
 * 2026-08-03); ready — можно запускать; in_progress — взято в работу; waiting —
 * ждёт предыдущий этап, ТЗ или закупку (с причиной); blocked — ручная блокировка
 * цехом (со своей причиной); done — завершено.
 *
 * Ожидание материалов вынесено из `waiting` намеренно: «ждём ткань» и «швейка ещё
 * не сдала» требуют разных решений руководителя, и в общей куче их было не разделить.
 */
export function buildQueueEntries(
  orders,
  departments,
  { departmentId = null, includeInactive = false } = {},
) {
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  const list = [];

  for (const order of orders) {
    // Цеху и канбану нужны только активные; производственному плану со снятой
    // галочкой «Только активные» — и архив тоже, иначе его фильтры молча
    // не находили бы сданные заказы.
    if (!includeInactive && order.status !== 'active') continue;
    for (const item of order.items ?? []) {
      for (const stage of item.stages ?? []) {
        if (departmentId && stage.department_id !== departmentId) continue;
        if (stage.status === 'skipped') continue;
        const dept = deptById.get(stage.department_id);
        if (!dept) continue;

        const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, stage.id);
        const noTz = stageMissingTz(order, item.id, dept);
        const itemMaterials = materialsForItem(order.materials, item.id);
        let group = stage.status;
        let reason = null;
        let missingMaterials = [];

        if (stage.status === 'blocked') {
          reason = stage.block_reason || 'Заблокирован цехом';
        } else if (stage.status !== 'done' && stage.status !== 'in_progress') {
          const ready = isStageReady(stage, item.stages, itemMaterials, dept, awaitProc, noTz);
          group = ready ? 'ready' : 'waiting';
          if (!ready) {
            reason = waitingReason(
              stage, item.stages, itemMaterials, deptNameById, dept, awaitProc, noTz);
            // Ожидание материалов — своя группа: список нужен карточке, чтобы
            // показать чего именно ждут, ETA и ответственного
            missingMaterials = missingMaterialsForStage(itemMaterials, dept);
            if (missingMaterials.length > 0) group = 'awaiting_materials';
          }
        }

        list.push({ order, item, stage, group, reason, missingMaterials });
      }
    }
  }
  return list;
}
