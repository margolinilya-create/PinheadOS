import {
  isStageAwaitingProcurement, isStageReady, materialsForItem,
  missingMaterialsForStage, waitingReason,
} from './routes';
import { stageMissingTz } from './tz';
import { bypassFor, isBypassed, materialsAfterBypass } from './bypass';
import { isOutsourced } from './outsourcing';

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
  { departmentId = null, includeInactive = false, bypasses = [] } = {},
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
        /**
         * Подрядный этап в очередь НАШЕГО цеха не попадает: работу делает
         * внешний исполнитель, а цех у этапа означает лишь участок
         * ответственности. Показать такой этап рабочему значило бы дать ему
         * задание, которого он не сделает. Ведётся он в разделе «Подряд».
         */
        if (isOutsourced(stage)) continue;
        const dept = deptById.get(stage.department_id);
        if (!dept) continue;

        const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, stage.id);
        /**
         * Аварийно снятые проверки (правки 10.08) применяются ЗДЕСЬ, а не внутри
         * гейтов: обе величины гейты принимают параметрами, поэтому снятие
         * выражается «нет ТЗ → нет» и «материалов, которые держат → пустой список».
         * Ни одной новой ветки в `isStageReady`/`waitingReason` и ни одного
         * седьмого позиционного аргумента у них.
         */
        const noTz = stageMissingTz(order, item.id, dept)
          && !isBypassed('tz_gate', order.id, bypasses);
        const itemMaterials = materialsAfterBypass(
          materialsForItem(order.materials, item.id), order.id, bypasses);
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

        /**
         * Пометка «проверка снята вручную».
         *
         * Снятая блокировка, о которой цех не знает, — тот же баг, только
         * молчаливый: задание вдруг запускается без материала, и объяснить это
         * нечем. Пометку ставим ТОЛЬКО там, где снятие реально повлияло: считаем
         * готовность ещё раз, по настоящим данным, и сравниваем.
         */
        let bypass = null;
        if (group === 'ready' && (isBypassed('material_gate', order.id, bypasses)
          || isBypassed('tz_gate', order.id, bypasses))) {
          const realTz = stageMissingTz(order, item.id, dept);
          const realMaterials = materialsForItem(order.materials, item.id);
          const readyWithout = isStageReady(
            stage, item.stages, realMaterials, dept, awaitProc, realTz);
          if (!readyWithout) {
            bypass = bypassFor(realTz ? 'tz_gate' : 'material_gate', order.id, bypasses);
          }
        }

        list.push({ order, item, stage, group, reason, missingMaterials, bypass });
      }
    }
  }
  return list;
}
