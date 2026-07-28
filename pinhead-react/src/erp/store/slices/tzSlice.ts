/**
 * Слайс технических заданий в PDF (волна 4).
 *
 * Документ живёт группой версий: замена файла добавляет строку version+1 и снимает
 * `is_current` со старой. Назначение цеху ссылается на группу, поэтому «заменил файл —
 * обновилось у всех цехов» получается само, без обхода назначений.
 *
 * Правила Pinhead: toast.error на каждую ошибку, null при ошибке, без optimistic delete.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { TZ_BUCKET, TZ_MAX_BYTES, TZ_MIME } from '../../types';
import type { ErpTzAssignment, ErpTzDocument } from '../../types';
import { documentHistory, stageHasTz, tzFilePath } from '../../utils/tz';
import { currentActor, logStageEvent } from '../shared';
import type { ErpOrderFull, ErpStore, TzSlice } from '../types';

/** Точечный патч массива документов заказа (остальные заказы сохраняют идентичность) */
function patchOrder(
  orders: ErpOrderFull[],
  orderId: string,
  apply: (o: ErpOrderFull) => ErpOrderFull,
): ErpOrderFull[] {
  return orders.map((o) => (o.id === orderId ? apply(o) : o));
}

/** Единый предполётный контроль файла: тип и размер (в бакете таких проверок нет) */
function checkFile(file: File): string | null {
  const isPdf = file.type === TZ_MIME || /\.pdf$/i.test(file.name);
  if (!isPdf) return 'ТЗ принимается только в PDF';
  if (file.size > TZ_MAX_BYTES) {
    return `Файл больше ${Math.round(TZ_MAX_BYTES / 1024 / 1024)} МБ — сожмите PDF`;
  }
  return null;
}

/** Загрузка файла в бакет; возвращает путь или null (toast уже показан) */
async function uploadFile(path: string, file: File): Promise<string | null> {
  const { error } = await supabase.storage
    .from(TZ_BUCKET)
    .upload(path, file, { contentType: TZ_MIME, upsert: false });
  if (error) {
    toast.error('Не удалось загрузить файл ТЗ');
    return null;
  }
  return path;
}

export const tzSlice: StateCreator<ErpStore, [], [], TzSlice> = (set, get) => ({
  uploadTzDocument: async ({ orderId, itemId = null, file, note = null }) => {
    const problem = checkFile(file);
    if (problem) {
      toast.error(problem);
      return null;
    }
    const groupId = crypto.randomUUID();
    const path = await uploadFile(tzFilePath(orderId, groupId, 1, file.name), file);
    if (!path) return null;

    const { data, error } = await supabase
      .from('erp_tz_documents')
      .insert({
        order_id: orderId,
        item_id: itemId,
        group_id: groupId,
        version: 1,
        is_current: true,
        file_path: path,
        file_name: file.name,
        mime_type: TZ_MIME,
        size_bytes: file.size,
        note,
        uploaded_by: currentActor(),
      })
      .select();
    const row = data?.[0] as ErpTzDocument | undefined;
    if (error || !row) {
      // Файл остался в бакете сиротой: удалять его клиенту политика не даёт (delete — is_admin).
      toast.error('Файл загружен, но не привязан к заказу');
      return null;
    }
    set((s) => ({
      orders: patchOrder(s.orders, orderId, (o) => ({
        ...o, tz_documents: [...(o.tz_documents ?? []), row],
      })),
    }));
    return row;
  },

  replaceTzDocument: async (groupId, file, note = null) => {
    const problem = checkFile(file);
    if (problem) {
      toast.error(problem);
      return null;
    }
    const order = get().orders.find((o) =>
      (o.tz_documents ?? []).some((d) => d.group_id === groupId));
    const history = order ? documentHistory(order, groupId) : [];
    const prev = history[0];
    if (!order || !prev) {
      toast.error('Документ ТЗ не найден');
      return null;
    }
    const version = prev.version + 1;
    const path = await uploadFile(tzFilePath(order.id, groupId, version, file.name), file);
    if (!path) return null;

    const { data, error } = await supabase
      .from('erp_tz_documents')
      .insert({
        order_id: order.id,
        item_id: prev.item_id,
        group_id: groupId,
        version,
        is_current: true,
        file_path: path,
        file_name: file.name,
        mime_type: TZ_MIME,
        size_bytes: file.size,
        note,
        uploaded_by: currentActor(),
      })
      .select();
    const row = data?.[0] as ErpTzDocument | undefined;
    if (error || !row) {
      toast.error('Файл загружен, но новая версия ТЗ не создана');
      return null;
    }

    // Снимаем is_current со старых версий ПОСЛЕ вставки: партиальный уникальный индекс
    // допускает ровно одну актуальную строку, а вставка её уже заняла бы.
    const { error: clearError } = await supabase
      .from('erp_tz_documents')
      .update({ is_current: false })
      .eq('group_id', groupId)
      .neq('id', row.id);
    if (clearError) toast.error('Старые версии ТЗ не отмечены как устаревшие');

    set((s) => ({
      orders: patchOrder(s.orders, order.id, (o) => ({
        ...o,
        tz_documents: [
          ...(o.tz_documents ?? []).map((d) =>
            (d.group_id === groupId && d.id !== row.id ? { ...d, is_current: false } : d)),
          row,
        ],
      })),
    }));

    // История задания: цех должен увидеть, что ТЗ поменялось уже в работе.
    for (const asg of (order.tz_assignments ?? []).filter((a) => a.group_id === groupId)) {
      const item = order.items.find((i) => i.id === asg.item_id);
      const stage = item?.stages.find((st) => st.department_id === asg.department_id);
      if (!stage) continue;
      logStageEvent({
        stage_id: stage.id,
        order_id: order.id,
        from_status: stage.status,
        to_status: stage.status,
        qty_done: null,
        qty_rework: null,
        comment: `ТЗ обновлено до версии ${version}: ${file.name}`,
      });
    }
    return row;
  },

  assignTz: async ({ orderId, itemId, departmentId, groupId }) => {
    const { data, error } = await supabase
      .from('erp_tz_assignments')
      .upsert(
        {
          order_id: orderId,
          item_id: itemId,
          department_id: departmentId,
          group_id: groupId,
          assigned_by: currentActor(),
        },
        { onConflict: 'item_id,department_id' },
      )
      .select();
    const row = data?.[0] as ErpTzAssignment | undefined;
    if (error || !row) {
      toast.error('Не удалось назначить ТЗ цеху');
      return false;
    }
    set((s) => ({
      orders: patchOrder(s.orders, orderId, (o) => {
        const rest = (o.tz_assignments ?? []).filter(
          (a) => !(a.item_id === itemId && a.department_id === departmentId));
        return { ...o, tz_assignments: [...rest, row] };
      }),
    }));
    return true;
  },

  unassignTz: async (itemId, departmentId) => {
    const order = get().orders.find((o) =>
      (o.tz_assignments ?? []).some(
        (a) => a.item_id === itemId && a.department_id === departmentId));
    if (!order) {
      toast.error('Назначение ТЗ не найдено');
      return false;
    }
    // Требование заказчика: единственное назначенное ТЗ у этапа маршрута снять нельзя —
    // иначе цех останется без документа, а этап намертво упрётся в гейт.
    const item = order.items.find((i) => i.id === itemId);
    const isRouteStage = (item?.stages ?? []).some(
      (st) => st.department_id === departmentId && st.status !== 'skipped');
    if (isRouteStage && order.tz_required !== false && stageHasTz(order, itemId, departmentId)) {
      toast.error('У этапа маршрута должно остаться ТЗ — назначьте другое вместо снятия');
      return false;
    }

    const { error } = await supabase
      .from('erp_tz_assignments')
      .delete()
      .eq('item_id', itemId)
      .eq('department_id', departmentId);
    if (error) {
      toast.error('Не удалось снять назначение ТЗ');
      return false;
    }
    set((s) => ({
      orders: patchOrder(s.orders, order.id, (o) => ({
        ...o,
        tz_assignments: (o.tz_assignments ?? []).filter(
          (a) => !(a.item_id === itemId && a.department_id === departmentId)),
      })),
    }));
    return true;
  },

  setTzRequired: async (orderId, required) => {
    const prev = get().orders;
    set((s) => ({
      orders: patchOrder(s.orders, orderId, (o) => ({ ...o, tz_required: required })),
    }));
    const { error } = await supabase
      .from('erp_orders')
      .update({ tz_required: required })
      .eq('id', orderId);
    if (error) {
      set({ orders: prev });
      toast.error('Не удалось изменить требование ТЗ');
      return false;
    }
    return true;
  },
});
