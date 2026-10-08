import type { LinearStep } from './routeDraft';

/**
 * ПОВТОРНЫЙ ПРОХОД ЦЕХА — СВОЙ ЦИКЛ (ошибка с боя 07.10).
 *
 * Уникальность этапа в базе — `(item_id, department_id, cycle)` среди наших
 * (`executor = 'internal'`). Маршрут, собранный руками, законно проходит
 * один цех дважды (склад: приёмка изделия перед нанесением и сдача в конце),
 * а новый шаг всегда рождается с циклом 0 — и заказ не создавался вовсе:
 * «duplicate key value violates unique constraint
 * erp_item_stages_item_dept_cycle_key», пять попыток у двух менеджеров.
 *
 * Существующие этапы (`stageId`) свой цикл держат — он уже в базе; новым
 * шагам, чей цикл занят, достаётся наименьший свободный. Подрядные этапы
 * в уникальность не входят и не трогаются. Одна функция на обоих писателей
 * (`createOrder` и `RouteEditor`) — потому и здесь, а не в форме.
 */
export function withUniqueCycles(steps: LinearStep[]): LinearStep[] {
  const used = new Map<string, Set<number>>();
  const taken = (code: string) => {
    if (!used.has(code)) used.set(code, new Set());
    return used.get(code)!;
  };
  const internal = (l: LinearStep) => l.step.executor !== 'contractor';
  for (const l of steps) {
    if (internal(l) && l.step.stageId) taken(l.step.departmentCode).add(l.step.cycle ?? 0);
  }
  return steps.map((l) => {
    if (!internal(l) || l.step.stageId) return l;
    const set = taken(l.step.departmentCode);
    let cycle = Number.isFinite(l.step.cycle) ? l.step.cycle : 0;
    if (set.has(cycle)) {
      cycle = 0;
      while (set.has(cycle)) cycle += 1;
    }
    set.add(cycle);
    return cycle === l.step.cycle ? l : { ...l, step: { ...l.step, cycle } };
  });
}
