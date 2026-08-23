import {
  isStageAwaitingProcurement, isStageReady, materialsForItem,
  missingMaterialsForStage, waitingReason,
} from './routes';
import { stageMissingTz } from './tz';
import { bypassFor, isBypassed, materialsAfterBypass } from './bypass';
import { isOutsourced } from './outsourcing';
import { findSupplyDept, isSupplyWait } from './supply';

/**
 * Задания производства как плоский список: этап позиции + вычисленная группа
 * очереди и человекочитаемая причина ожидания.
 *
 * Единый источник для очереди цеха, канбана и фильтров (правки 2, 4, 9) — раньше
 * очередь и канбан считали группы каждый по-своему и расходились в деталях
 * (например, канбан не показывал причину ожидания).
 *
 * Группы: awaiting_materials — ждём СНАБЖЕНИЕ; ready — можно запускать;
 * in_progress — взято в работу; waiting — ждём ПРОИЗВОДСТВО (предыдущий цех
 * или ТЗ, с причиной); blocked — ручная блокировка цехом (со своей причиной);
 * done — завершено.
 *
 * ГРАНИЦА МЕЖДУ ДВУМЯ ОЖИДАНИЯМИ — ПРИЧИНА, А НЕ ЦЕХ (правки 23.08, пп. 2 и 3).
 * Считает её `isSupplyWait` (`utils/supply`), и там же объяснено, почему это
 * единственный способ исполнить оба пункта документа сразу: у закроя они
 * требуют объединить ожидания, у швейки — оставить разными, а экран очереди
 * один на все участки.
 *
 * До 23.08 в `awaiting_materials` попадала только нехватка материалов, а
 * «Закупка: ещё не завершено» оставалась в `waiting` — из-за этого у закроя
 * и было ДВЕ группы ожидания об одном и том же снабжении.
 */
export function buildQueueEntries(
  orders,
  departments,
  { departmentId = null, includeInactive = false, bypasses = [] } = {},
) {
  const deptById = new Map(departments.map((d) => [d.id, d]));
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));
  // Участок закупки — из справочника: код `supply` живёт только в utils/supply
  const supplyDeptId = findSupplyDept(departments)?.id ?? null;
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
            // Список нужен карточке — показать, чего именно ждут, ETA и ответственного
            missingMaterials = missingMaterialsForStage(itemMaterials, dept);
            /**
             * Ожидание снабжения — своя группа: «ждём ткань» и «швейка ещё
             * не сдала» требуют разных решений руководителя. Внутрь входит
             * и ожидание самой закупки — до 23.08 оно оставалось в `waiting`
             * и давало закрою две группы об одном и том же.
             */
            if (isSupplyWait({
              missingMaterials,
              awaitingProcurement: awaitProc,
              stage,
              itemStages: item.stages ?? [],
              supplyDeptId,
            })) group = 'awaiting_materials';
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
