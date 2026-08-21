import type { ErpWarehouseTask, WarehouseTaskType } from '../types';

/**
 * ФИНАЛЬНЫЙ ШАГ «СКЛАД» В МАРШРУТЕ ПОЗИЦИИ (решение заказчика 21.08).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. В перечне этапов маршрута «Склад» стоит наравне
 * с цехами: «Закрой — Швейка — Подряд: Варка — ВТО — Склад», а у подряда
 * под ключ маршрут вообще состоит из двух шагов — «Подряд — Склад».
 *
 * ПОЧЕМУ ЭТО НЕ ЭТАП. `erp_item_stages` — очередь ПРОИЗВОДСТВЕННОГО цеха:
 * все общие поверхности (очередь, канбан, план, загрузка) фильтруют цеха по
 * `is_production`, и этап склада не появился бы ни в одной из них. Так 12.08
 * встали 33 заказа: этап был, поверхности его не показывали, заказ пропал
 * из виду целиком. Приёмка ГП, маркировка и упаковка уже живут задачами
 * склада со своим экраном, статусами и правами — второй механизм на то же
 * место был бы той самой вторая сущностью, которую документ запрещает.
 *
 * ПОЭТОМУ ШАГ ВЫЧИСЛЯЕТСЯ. Здесь нет ни хранения, ни записи: состояние
 * читается из задач склада заказа. Маршрут перестаёт обрываться на ВТО —
 * человек видит, что работа продолжается и где именно она стоит.
 *
 * ШАГ ПРИНАДЛЕЖИТ ЗАКАЗУ, А НЕ ПОЗИЦИИ, и это честно: упаковка и отгрузка
 * идут по заказу целиком (`pack_ship` заводится один на заказ). Показывать
 * его в маршруте каждой позиции правильно — судьба у них общая.
 */

/** Задачи склада, из которых складывается финальный шаг маршрута */
const STEP_TASKS: WarehouseTaskType[] = ['fg_receipt', 'marking', 'pack_ship'];

/** Состояние шага — те же слова, что у этапов цеха: человек читает один язык */
export type WarehouseStepState = 'waiting' | 'in_progress' | 'done';

export interface WarehouseStep {
  state: WarehouseStepState;
  /** Что именно происходит на складе сейчас: «Упаковка», «Ожидает приёмки ГП» */
  label: string;
  /** Отгружен ли заказ — терминальное состояние всего маршрута */
  shipped: boolean;
}

const IN_PROGRESS: Partial<Record<WarehouseTaskType, string[]>> = {
  marking: ['in_progress'],
  pack_ship: ['accepted', 'packing', 'packed', 'ready_to_ship'],
};

const TERMINAL: Partial<Record<WarehouseTaskType, string[]>> = {
  fg_receipt: ['accepted'],
  marking: ['issued'],
  pack_ship: ['shipped'],
};

/** Подпись задачи в работе — по типу, а не по статусу: складу важно ЧТО делают */
const LABEL: Record<string, string> = {
  fg_receipt: 'Приёмка готовой продукции',
  marking: 'Маркировка',
  pack_ship: 'Упаковка и отгрузка',
};

/**
 * Состояние финального шага по задачам склада заказа.
 *
 * `shipped_at` заказа сильнее любых задач: отгруженный заказ закрыт, даже если
 * какая-то задача осталась незакрытой руками. Обратное неверно — «нет задач»
 * не означает «готово»: их заводят триггеры по мере закрытия производства,
 * и до первой задачи шаг просто ждёт.
 */
export function warehouseStep(order: {
  shipped_at?: string | null;
  warehouse_tasks?: ErpWarehouseTask[] | null;
}): WarehouseStep {
  if (order.shipped_at) {
    return { state: 'done', label: 'Отгружено', shipped: true };
  }

  const tasks = (order.warehouse_tasks ?? []).filter(
    (t) => STEP_TASKS.includes(t.task_type),
  );
  if (tasks.length === 0) {
    return { state: 'waiting', label: 'Ожидает производство', shipped: false };
  }

  // Порядок задач на складе: приёмка → маркировка → упаковка. Показываем
  // ПЕРВУЮ незакрытую — она и есть то, чем склад занят или что ждёт
  const order_ = [...tasks].sort(
    (a, b) => STEP_TASKS.indexOf(a.task_type) - STEP_TASKS.indexOf(b.task_type),
  );
  const open = order_.find(
    (t) => !(TERMINAL[t.task_type] ?? []).includes(t.status),
  );
  if (!open) {
    return { state: 'done', label: 'Склад закрыл заказ', shipped: false };
  }

  const working = (IN_PROGRESS[open.task_type] ?? []).includes(open.status);
  return {
    state: working ? 'in_progress' : 'waiting',
    label: working ? LABEL[open.task_type] : `Ожидает: ${LABEL[open.task_type].toLowerCase()}`,
    shipped: false,
  };
}
