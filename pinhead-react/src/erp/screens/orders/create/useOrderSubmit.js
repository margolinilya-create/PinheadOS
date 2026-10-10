import { useErpStore } from '../../../store/useErpStore';
import { toast } from '../../../../store/useToastStore';
import { validateOrderForm } from '../../../utils/orderForm';
import { currentActor } from '../../../store/shared';
import { scrollIntoViewSafely } from '../../../utils/scrollIntoViewSafely';
import {
  createOrderPayload,
  editOrderPayload,
  notesToSend,
  payloadItems,
  tzDocumentsPayload,
} from './orderPayload';

/**
 * СОХРАНЕНИЕ ФОРМЫ ЗАКАЗА — гейты сабмита и два писателя: правка и создание.
 *
 * Вынесено из `CreateOrderModal` (обзор 26.09, «Резка крупных файлов»):
 * обработчик занимал 345 строк модалки. Сборка самих payload — чистые
 * функции `./orderPayload` с тестами; здесь — порядок проверок, состояние
 * «сохраняется» и что делать после ответа стора.
 *
 * Состояния `saving`/`submitted`/`open` принадлежат модалке: их читает
 * разметка (кнопки, подсказки, раскрытые секции), а хук только переключает.
 */
export function useOrderSubmit({
  isEdit, order, form, items, notes, attach, hasPurchaseList,
  tzDocs, tzValidation, tzUploading, tzFailed, filesPending,
  setSaving, setSubmitted, setOpen, onClose, onCreated,
}) {
  const createOrder = useErpStore((s) => s.createOrder);
  const saveOrderEdits = useErpStore((s) => s.saveOrderEdits);

  /** Раскрыть секции с ошибками и проскроллить к первому ошибочному полю */
  const revealErrors = (errors) => {
    const inMain = Boolean(errors.title || errors.launch_date || errors.due_date);
    const inItems = Object.keys(errors).some((k) => k.startsWith('item_'));
    const inPurchase = Boolean(errors.purchase_list);
    setOpen((o) => ({
      ...o,
      main: o.main || inMain,
      items: o.items || inItems,
      purchase: o.purchase || inPurchase,
    }));
    requestAnimationFrame(() => {
      const el = document.querySelector('[data-invalid="true"]');
      scrollIntoViewSafely(el, { block: 'center' });
      if (typeof el?.focus === 'function') el.focus({ preventScroll: true });
    });
  };

  /**
   * Гейты, которые не пускают сабмит дальше. `true` — можно сохранять.
   * Кнопка в большинстве случаев уже заблокирована — это страховка от Enter.
   */
  const passesUploadGates = () => {
    // Гейт ТЗ (решение заказчика): у позиции с производственным маршрутом должно быть
    // ТЗ — своё или общее на заказ.
    if (tzValidation.missing.length > 0) {
      setOpen((o) => ({ ...o, tz: true }));
      toast.error(tzValidation.message);
      return false;
    }
    if (tzUploading || tzFailed) {
      setOpen((o) => ({ ...o, tz: true }));
      toast.error(tzUploading
        ? 'ТЗ ещё загружается — дождитесь окончания'
        : 'ТЗ не загрузилось — повторите загрузку файла или уберите его');
      return false;
    }
    /**
     * То же правило, что у ТЗ: заказ не создаётся, пока есть незавершённые
     * загрузки. Иначе форма покажет файл приложенным, а в Storage его не будет —
     * и обнаружит это цех, когда откроет пустое вложение.
     */
    if (filesPending > 0) {
      toast.error('Файлы заказа ещё сохраняются — дождитесь окончания');
      return false;
    }
    if (attach.uploading || attach.failed) {
      toast.error(attach.uploading
        ? 'Файлы ещё загружаются — дождитесь окончания'
        : 'Файл не загрузился — повторите загрузку или уберите его');
      return false;
    }
    return true;
  };

  /** Правка существующего заказа (правка 12.09, п. 7) — см. `editOrderPayload` */
  const saveEdits = async (validItems) => {
    const ok = await saveOrderEdits(order.id, editOrderPayload(form, validItems));
    setSaving(false);
    if (ok) {
      toast.success('Изменения сохранены');
      onClose();
    }
  };

  const create = async (validItems) => {
    const tzDocuments = tzDocumentsPayload(items, tzDocs, currentActor());
    let created = null;
    try {
      /**
       * Ключи заметок В ТОМ ЖЕ ПОРЯДКЕ, в каком они уедут в секцию `notes`:
       * по ним изображение находит свою заметку. Отбор один — `notesToSend`.
       */
      const notesList = notesToSend(notes, attach.files);
      created = await createOrder(createOrderPayload({
        form,
        validItems,
        notesList,
        tzDocuments,
        attachments: attach.payload([], notesList.map((n) => n.key)),
      }));
    } finally {
      // `setSaving(false)` обязан быть в finally. Внутри два сетевых вызова,
      // и брошенное исключение (нет сети, CORS) оставило бы кнопку в
      // «Создание…» навсегда — вместе со всем заполненным заказом, который
      // человек набирал минутами. Сообщение об ошибке показывает стор.
      setSaving(false);
    }
    if (created) {
      await onCreated();
      toast.success(`Заказ «${created.title}» создан, маршрут построен`);
      onClose();
    }
  };

  return async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const { errors } = validateOrderForm(form, items, undefined, hasPurchaseList);
    if (Object.keys(errors).length > 0) {
      revealErrors(errors);
      return;
    }
    const validItems = payloadItems(items);
    if (!passesUploadGates()) return;

    setSaving(true);
    /**
     * РЕЖИМ ПРАВКИ: обновляем ТОТ ЖЕ заказ и выходим. Ветка стоит ДО сборки
     * payload создания — см. `editOrderPayload`.
     */
    if (isEdit) {
      await saveEdits(validItems);
      return;
    }
    await create(validItems);
  };
}
