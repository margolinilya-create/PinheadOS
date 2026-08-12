/**
 * Слайс технических заданий в PDF.
 *
 * Документ живёт группой версий: замена файла добавляет строку version+1 и снимает
 * `is_current` со старой. ТЗ принадлежит позиции (а с `item_id = null` — всему заказу),
 * поэтому «заменил файл — обновилось у всех цехов маршрута» получается само.
 *
 * Правила Pinhead: toast.error на каждую ошибку, null при ошибке, без optimistic delete.
 */

import type { StateCreator } from 'zustand';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import { TZ_BUCKET, TZ_MAX_BYTES, TZ_MIME } from '../../types';
import { restoreOrderIn } from '../orderHelpers';
import type { ErpTzDocument } from '../../types';
import { documentHistory, tzFilePath } from '../../utils/tz';
import { currentActor, erpError, erpQuery, logStageEvent, removeOrphanUpload } from '../shared';
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
  const { error } = await erpQuery(() => supabase.storage
    .from(TZ_BUCKET)
    .upload(path, file, { contentType: TZ_MIME, upsert: false }));
  if (error) {
    // Причина обязана быть названа: отказ прав, обрыв связи и слетевшая сессия
    // требуют разных действий, а «Не удалось загрузить файл ТЗ» одинаково молчит
    // про все три. Заказчик видел именно это — и рядом сырое «Load failed».
    erpError('Не удалось загрузить файл ТЗ', error);
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

    const { data, error } = await erpQuery(() => supabase
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
      .select());
    const row = data?.[0] as ErpTzDocument | undefined;
    if (error || !row) {
      // Убираем за собой: строки в БД нет, файл никому не нужен и не найдётся
      await removeOrphanUpload(TZ_BUCKET, path);
      erpError('Файл загружен, но не привязан к заказу', error);
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

    /**
     * Снять is_current со старых версий НАДО ДО вставки новой.
     *
     * В проде висит `create unique index erp_tz_documents_current_idx
     * on erp_tz_documents (group_id) where is_current` — ровно одна актуальная версия
     * в группе. Пока старая строка держит флаг, вставка второй с `is_current: true`
     * нарушает индекс и падает с 23505. Здесь стоял обратный порядок с комментарием,
     * утверждавшим ровно противоположное, и то же самое было записано правилом
     * в CLAUDE.md — то есть заменить файл ТЗ через интерфейс было нельзя ни разу.
     * Не проявлялось только потому, что таблица в проде ещё пуста.
     *
     * Обратный порядок (снять → вставить) оставляет группу без актуальной версии,
     * если вставка не удалась, поэтому флаг возвращаем прежней версии — иначе цех
     * увидит «ТЗ не назначено» на ровном месте.
     */
    const { error: clearError } = await erpQuery(() => supabase
      .from('erp_tz_documents')
      .update({ is_current: false })
      .eq('group_id', groupId)
      .eq('is_current', true));
    if (clearError) {
      erpError('Не удалось подготовить замену ТЗ — версия не создана', clearError);
      return null;
    }

    const { data, error } = await erpQuery(() => supabase
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
      .select());
    const row = data?.[0] as ErpTzDocument | undefined;
    if (error || !row) {
      // Компенсация: флаг уже снят, а новой версии нет — группа осталась бы без
      // актуального ТЗ, и гейт остановил бы цеха на документе, который никуда не делся.
      await erpQuery(() => supabase
        .from('erp_tz_documents')
        .update({ is_current: true })
        .eq('id', prev.id));
      await removeOrphanUpload(TZ_BUCKET, path);
      erpError('Файл загружен, но новая версия ТЗ не создана', error);
      return null;
    }

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

    /**
     * История задания: цех должен увидеть, что ТЗ поменялось уже в работе.
     * ТЗ принадлежит позиции, поэтому событие пишется всем её незакрытым
     * производственным этапам — раньше адресатов давал список назначений.
     */
    const docItemId = (order.tz_documents ?? []).find((d) => d.group_id === groupId)?.item_id ?? null;
    const touched = order.items.filter((i) => docItemId === null || i.id === docItemId);
    for (const item of touched) {
      for (const stage of item.stages) {
        if (stage.status === 'done' || stage.status === 'skipped') continue;
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
    }
    return row;
  },

  setTzRequired: async (orderId, required) => {
    const prev = get().orders;
    set((s) => ({
      orders: patchOrder(s.orders, orderId, (o) => ({ ...o, tz_required: required })),
    }));
    const { error } = await erpQuery(() => supabase
      .from('erp_orders')
      .update({ tz_required: required })
      .eq('id', orderId));
    if (error) {
      set((s2) => ({ orders: restoreOrderIn(s2.orders, prev, orderId) }));
      erpError('Не удалось изменить требование ТЗ', error);
      return false;
    }
    return true;
  },
});
