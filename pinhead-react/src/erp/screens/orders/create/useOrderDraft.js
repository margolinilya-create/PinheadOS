import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../../store/useErpStore';
import { confirm } from '../../../../store/useConfirmStore';
import { toast } from '../../../../store/useToastStore';
import {
  clearOrderDraft,
  emptyOrderForm,
  isDraftEmpty,
  loadOrderDraft,
  newDraftItem,
  normalizeDraft,
} from '../../../utils/orderForm';

/**
 * ЧЕРНОВИКИ ФОРМЫ ЗАКАЗА — выбор, автосохранение, явное сохранение, удаление.
 *
 * Вынесено из `CreateOrderModal` (обзор 26.09, «Резка крупных файлов»).
 * Состояние формы (`form`/`items`/`notes`) по-прежнему принадлежит модалке:
 * его читают валидация, маршруты и сабмит. Здесь — только то, что отвечает
 * на вопрос «какая строка `erp_order_drafts` открыта и что в неё писать».
 *
 * НЕСКОЛЬКО НЕЗАВИСИМЫХ ЧЕРНОВИКОВ (правка заказчика 22.08, п. 5.5).
 *
 * Раньше черновик был ОДИН, в localStorage, и «Новый заказ» при наличии
 * незапущенного заказа восстанавливал предыдущий — параллельно подготовить
 * два заказа было нельзя. Теперь черновики живут в базе, у каждого свой id,
 * и форма правит РОВНО ТОТ, с которым её открыли: `draftId = null` — чистая
 * форма, строка заводится при первом автосохранении.
 *
 * Локальный черновик прежней версии переносится в базу один раз, при первом
 * открытии чистой формы: человек мог начать заказ вчера, и терять его работу
 * ради чистоты нельзя.
 */

/**
 * Открытый черновик берётся ОДИН РАЗ, при монтировании: дальше форма — сама
 * себе источник правды, и перечитывание строки из стора после каждого
 * автосохранения затирало бы то, что человек печатает прямо сейчас.
 * Зовётся из инициализатора `useState` модалки.
 */
export function pickRestoredDraft(isEdit, draftId, drafts) {
  // В режиме правки черновики не при чём: они про НЕсозданный заказ
  if (isEdit) return null;
  if (draftId) {
    const row = drafts.find((d) => d.id === draftId);
    return row?.payload ? normalizeDraft(row.payload) : null;
  }
  // Разовый перенос локального черновика прежней версии
  return loadOrderDraft();
}

/** Заголовок строки черновика: название заказа, иначе № сделки */
function draftTitle(form) {
  return form.title.trim() || (form.bitrix_id.trim() ? `№${form.bitrix_id.trim()}` : null);
}

export function useOrderDraft({
  isEdit, draftId, initialLaunch, saving,
  form, items, notes, setForm, setItems, setNotes,
  attach, tz, onReset,
}) {
  const { saveDraftRow, deleteDraftRow } = useErpStore(useShallow((s) => ({
    saveDraftRow: s.saveOrderDraft,
    deleteDraftRow: s.deleteOrderDraft,
  })));
  const tzDocs = tz.tzDocs;
  const [rowId, setRowId] = useState(draftId);
  const filesCount = attach.files.length + tzDocs.length + notes.length;
  const isEmpty = () => isDraftEmpty(form, items, initialLaunch, filesCount);

  /**
   * СНИМОК ФОРМЫ ДЛЯ ЧЕРНОВИКА — ОДИН на автосохранение и на кнопку
   * «Сохранить в черновики». Два сборщика рядом означали бы, что по кнопке
   * сохраняется не то же самое, что в фоне, и расходились бы они молча.
   *
   * Файлы (правка 20.09, п. 6) уезжают путями уже загруженных объектов:
   * `File` в JSON превращается в `{}`, а объект в бакете к этому моменту
   * уже есть — он кладётся туда при выборе.
   *
   * В `useCallback`, и это не про производительность: функция стоит
   * в зависимостях эффекта автосохранения. Пересоздаваясь каждый рендер,
   * она либо заставляла бы эффект перезапускаться постоянно, либо (если её
   * из зависимостей убрать) оставляла бы автосохранение СЛЕПЫМ К ФАЙЛАМ:
   * добавление вложения или ТЗ меняет `attach`/`tzDocs`, а не `form`,
   * и черновик бы их не заметил.
   */
  const attachSnapshot = attach.draftSnapshot;
  const tzSnapshot = tz.draftSnapshot;
  const draftPayload = useCallback(() => ({
    form,
    items,
    notes,
    attachments: attachSnapshot(),
    tzDocs: tzSnapshot(),
  }), [form, items, notes, attachSnapshot, tzSnapshot]);

  /**
   * Автосейв черновика (debounce 500 мс) — В БАЗУ.
   *
   * Пустая форма строки не заводит вовсе: иначе каждое открытие «Нового
   * заказа» оставляло бы пустой черновик, и список превратился бы в мусор.
   * Уже заведённый черновик, который вычистили до пустого, удаляется —
   * это и есть отказ от него.
   *
   * `rowId` держим в ref рядом с состоянием: два автосохранения подряд
   * с `null` завели бы ДВА черновика на один заказ.
   *
   * ТЕЛО ЦЕЛИКОМ В `try/catch`: это async-функция внутри `setTimeout`, то есть
   * её отказ никто не ждёт и он всплывает необработанным. Сообщать не о чем —
   * слайс уже показал причину через `erpError`, а вторая полоса каждые 500 мс
   * на потерянной связи превратила бы форму в мигалку. Молчит здесь ТОЛЬКО
   * фоновое сохранение: сам заказ создаётся кнопкой и об ошибках говорит.
   */
  const rowIdRef = useRef(draftId);
  useEffect(() => { rowIdRef.current = rowId; }, [rowId]);
  useEffect(() => {
    /**
     * В РЕЖИМЕ ПРАВКИ ЧЕРНОВИК НЕ ПИШЕТСЯ (правка 12.09, п. 7).
     *
     * `erp_order_drafts` — про НЕсозданный заказ: «+ Новый заказ» открывает
     * самый свежий черновик. Пиши мы туда правку существующего, следующее
     * создание открылось бы чужими данными, а сам черновик создания оказался
     * бы затёрт. Несохранённая правка теряется при закрытии — и об этом
     * спрашивает `confirm`, ровно как при удалении заполненного блока.
     */
    if (isEdit) return undefined;
    /**
     * АВТОСОХРАНЕНИЕ РАБОТАЕТ ТОЛЬКО У ОТКРЫТОГО ЧЕРНОВИКА (правка 21.09, п. 6).
     *
     * Документ: «сохранение в черновики должно происходить только по явному
     * действию пользователя „Сохранить в черновики". Если пользователь выходит
     * без нажатия этой кнопки, форма просто закрывается без дополнительного
     * подтверждения». Пока фон заводил строку сам, «выйти без сохранения»
     * было неправдой — сохранённое уже лежало в базе, и окно при выходе
     * существовало ровно затем, чтобы это как-то объяснить.
     *
     * Черновик, который УЖЕ открыт (выбран из списка или сохранён кнопкой),
     * автосейв продолжает обновлять: «кнопка „Сохранить в черновики"
     * продолжает обновлять именно этот черновик, а не создавать новый
     * при каждом сохранении». Правка открытого черновика без сохранения
     * потерялась бы молча — это не «не сохранять», а «потерять».
     */
    if (!rowIdRef.current) return undefined;
    const t = setTimeout(async () => {
      try {
        if (isDraftEmpty(form, items, initialLaunch, attach.files.length + tzDocs.length + notes.length)) {
          if (rowIdRef.current) {
            const id = rowIdRef.current;
            rowIdRef.current = null;
            setRowId(null);
            await deleteDraftRow(id);
          }
          // Локальный черновик прежней версии убираем вместе с переносом
          clearOrderDraft();
          return;
        }
        const row = await saveDraftRow(
          rowIdRef.current, draftTitle(form), draftPayload());
        if (row && !rowIdRef.current) {
          rowIdRef.current = row.id;
          setRowId(row.id);
        }
        if (row) clearOrderDraft();
      } catch {
        // см. комментарий выше: черновик — фон, форма продолжает работать
      }
    }, 500);
    return () => clearTimeout(t);
  }, [isEdit, form, items, notes, initialLaunch, saveDraftRow, deleteDraftRow, draftPayload, attach.files.length, tzDocs.length]);

  /** Форма теперь пишет в строку `id` (или ни в какую — `null`) */
  const bindRow = (id) => {
    rowIdRef.current = id;
    setRowId(id);
  };

  /**
   * ЗАГРУЗИТЬ В ФОРМУ ВЫБРАННЫЙ ЧЕРНОВИК (правка 21.09, п. 6).
   *
   * «По нажатию на строку загружать выбранный черновик в текущую форму
   * со всеми сохранёнными позициями, размерной сеткой, ТЗ, техническими
   * полями, файлами и остальными данными. Если в форме уже открыт другой
   * черновик, выбор нового должен ЗАМЕНИТЬ данные формы… Не создавать копию
   * и не объединять два черновика».
   *
   * Замена непустой формы спрашивает подтверждение: набранное исчезает
   * безвозвратно, и это не то же самое, что закрыть форму — там терять
   * нечего, потому что фон ничего не сохранял.
   */
  const applyDraft = async (row) => {
    if (!row) return;
    if (row.id === rowId) return;
    if (!isEmpty()) {
      const ok = await confirm({
        title: 'Заменить содержимое формы?',
        message: `Набранное сейчас не сохранено и будет потеряно. Вместо него `
          + `откроется черновик «${row.title || 'Без названия'}».`,
        confirmLabel: 'Открыть черновик',
        variant: 'danger',
      });
      if (!ok) return;
    }
    const draft = normalizeDraft(row.payload);
    if (!draft) {
      toast.error('Черновик не читается — возможно, он сохранён старой версией формы');
      return;
    }
    setForm({ ...emptyOrderForm(initialLaunch), ...draft.form });
    setItems(draft.items.length > 0 ? draft.items : [newDraftItem()]);
    setNotes(draft.notes ?? []);
    attach.replaceAll(draft.attachments ?? []);
    tz.replaceAll(draft.tzDocs ?? []);
    bindRow(row.id);
    onReset();
  };

  /**
   * «Создать новый черновик» / пустая форма (правка 21.09, п. 6): «в списке
   * предусмотреть действие „Создать новый черновик"… чтобы быстро перейти
   * от существующего черновика к новому заказу».
   *
   * Открытый черновик при этом НЕ удаляется — он остаётся в списке. Прежняя
   * «Очистить» его сносила, но там это было единственным способом отказаться
   * от заведённого фоном; теперь фон ничего не заводит, и удаление стало бы
   * неожиданной потерей чужой работы.
   */
  const startFreshDraft = async () => {
    if (!isEmpty()) {
      const ok = await confirm({
        title: 'Начать новый заказ?',
        message: rowId
          ? 'Форма очистится. Открытый черновик останется в списке — набранное после '
            + 'последнего сохранения будет потеряно.'
          : 'Форма очистится, набранное не сохранено и будет потеряно.',
        confirmLabel: 'Очистить форму',
        variant: 'danger',
      });
      if (!ok) return;
    }
    clearOrderDraft();
    bindRow(null);
    setForm(emptyOrderForm(initialLaunch));
    setItems([newDraftItem()]);
    setNotes([]);
    attach.replaceAll([]);
    tz.clear();
    onReset();
  };

  /** Удаление черновика из списка — не optimistic (правило проекта) */
  const removeDraft = async (row) => {
    const ok = await confirm({
      title: 'Удалить черновик?',
      message: `«${row.title || 'Без названия'}» будет удалён. Заказ не создан, `
        + 'поэтому на производство это не влияет.',
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (!ok) return;
    if (!await deleteDraftRow(row.id)) return;
    toast.success('Черновик удалён');
    // Удалили тот, что открыт — форма остаётся заполненной, но больше
    // ничего не обновляет: строки, в которую писать, уже нет
    if (row.id === rowId) bindRow(null);
  };

  /**
   * ЯВНОЕ СОХРАНЕНИЕ В ЧЕРНОВИКИ (правка заказчика 20.09, п. 6).
   *
   * Автосохранение работало и раньше, но молча — «раньше заказ можно было
   * сохранить в черновики, открыть позже и продолжить заполнение. Сейчас эта
   * возможность пропала» ровно об этом: механизм был, СКАЗАТЬ ЕМУ «сохрани»
   * было нечем, а увидеть результат — негде.
   *
   * Обязательные поля не проверяются намеренно: «сохранять частично
   * заполненную форму без обязательного заполнения всех полей, нужных
   * для запуска заказа».
   */
  const [savingDraft, setSavingDraft] = useState(false);
  const saveDraftNow = async () => {
    if (savingDraft || saving) return false;
    if (isEmpty()) {
      toast.error('Черновик пустой — заполните хотя бы одно поле');
      return false;
    }
    setSavingDraft(true);
    const title = draftTitle(form);
    const row = await saveDraftRow(rowIdRef.current, title, draftPayload());
    setSavingDraft(false);
    if (!row) {
      // Молчать нельзя: человек нажал кнопку и ждёт ответа — в отличие
      // от фонового автосохранения, которое об отказах не сообщает
      toast.error('Черновик не сохранён — проверьте связь и повторите');
      return false;
    }
    if (!rowIdRef.current) bindRow(row.id);
    toast.success(title ? `Черновик «${title}» сохранён` : 'Черновик сохранён');
    return true;
  };

  /**
   * Заказ создан — черновик отработал: держать его снимок больше незачем.
   * Локальный черновик прежней версии уходит вместе с ним.
   */
  const discardAfterCreate = async () => {
    clearOrderDraft();
    if (rowIdRef.current) await deleteDraftRow(rowIdRef.current);
  };

  return {
    rowId,
    dirty: !isEmpty(),
    savingDraft,
    saveDraftNow,
    applyDraft,
    startFreshDraft,
    removeDraft,
    discardAfterCreate,
  };
}
