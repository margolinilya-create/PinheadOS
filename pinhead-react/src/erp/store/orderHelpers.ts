/**
 * Чистые хелперы ERP-стора, общие для нескольких слайсов (рефакторинг по плану аудита).
 * Вынесены из useErpStore.ts, чтобы слайсы (orders/stages/realtime) переиспользовали их
 * без циклического импорта. Реэкспорт публичных (readyCountFor/orderPreviewUrl/
 * lastDefectPhotoUrl) — в useErpStore.ts, где их ждут экраны и тесты.
 */

import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { isStageReady, isStageAwaitingProcurement, materialsForItem } from '../utils/routes';
import { isBypassed, materialsAfterBypass } from '../utils/bypass';
import { stageMissingTz } from '../utils/tz';
import { stageOverdue } from '../utils/time';
import type { ErpBypass, ErpDepartment, ErpItemStage } from '../types';
import type { ErpOrderFull } from './types';

/**
 * ПОЛНЫЙ заказ: позиции+этапы+принты, материалы, вложения, задачи закупки.
 * Используется только `loadOne` — карточкой заказа и страницей задания.
 */
export const ORDER_SELECT = `
  *,
  items:erp_order_items (
    *,
    stages:erp_item_stages (*),
    prints:erp_item_prints (*)
  ),
  materials:erp_materials (*, suppliers:erp_material_suppliers (*)),
  attachments:erp_order_attachments (*),
  procurement_tasks:erp_procurement_tasks (*),
  warehouse_ops:erp_warehouse_ops (*),
  warehouse_tasks:erp_warehouse_tasks (*),
  tz_documents:erp_tz_documents (*)
`;

/**
 * СПИСОЧНЫЙ заказ — то же дерево, но без колонок, которые нужны только карточке.
 *
 * `select *` в PostgREST отдаёт и NULL-колонки: имя ключа едет по проводу всегда.
 * На 405 этапах это заметно, а растёт линейно с числом заказов. Замерено на проде:
 * полный ответ активных заказов — 391 кБ, этот — 351 кБ (−10%), при 300 заказах
 * 1.5 МБ против 1.39 МБ.
 *
 * Убрано ровно то, что не читает НИ ОДИН списочный экран:
 *   · `stages.notes` — не отображается нигде вообще;
 *   · `stages.created_at`, `items.created_at/updated_at` — тоже никем не читаются
 *     (`stages.updated_at` ЧИТАЕТСЯ карточкой канбана и остаётся);
 *   · `items.size_grid` — размерная сетка, её рисует только карточка заказа.
 *
 * Что осталось и почему: `overdue_comment` показывает карточка очереди,
 * `procurement_tasks` нужны причине ожидания, `tz_documents` — гейту ТЗ,
 * `materials` — материальному гейту. Отношения `attachments`/`warehouse_*`/
 * `suppliers` перебирают экраны склада, подряда и закупки по ВСЕМ заказам,
 * поэтому из списка они не выброшены: это дало бы ещё 14%, но сломало бы
 * три экрана — переносить их на свои запросы надо отдельной работой.
 *
 * Карточка заказа обязана дозагрузить полный заказ (`loadOne`) — иначе размерная
 * сетка не отрисуется. За этим следит `detailIds` в сторе.
 */
export const ORDER_LIST_SELECT = `
  *,
  items:erp_order_items (
    id, order_id, product_type, variant, qty, production_type,
    branding_methods, branding_on, notes, sort_order,
    subcontract_kind, material_source,
    stages:erp_item_stages (
      id, item_id, department_id, depends_on, status, qty_done, qty_rework,
      planned_start, planned_end, started_at, finished_at, assignee,
      block_reason, sort_order, updated_at, overdue_comment, overdue_ack_at,
      queue_position, cycle, origin
    ),
    prints:erp_item_prints (*)
  ),
  materials:erp_materials (*, suppliers:erp_material_suppliers (*)),
  attachments:erp_order_attachments (*),
  procurement_tasks:erp_procurement_tasks (*),
  warehouse_ops:erp_warehouse_ops (*),
  warehouse_tasks:erp_warehouse_tasks (*),
  tz_documents:erp_tz_documents (*)
`;

/** Сортировка позиций и этапов по sort_order + дефолты для вложенных массивов */
export function sortOrderFull(o: ErpOrderFull): ErpOrderFull {
  return {
    ...o,
    items: [...(o.items ?? [])]
      .map((it) => ({
        ...it,
        stages: [...(it.stages ?? [])].sort((a, b) => a.sort_order - b.sort_order),
      }))
      .sort((a, b) => a.sort_order - b.sort_order),
    materials: o.materials ?? [],
    procurement_tasks: o.procurement_tasks ?? [],
    warehouse_ops: o.warehouse_ops ?? [],
    warehouse_tasks: o.warehouse_tasks ?? [],
    tz_documents: o.tz_documents ?? [],
  };
}

/** Найти этап по id вместе с позицией и заказом */
export function findStage(
  orders: ErpOrderFull[],
  stageId: string,
): { order: ErpOrderFull; item: ErpOrderFull['items'][number]; stage: ErpItemStage } | null {
  for (const order of orders) {
    for (const item of order.items) {
      const stage = item.stages.find((s) => s.id === stageId);
      if (stage) return { order, item, stage };
    }
  }
  return null;
}

/**
 * Точечный патч этапа: пересоздаются ТОЛЬКО заказ/позиция с этим этапом,
 * остальные заказы сохраняют объектную идентичность (критично для ререндеров).
 */
export function patchStageIn(
  orders: ErpOrderFull[],
  stageId: string,
  patch: Partial<ErpItemStage>,
): ErpOrderFull[] {
  return orders.map((order) => {
    if (!order.items.some((it) => it.stages.some((st) => st.id === stageId))) return order;
    return {
      ...order,
      items: order.items.map((it) =>
        it.stages.some((st) => st.id === stageId)
          ? {
              ...it,
              stages: it.stages.map((st) => (st.id === stageId ? { ...st, ...patch } : st)),
            }
          : it),
    };
  });
}

/** Добавить этап в позицию (перенос между цехами создал недостающий этап маршрута) */
export function addStageIn(
  orders: ErpOrderFull[],
  itemId: string,
  stage: ErpItemStage,
): ErpOrderFull[] {
  return orders.map((order) => {
    if (!order.items.some((it) => it.id === itemId)) return order;
    return {
      ...order,
      items: order.items.map((it) =>
        it.id === itemId
          ? { ...it, stages: [...it.stages, stage].sort((a, b) => a.sort_order - b.sort_order) }
          : it),
    };
  });
}

/**
 * Все этапы цеха среди активных заказов в порядке очереди
 * (ручной приоритет, затем срок клиента) — для перенумерации приоритетов.
 */
export function stagesInDept(
  orders: ErpOrderFull[],
  departmentId: string,
): { stage: ErpItemStage; order: ErpOrderFull }[] {
  const rows: { stage: ErpItemStage; order: ErpOrderFull }[] = [];
  for (const order of orders) {
    if (order.status !== 'active') continue;
    for (const item of order.items) {
      for (const stage of item.stages) {
        if (stage.department_id === departmentId && stage.status !== 'skipped') {
          rows.push({ stage, order });
        }
      }
    }
  }
  return rows.sort((a, b) => {
    const pa = a.stage.queue_position;
    const pb = b.stage.queue_position;
    if (pa != null && pb != null && pa !== pb) return pa - pb;
    if (pa != null && pb == null) return -1;
    if (pa == null && pb != null) return 1;
    return (a.order.due_date || '9999-12-31').localeCompare(b.order.due_date || '9999-12-31');
  });
}

/** Сколько работ «готово/в работе» в цехе — для уведомления и бейджа «Мой цех» */
export function readyCountFor(
  orders: ErpOrderFull[],
  departments: ErpDepartment[],
  deptCode: string,
  bypasses: ErpBypass[] = [],
): number {
  const dept = departments.find((d) => d.code === deptCode);
  if (!dept) return 0;
  let n = 0;
  for (const o of orders) {
    if (o.status !== 'active') continue;
    for (const it of o.items) {
      for (const st of it.stages) {
        if (st.department_id !== dept.id) continue;
        if (st.status === 'in_progress') n += 1;
        else if (
          st.status === 'waiting' &&
          isStageReady(
            st, it.stages,
            // Снятая проверка (правки 10.08) обязана считаться ТАК ЖЕ, как в очереди:
            // иначе бейдж цеха разойдётся со списком заданий под ним
            materialsAfterBypass(materialsForItem(o.materials, it.id), o.id, bypasses), dept,
            isStageAwaitingProcurement(o.procurement_tasks, st.id),
            stageMissingTz(o, it.id, dept) && !isBypassed('tz_gate', o.id, bypasses),
          )
        ) n += 1;
      }
    }
  }
  return n;
}

/**
 * Сколько работ ТОЛЬКО «готово к работе» (ready, без in_progress) в цехе — для бейджа вкладки
 * цеха и «Мой цех». Совпадает с группой «Готово к работе» в очереди, поэтому убывает при «Взять
 * в работу» (ERP-06). readyCountFor (ready+in_progress) оставлен для уведомления о новой работе.
 */
export function readyOnlyCountFor(
  orders: ErpOrderFull[],
  departments: ErpDepartment[],
  deptCode: string,
  bypasses: ErpBypass[] = [],
): number {
  const dept = departments.find((d) => d.code === deptCode);
  if (!dept) return 0;
  let n = 0;
  for (const o of orders) {
    if (o.status !== 'active') continue;
    for (const it of o.items) {
      for (const st of it.stages) {
        if (st.department_id !== dept.id) continue;
        if (
          st.status === 'waiting' &&
          isStageReady(
            st, it.stages,
            // Снятая проверка (правки 10.08) обязана считаться ТАК ЖЕ, как в очереди:
            // иначе бейдж цеха разойдётся со списком заданий под ним
            materialsAfterBypass(materialsForItem(o.materials, it.id), o.id, bypasses), dept,
            isStageAwaitingProcurement(o.procurement_tasks, st.id),
            stageMissingTz(o, it.id, dept) && !isBypassed('tz_gate', o.id, bypasses),
          )
        ) n += 1;
      }
    }
  }
  return n;
}

/** Сколько в цехе необработанных просрочек (правка 8): planned_end истёк и нет ack */
export function overdueUnackCountFor(orders: ErpOrderFull[], departments: ErpDepartment[], deptCode: string): number {
  const dept = departments.find((d) => d.code === deptCode);
  if (!dept) return 0;
  let n = 0;
  for (const o of orders) {
    if (o.status !== 'active') continue;
    for (const it of o.items) {
      for (const st of it.stages) {
        if (st.department_id !== dept.id) continue;
        if (stageOverdue(st.planned_end, st.status) && !st.overdue_ack_at) n += 1;
      }
    }
  }
  return n;
}

/** Активных заказов (status='active') — счётчик раздела «Заказы»/«Производство» */
export function activeOrdersCount(orders: ErpOrderFull[]): number {
  return orders.filter((o) => o.status === 'active').length;
}

/** Терминальный статус задачи склада по типу (не считается «открытой») */
const WAREHOUSE_TERMINAL: Record<string, string> = {
  material_receipt: 'accepted',
  subcontract_receipt: 'accepted',
  marking: 'issued',
  pack_ship: 'shipped',
};

/** Открытых задач склада (не в терминальном статусе) у активных заказов — бейдж «Склад» */
export function openWarehouseTaskCount(orders: ErpOrderFull[]): number {
  let n = 0;
  for (const o of orders) {
    if (o.status !== 'active') continue;
    for (const t of o.warehouse_tasks ?? []) {
      if (t.status !== WAREHOUSE_TERMINAL[t.task_type]) n += 1;
    }
  }
  return n;
}

/** Открытых задач закупки (дозакупка/замена, не done/cancelled) у активных заказов — бейдж «Закупка» */
export function openProcurementCount(orders: ErpOrderFull[]): number {
  let n = 0;
  for (const o of orders) {
    if (o.status !== 'active') continue;
    for (const t of o.procurement_tasks ?? []) {
      if (t.status !== 'done' && t.status !== 'cancelled') n += 1;
    }
  }
  return n;
}

/** Незакрытых операций подряда (у подрядчика: не возвращено/принято/отменено) — бейдж «Подряд» */
export function openSubcontractCount(subcontracting: { status: string }[]): number {
  const terminal = new Set(['received_at_pinhead', 'cancelled', 'returned']);
  return subcontracting.filter((o) => !terminal.has(o.status)).length;
}

/** Активных разработок в эксперим. цехе (фаза ≠ done) — бейдж «Эксперим. цех» */
export function activeExperimentalCount(experimental: { phase: string }[]): number {
  return experimental.filter((e) => e.phase !== 'done').length;
}

/**
 * Обёртка применения realtime-изменений: если после них в цехе пользователя
 * прибавилось работ «готово/в работе» — уведомляем (как раньше при loadAll).
 */
export function withNewWorkToast(
  get: () => { orders: ErpOrderFull[]; departments: ErpDepartment[]; bypasses?: ErpBypass[] },
  apply: () => void | Promise<unknown>,
): Promise<void> {
  const myDept =
    typeof localStorage !== 'undefined' ? localStorage.getItem('erp_my_dept') : null;
  const before = myDept
    ? readyCountFor(get().orders, get().departments, myDept, get().bypasses ?? [])
    : 0;
  return Promise.resolve(apply()).then(() => {
    if (!myDept) return;
    const after = readyCountFor(get().orders, get().departments, myDept, get().bypasses ?? []);
    if (after > before) toast.success('В вашем цехе появилась новая работа');
  });
}

/** Публичный URL превью заказа (первое вложение kind=preview) */
export function orderPreviewUrl(order: ErpOrderFull): string | null {
  const att = order.attachments?.find((a) => a.kind === 'preview');
  if (!att) return null;
  return supabase.storage.from('erp-attachments').getPublicUrl(att.file_path).data.publicUrl;
}

/** URL последнего фото брака заказа (вложение с префиксом «Брак:») */
export function lastDefectPhotoUrl(order: ErpOrderFull): string | null {
  const atts = (order.attachments ?? []).filter(
    (a) => a.kind === 'attachment' && (a.file_name ?? '').startsWith('Брак:'));
  if (atts.length === 0) return null;
  const att = atts[atts.length - 1];
  return supabase.storage.from('erp-attachments').getPublicUrl(att.file_path).data.publicUrl;
}
