/**
 * Чистые хелперы ERP-стора, общие для нескольких слайсов (рефакторинг по плану аудита).
 * Вынесены из useErpStore.ts, чтобы слайсы (orders/stages/realtime) переиспользовали их
 * без циклического импорта. Реэкспорт публичных (readyCountFor/orderPreviewUrl/
 * lastDefectPhotoUrl) — в useErpStore.ts, где их ждут экраны и тесты.
 */

import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { isStageReady, isStageAwaitingProcurement } from '../utils/routes';
import type { ErpDepartment, ErpItemStage } from '../types';
import type { ErpOrderFull } from './types';

/** Вложенный select заказа: позиции+этапы+принты, материалы, вложения, задачи закупки */
export const ORDER_SELECT = `
  *,
  items:erp_order_items (
    *,
    stages:erp_item_stages (*),
    prints:erp_item_prints (*)
  ),
  materials:erp_materials (*),
  attachments:erp_order_attachments (*),
  procurement_tasks:erp_procurement_tasks (*)
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

/** Сколько работ «готово/в работе» в цехе — для уведомления и бейджа «Мой цех» */
export function readyCountFor(orders: ErpOrderFull[], departments: ErpDepartment[], deptCode: string): number {
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
            st, it.stages, o.materials, deptCode,
            isStageAwaitingProcurement(o.procurement_tasks, st.id),
          )
        ) n += 1;
      }
    }
  }
  return n;
}

/**
 * Обёртка применения realtime-изменений: если после них в цехе пользователя
 * прибавилось работ «готово/в работе» — уведомляем (как раньше при loadAll).
 */
export function withNewWorkToast(
  get: () => { orders: ErpOrderFull[]; departments: ErpDepartment[] },
  apply: () => void | Promise<unknown>,
): Promise<void> {
  const myDept =
    typeof localStorage !== 'undefined' ? localStorage.getItem('erp_my_dept') : null;
  const before = myDept
    ? readyCountFor(get().orders, get().departments, myDept)
    : 0;
  return Promise.resolve(apply()).then(() => {
    if (!myDept) return;
    const after = readyCountFor(get().orders, get().departments, myDept);
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
