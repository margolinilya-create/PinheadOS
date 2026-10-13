import { useCallback, useMemo, useRef, useState } from 'react';
import { useErpStore } from '../../../store/useErpStore';
import { currentDocuments } from '../../../utils/tz';

/**
 * Файлы ПРАВИМОГО заказа для формы правки (правка 12.09, баг 03; с 01.10,
 * п. 6 — правятся в форме, `EditOrderFiles`). Вынесено из `CreateOrderModal`.
 *
 * ЖИВОЙ ЗАКАЗ ИЗ СТОРА: поля формы берутся из `order` один раз, а файлы
 * меняются прямо в форме и сразу пишутся в заказ — показывать их надо
 * по стору, иначе снятый файл висел бы в списке до закрытия формы.
 *
 * Состояния загрузки формы (`tzDocs`, `attach`) в правке стартуют пустыми,
 * поэтому подписи секций и гейт листа закупки считаются по ЗАКАЗУ.
 * `currentDocuments` — актуальные версии внутри `group_id`: список всех
 * версий показал бы заменённые файлы как отдельные документы, а снятые
 * (`erp_tz_document_remove`) — как живые.
 *
 * Операции с файлами (загрузка, замена, удаление) идут сразу, и пока хоть
 * одна в полёте, «Сохранить изменения» недоступна (`filesPending`) — то же
 * правило, что у загрузок формы создания. Тронутые файлы — повод перечитать
 * заказ при закрытии (`reloadIfTouched`): карточка покажет ровно то, что в базе.
 */
export function useEditOrderFiles(order, isEdit) {
  const liveOrder = useErpStore((s) => (isEdit ? s.orders.find((o) => o.id === order.id) : null))
    ?? order;
  const savedTzDocs = useMemo(
    () => (isEdit ? currentDocuments(liveOrder) : []),
    [isEdit, liveOrder],
  );
  const savedPurchaseFiles = useMemo(
    () => (isEdit
      ? (liveOrder.attachments ?? []).filter((a) => a.kind === 'purchase_list')
      : []),
    [isEdit, liveOrder],
  );
  const [filesPending, setFilesPending] = useState(0);
  const touched = useRef(false);
  const trackFileOp = useCallback(async (promise) => {
    touched.current = true;
    setFilesPending((n) => n + 1);
    try {
      return await promise;
    } finally {
      setFilesPending((n) => n - 1);
    }
  }, []);
  const reloadIfTouched = useCallback(() => {
    if (isEdit && touched.current) void useErpStore.getState().loadOne?.(order.id);
  }, [isEdit, order]);

  return {
    liveOrder, savedTzDocs, savedPurchaseFiles, filesPending, trackFileOp, reloadIfTouched,
  };
}
