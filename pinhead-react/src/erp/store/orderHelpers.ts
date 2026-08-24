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
// Маленький чистый маппинг фаз. Правило «утилиты волны 3 не тянуть в оболочку»
// касается тяжёлых модулей: копия этого switch здесь была бы вторым источником
// правды ровно того рода, из-за которого фаза и разъехалась со статусом.
import { isSubcontractTerminal, subcontractPhase } from '../utils/subcontractPhase';
// Модуль-лист без зависимостей: закупка как этап маршрута считается ОДИН раз
// и одинаково в бейдже меню, на экране закупки и в автозакрытии
import { ordersAwaitingSupply } from '../utils/supply';
// Подрядный этап не работа нашего цеха: правило одно на весь проект
import { isOutsourced } from '../utils/outsourcing';
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
    prints:erp_item_prints (*),
    labels:erp_item_labels (*)
  ),
  materials:erp_materials (*, suppliers:erp_material_suppliers (*)),
  attachments:erp_order_attachments (*),
  procurement_tasks:erp_procurement_tasks (*),
  warehouse_ops:erp_warehouse_ops (*),
  warehouse_tasks:erp_warehouse_tasks (*),
  tz_documents:erp_tz_documents (*),
  notes_list:erp_order_notes (*)
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
 * Технический блок позиции (`fit`, `trim_material`, `cutting_note`,
 * `sewing_note`, `labels_note`, упаковка) в списке ЕСТЬ,
 * хотя это и новые поля: их читает `screens/queue/TzBlock` — структурное ТЗ
 * в строке очереди цеха, то есть самый списочный из экранов. Без них цех
 * увидел бы пустой техблок там, где данные заполнены, и ошибку никто бы
 * не заметил: поле просто приезжает `undefined`.
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
 *
 * Бирки (`labels`) и основная ткань (`main_fabric`) — правка 22.08 — в списке
 * ЕСТЬ по той же причине, что техблок: их читает `screens/queue/TzBlock`,
 * структурное ТЗ в строке очереди цеха. Колонка, не попавшая сюда, приезжает
 * `undefined` МОЛЧА, без единой ошибки — на этом в проекте уже ловились
 * с `executor`.
 *
 * Комментариев ВНУТРИ строки выборки быть не может: это текст запроса
 * PostgREST, а не код (и обратный апостроф в нём закрывает шаблонную строку).
 */
export const ORDER_LIST_SELECT = `
  *,
  items:erp_order_items (
    id, order_id, product_type, variant, qty, production_type,
    branding_methods, branding_on, notes, sort_order,
    subcontract_kind, material_source,
    fit, main_fabric, trim_material, cutting_note, sewing_note, labels_note,
    packaging, packaging_size, sticker_place, marking_place, packaging_note,
    stages:erp_item_stages (
      id, item_id, department_id, depends_on, status, qty_done, qty_rework,
      planned_start, planned_end, started_at, finished_at, assignee,
      block_reason, sort_order, updated_at, overdue_comment, overdue_ack_at,
      queue_position, cycle, origin,
      executor, contractor, operation
    ),
    prints:erp_item_prints (*),
    labels:erp_item_labels (*)
  ),
  materials:erp_materials (*, suppliers:erp_material_suppliers (*)),
  attachments:erp_order_attachments (*),
  procurement_tasks:erp_procurement_tasks (*),
  warehouse_ops:erp_warehouse_ops (*),
  warehouse_tasks:erp_warehouse_tasks (*),
  tz_documents:erp_tz_documents (*),
  notes_list:erp_order_notes (*)
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
        if (stage.department_id === departmentId && stage.status !== 'skipped'
            && !isOutsourced(stage)) {
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
        if (isOutsourced(st)) continue;
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
        if (isOutsourced(st)) continue;
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
        if (isOutsourced(st)) continue;
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
/**
 * Терминальные статусы складских задач для бейджа меню.
 *
 * Это ВТОРАЯ такая таблица (первая — в `Warehouse.jsx`), и `fg_receipt` в неё
 * не вписали при вводе приёмки готовой продукции: сравнение с `undefined`
 * считало принятую приёмку вечно открытой, и бейдж «Склад» не гас никогда —
 * ровно то последствие, о котором предупреждает миграция 20260810220000.
 * Сторожит `warehouseTaskTypes.test.ts`, читающий ОБА файла.
 */
const WAREHOUSE_TERMINAL: Record<string, string> = {
  material_receipt: 'accepted',
  subcontract_send: 'sent',
  subcontract_receipt: 'accepted',
  fg_receipt: 'accepted',
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

/**
 * Работы у закупки — бейдж «Закупка».
 *
 * Считаются ДВЕ разные вещи, и обе обязаны попадать на бейдж:
 *  · заказы с открытым этапом «Закупка» — основная работа участка;
 *  · открытые задачи дозакупки и замены (заводятся из брака).
 *
 * Раньше считалось только второе. Дозакупка бывает редко, а закупка первым
 * этапом маршрута — постоянно, поэтому пункт меню молчал ровно тогда, когда
 * работа там была: 33 заказа на боевой базе стояли, и бейдж показывал ноль.
 *
 * `departments` — параметр, а не поиск по коду внутри: цех берётся из данных
 * (`utils/supply.findSupplyDept`), и обойтись без справочника нельзя.
 */
export function openProcurementCount(
  orders: ErpOrderFull[],
  departments: ErpDepartment[] | null | undefined = null,
): number {
  let n = ordersAwaitingSupply(orders, departments).length;
  for (const o of orders) {
    if (o.status !== 'active') continue;
    for (const t of o.procurement_tasks ?? []) {
      if (t.status !== 'done' && t.status !== 'cancelled') n += 1;
    }
  }
  return n;
}

/**
 * Незакрытых операций подряда (вещь ещё у подрядчика) — бейдж «Подряд».
 *
 * Считается по ФАЗЕ: прежде здесь стоял устаревший `status`, который после
 * волны 3.5 перестал быть тем, чем двигают операцию. Набор терминальных
 * значений сохранён один в один (вернулось / принято / закрыто), поэтому
 * число на бейдже не меняется — меняется колонка, из которой оно берётся.
 */
export function openSubcontractCount(
  subcontracting: { phase?: string | null; status?: string | null }[],
): number {
  return subcontracting.filter((o) => !isSubcontractTerminal(subcontractPhase(o))).length;
}

/**
 * Активных разработок — бейдж «Эксперим. цех».
 *
 * Считается по ИСХОДУ, а не по фазе: фазы заменены задачами (ТЗ 12.08),
 * и `phase` осталась мёртвой колонкой до уборочной миграции. Разработка
 * активна, пока по ней не принято финальное решение; «что происходит сейчас»
 * вычисляется из задач и на бейдж не влияет — там нужно одно число.
 */
export function activeExperimentalCount(
  experimental: { outcome?: string | null }[],
): number {
  return experimental.filter((e) => !e.outcome).length;
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
