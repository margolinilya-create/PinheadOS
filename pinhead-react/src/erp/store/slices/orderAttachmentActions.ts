/**
 * Файлы заказа — действия слайса `orderWriteSlice`, вынесенные в свой модуль
 * (01.10: сторож размера `fileSizeRatchet` — «вынесите соседний кусок в свой
 * модуль, а не поднимайте число»). Поведение то же; собираются обратно
 * распаковкой в `orderWriteSlice`.
 */

import { supabase } from '../../../lib/supabase';
import { attachmentFilePath } from '../../utils/storageKey';
import type { ErpOrderAttachment } from '../../types';
import { TZ_BUCKET } from '../../types';
import {
  currentActor, erpError, erpQuery, erpWrite, freeOfSkuCards, removeOrphanUpload,
} from '../shared';
import { invalidate } from '../queryCache';
import { orderBundleKey } from './ordersSlice';
import type { ErpStore, OrderAttachmentLinks, OrderWriteSlice } from '../types';

type Set = (fn: (s: ErpStore) => Partial<ErpStore>) => void;
type Get = () => ErpStore;

/**
 * Только известные привязки и только заданные: вызывающие на `.js` тайпчеком
 * не проверяются, и лишний ключ ушёл бы в INSERT колонкой, которой нет.
 */
const LINK_KEYS = ['item_id', 'material_id', 'stage_id', 'print_id', 'label_id', 'note_id'] as const;
function pickLinks(links: OrderAttachmentLinks | undefined): OrderAttachmentLinks {
  const out: OrderAttachmentLinks = {};
  for (const k of LINK_KEYS) {
    const v = links?.[k];
    if (v) out[k] = v;
  }
  return out;
}

export function orderAttachmentActions(set: Set, get: Get): Pick<OrderWriteSlice,
  'uploadOrderAttachment' | 'deleteOrderAttachment' | 'moveOrderAttachment'> {
  return {
    /**
     * ФАЙЛ ЗАКАЗА: общий («Файлы сделки») либо рабочий («Файлы производства»,
     * правка 14.09, п. 3). Вид приходит параметром со значением по умолчанию —
     * у действия тринадцать лет истории и два вызывающих на `.js`
     * (фото блокировки и фото брака в `useStageActions`), где тайпчек аргументы
     * не проверяет: обязательный параметр молча остался бы `undefined`.
     */
    uploadOrderAttachment: async (orderId, file, note, kind = 'attachment', links = {}) => {
      /**
       * Ключ объекта — общий `attachmentFilePath`: строго ASCII с транслитом
       * кириллицы. Прежняя схема (`<orderId>/<время>.<расширение>`) человеческое
       * имя теряла вовсе, а Supabase на русское имя отвечает `InvalidKey` —
       * на этом однажды не создавался НИ ОДИН заказ с ТЗ.
       */
      const path = attachmentFilePath(orderId, kind, crypto.randomUUID(), file.name);
      const { error: upErr } = await erpQuery(() => supabase.storage
        .from(TZ_BUCKET)
        .upload(path, file, { contentType: file.type || 'application/octet-stream' }));
      if (upErr) {
        erpError('Не удалось загрузить файл', upErr);
        return false;
      }
      const { data, error } = await erpQuery(() => supabase
        .from('erp_order_attachments')
        .insert({
          order_id: orderId,
          file_path: path,
          file_name: note ? `${note} — ${file.name}` : file.name,
          kind,
          uploaded_by: currentActor(),
          // Привязки строки — только при замене файла в форме правки (п. 6, 01.10):
          // новая версия встаёт к тому же нанесению/позиции, что и старая
          ...pickLinks(links),
        })
        .select());
      const row = data?.[0] as ErpOrderAttachment | undefined;
      if (error || !row) {
        await removeOrphanUpload(TZ_BUCKET, path);
        erpError('Файл загружен, но не привязан к заказу', error);
        return false;
      }
      set((s) => ({
        orders: s.orders.map((o) =>
          o.id === orderId
            ? { ...o, attachments: [...(o.attachments ?? []), row] }
            : o),
      }));
      return true;
    },

    /**
     * Снятие файла заказа (правка 14.09, п. 3: «сделать возможность удалять
     * и заменять файлы внутри карточки „файлы"»).
     *
     * НЕ оптимистично и с `.select()` — RLS запрещает DELETE через `USING`,
     * то есть отдаёт «0 строк», а не ошибку, и зелёное «файл снят» было бы
     * неправдой. Объект бакета убирается ПОСЛЕ строки: обратный порядок при
     * отказе прав оставил бы живую строку, ссылающуюся в пустоту.
     *
     * «Замена» отдельным действием не заводится: это загрузка нового файла
     * и снятие старого. Перезаписывать объект в бакете нельзя — на него уже
     * могут быть ссылки, а прежняя версия нужна тем, кто её видел.
     */
    deleteOrderAttachment: async (orderId, attachmentId) => {
      const order = get().orders.find((o) => o.id === orderId) ?? null;
      const att = (order?.attachments ?? []).find((a) => a.id === attachmentId) ?? null;
      const { data, error } = await erpQuery(() => supabase
        .from('erp_order_attachments').delete().eq('id', attachmentId).select());
      if (error || (data ?? []).length === 0) {
        erpError('Файл не снят', error ?? { message: 'Нет прав на удаление файла' });
        return false;
      }
      set((s) => ({
        orders: s.orders.map((o) => (o.id === orderId
          ? { ...o, attachments: (o.attachments ?? []).filter((a) => a.id !== attachmentId) }
          : o)),
      }));
      // Объект уходит, только если на него не ссылается карточка модели
      if (att?.file_path && (await freeOfSkuCards([att.file_path])).length > 0) {
        await removeOrphanUpload(TZ_BUCKET, att.file_path);
      }
      invalidate(orderBundleKey(orderId));
      return true;
    },

    /**
     * Перекладывание файла между папками «Файлы сделки» ↔ «Файлы производства»
     * (правка 14.09, п. 3).
     *
     * Пишется РОВНО `kind`; всё остальное у вложения неизменно, и это же
     * повторяет серверный страж `erp_attachment_guard`. Через `erpWrite`:
     * отказ RLS на UPDATE приходит пустым результатом, а не ошибкой.
     */
    moveOrderAttachment: async (orderId, attachmentId, kind) => {
      const ok = await erpWrite(
        'Не удалось переместить файл',
        () => supabase.from('erp_order_attachments')
          .update({ kind }).eq('id', attachmentId).select(),
      );
      if (!ok) return false;
      set((s) => ({
        orders: s.orders.map((o) => (o.id === orderId
          ? {
            ...o,
            attachments: (o.attachments ?? []).map((a) => (a.id === attachmentId
              ? { ...a, kind }
              : a)),
          }
          : o)),
      }));
      invalidate(orderBundleKey(orderId));
      return true;
    },
  };
}
