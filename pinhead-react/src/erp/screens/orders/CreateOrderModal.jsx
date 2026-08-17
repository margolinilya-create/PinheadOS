import { useEffect, useMemo, useRef, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { DictionaryDatalist } from '../../components/DictionaryDatalist';
import {deptShortName} from '../../data/departments';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { formatDateShort } from '../../utils/time';
import { confirm } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { pluralize } from '../../../utils/i18n';
import {
  EMPTY_ITEM,
  clearOrderDraft,
  emptyPurchaseRow,
  isPurchaseRowEmpty,
  effectiveQty,
  EMPTY_PRINT,
  emptyOrderForm,
  gridToPayload,
  isFormEmpty,
  isItemEmpty,
  loadOrderDraft,
  saveOrderDraft,
  validateOrderForm,
} from '../../utils/orderForm';
import { factoryToday } from '../../../utils/date';
import { formItemRoute } from '../../utils/routeDraft';
import { DateField } from '../../components/DateField';
import { Icon } from '../../components/Icon';
import { deptNeedsTz, tzFilePath, validateTzDocs } from '../../utils/tz';
import { translateSupabaseError } from '../../../utils/i18n';
import { currentActor, erpQuery } from '../../store/shared';
import { supabase } from '../../../lib/supabase';
import {
  TZ_BUCKET,
  TZ_MAX_BYTES,
  TZ_MIME,
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../../types';
import styles from '../../erp.module.css';

// Секции и примитивы формы вынесены в ./create/ — модалка осталась композицией
import { FormSection, FieldError } from './create/FormParts';
import { TzSection } from './create/TzSection';
import { PurchaseListSection } from './create/PurchaseListSection';
import { useAttachmentUploads } from '../../hooks/useAttachmentUploads';
import { ItemBlock } from './create/ItemBlock';
import { Button } from '../../components/Button';

/**
 * Позиции с их производственными этапами — те, кому нужно ТЗ, и цеха, которые
 * его увидят. Маршрут считается тем же `buildItemRoute`, что и в сторе, поэтому
 * превью в форме не расходится с фактом. ТЗ требуют только производственные цеха
 * (`deptNeedsTz`): закупке и складам PDF не адресуется.
 */
function buildTzItems(items, routes, deptByCode) {
  return items
    .map((it, index) => ({ it, index }))
    .filter(({ it }) => it.product_type.trim() && effectiveQty(it) > 0)
    .map(({ it, index }) => ({
      index,
      label: [it.product_type.trim(), it.variant.trim()].filter(Boolean).join(' ') || 'Позиция',
      stages: (routes[index] ?? [])
        .flat()
        .map((step) => deptByCode.get(step.departmentCode))
        .filter((d) => deptNeedsTz(d))
        .map((d) => ({ departmentId: d.id, departmentName: deptShortName(d.code, d.name) })),
    }));
}


export function CreateOrderModal({ onClose }) {
  const createOrder = useErpStore((s) => s.createOrder);
  const findOrdersByBitrixId = useErpStore((s) => s.findOrdersByBitrixId);
  const uploadOrderPreview = useErpStore((s) => s.uploadOrderPreview);
  const departments = useErpStore((s) => s.departments);
  const [saving, setSaving] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const fileInputRef = useRef(null);

  const acceptPreview = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      toast.error('Превью: только JPG/PNG/WEBP');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Превью: файл больше 2 МБ');
      return;
    }
    setPreviewFile(file);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(file);
    });
  };

  // Ctrl+V из буфера (приём kontora24): вне текстовых полей
  useEffect(() => {
    const onPaste = (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') && t.type !== 'file') return;
      const file = [...(e.clipboardData?.files ?? [])][0];
      if (file) acceptPreview(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);
  // Дата запуска по умолчанию — сегодня; черновик восстанавливается из localStorage
  const initialLaunch = useMemo(() => factoryToday(), []);
  const [restoredDraft] = useState(() => loadOrderDraft());
  const [form, setForm] = useState(() => restoredDraft?.form ?? emptyOrderForm(initialLaunch));
  const [items, setItems] = useState(() => restoredDraft?.items ?? [{ ...EMPTY_ITEM }]);
  /**
   * Лист закупки (правки заказчика 16.08). Потребность формирует МЕНЕДЖЕР при
   * создании заказа — раньше её вбивал закупщик заново на своём экране.
   * Строки уезжают в заказ той же транзакцией (секция `materials` RPC).
   */
  const [purchase, setPurchase] = useState(() => restoredDraft?.purchase ?? []);
  /**
   * Вложения блоков: упаковка, техблок, лист закупки (правки заказчика 16.08 —
   * документ требует файлы в шести местах). File-объекты живут ОТДЕЛЬНО от
   * form/items, как и ТЗ: черновик пишется через `JSON.stringify`, и File
   * сериализовался бы в `{}` молча.
   */
  const attach = useAttachmentUploads('new');
  const addPurchaseRow = () =>
    setPurchase((rows) => [...rows, emptyPurchaseRow(crypto.randomUUID())]);
  const setPurchaseRow = (key, patch) =>
    setPurchase((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removePurchaseRow = (key) => {
    setPurchase((rows) => rows.filter((r) => r.key !== key));
    // Файлы строки уходят вместе с ней — и из состояния, и из бакета
    attach.dropOwner(key);
  };
  const [draftRestored, setDraftRestored] = useState(Boolean(restoredDraft));

  /**
   * Заказы с тем же № сделки. Предупреждение, а не запрет: две партии по одной
   * сделке — законный случай, и блокировать его нельзя. Но и молчать нельзя:
   * в базе на 03.08.2026 пять групп дублей, созданных с интервалом
   * 25–80 секунд, — человек не увидел результата первой попытки и повторил.
   */
  const [dupes, setDupes] = useState([]);
  useEffect(() => {
    // Debounce: поле заполняют посимвольно, запрос на каждый символ не нужен.
    // Пустое значение тоже идёт через таймер, а не сбрасывается тут же: сам
    // запрос на пустую строку не уходит (findOrdersByBitrixId отвечает []),
    // а setState синхронно в теле эффекта — то, что ловит react-hooks.
    let alive = true;
    const t = setTimeout(() => {
      findOrdersByBitrixId(form.bitrix_id).then((rows) => { if (alive) setDupes(rows); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [form.bitrix_id, findOrdersByBitrixId]);

  const deptByCode = useMemo(
    () => new Map(departments.filter((d) => d.active).map((d) => [d.code, d])),
    [departments],
  );
  /**
   * Маршруты позиций: правка человека, если она есть, иначе расчёт. Правило
   * одно на всю форму и на стор — `routeGroupsForItem`; разойдись они, гейт ТЗ
   * считался бы по одному маршруту, а заказ создавался по другому.
   */
  const itemRoutes = useMemo(
    () => items.map((it) => formItemRoute(it)),
    [items],
  );
  const tzItems = useMemo(
    () => buildTzItems(items, itemRoutes, deptByCode), [items, itemRoutes, deptByCode]);

  /**
   * ТЗ в PDF. File-объекты держим ОТДЕЛЬНО от form/items: черновик пишется
   * через JSON.stringify, и File сериализовался бы в {} молча.
   * tzDocs: { groupId, itemIndex (null = общее ТЗ заказа), file, state, error, path }
   *
   * ТЗ принадлежит позиции: назначать документ каждому цеху больше не нужно —
   * файл виден всему производственному маршруту позиции (правка 2026-08-03).
   *
   * Файл уходит в бакет СРАЗУ при выборе, а не в сабмите. Раньше загрузка шла
   * только по «Создать заказ»: интерфейс показывал приложенный файл, которого
   * в Storage ещё не было, и первую же ошибку человек видел вместо созданного заказа.
   */
  const [tzDocs, setTzDocs] = useState([]);
  const tzUploading = tzDocs.some((d) => d.state === 'uploading');
  const tzFailed = tzDocs.some((d) => d.state === 'error');

  /**
   * Путь детерминированный (`group_id` живёт в стейте формы), поэтому `upsert: true`:
   * повторная попытка перезаписывает свой же файл. Чужой затереть нельзя — group_id
   * генерирует клиент. Ключ строго ASCII (`tzFilePath`): Storage отвечает InvalidKey
   * на кириллицу, и именно на этом ломалось создание любого заказа с русским ТЗ.
   */
  const uploadTzFile = async (groupId, file) => {
    const path = tzFilePath('new', groupId, 1, file.name);
    /**
     * `erpQuery`, а не голый `await`: без ответа сервера supabase-js БРОСАЕТ, и тогда
     * `setTzDocs` ниже не выполнялся вовсе — файл оставался в состоянии «загружается»
     * навсегда, а «Создать заказ» блокировалась незавершённой загрузкой, которая
     * никогда не завершится. Кнопки «Загрузить заново» человек при этом не видел:
     * она показывается только в состоянии ошибки.
     */
    const { error } = await erpQuery(() => supabase.storage
      .from(TZ_BUCKET)
      .upload(path, file, { contentType: TZ_MIME, upsert: true }));
    setTzDocs((arr) => arr.map((d) => {
      if (d.groupId !== groupId) return d;
      if (!error) return { ...d, state: 'uploaded', error: null, path };
      return {
        ...d,
        state: 'error',
        error: navigator.onLine === false
          ? 'нет сети'
          : translateSupabaseError(error.message),
      };
    }));
  };

  const addTzDoc = (file, itemIndex) => {
    if (!file) return;
    const isPdf = file.type === TZ_MIME || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      toast.error('ТЗ принимается только в PDF');
      return;
    }
    if (file.size > TZ_MAX_BYTES) {
      toast.error(`ТЗ: файл больше ${Math.round(TZ_MAX_BYTES / 1024 / 1024)} МБ`);
      return;
    }
    const groupId = crypto.randomUUID();
    setTzDocs((arr) => [...arr, { groupId, itemIndex, file, state: 'uploading', error: null, path: null }]);
    uploadTzFile(groupId, file);
  };

  /** Повторная загрузка после сбоя: перезаливается только файл, форма не трогается */
  const retryTzDoc = (groupId) => {
    const doc = tzDocs.find((d) => d.groupId === groupId);
    if (!doc) return;
    setTzDocs((arr) => arr.map((d) => (
      d.groupId === groupId ? { ...d, state: 'uploading', error: null } : d)));
    uploadTzFile(groupId, doc.file);
  };

  const removeTzDoc = (groupId) => {
    setTzDocs((arr) => arr.filter((d) => d.groupId !== groupId));
  };

  // Удаление позиции сдвигает индексы — пересобираем привязку файлов ТЗ,
  // иначе следующая позиция унаследовала бы чужой документ
  const removeItem = async (i) => {
    // Позиция может содержать размерную сетку на несколько цветов × 7 размеров,
    // нанесения и приложенные к ней ТЗ — один промах стирал полчаса ввода
    // безвозвратно (новое состояние уезжает в черновик через 500 мс)
    const it = items[i];
    if (it && !isItemEmpty(it)) {
      const ok = await confirm({
        title: `Убрать позицию ${i + 1}?`,
        message: [
          it.product_type.trim() ? `«${it.product_type.trim()}»` : 'Заполненная позиция',
          'будет удалена вместе с размерной сеткой, нанесениями и приложенными к ней ТЗ.',
        ].join(' '),
        confirmLabel: 'Убрать',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setItems((arr) => arr.filter((_, idx) => idx !== i));
    const shift = (idx) => (idx > i ? idx - 1 : idx);
    setTzDocs((arr) => arr
      .filter((d) => d.itemIndex !== i)
      .map((d) => (d.itemIndex === null ? d : { ...d, itemIndex: shift(d.itemIndex) })));
    // Тот же сдвиг для файлов упаковки и техблока: иначе следующая позиция
    // унаследует чужое превью упаковки
    attach.dropItem(i);
  };

  /** Кнопка удаления нанесения стоит вплотную к полям «В, мм»/«Ш, мм» — спрашиваем, если не пустое */
  const removePrint = async (i, pi) => {
    const print = items[i]?.prints?.[pi];
    const filled = print && Object.entries(print)
      .some(([k, v]) => k !== 'method' && String(v ?? '').trim() !== '');
    if (filled) {
      const ok = await confirm({
        title: `Убрать нанесение ${pi + 1}?`,
        message: 'Заполненные размеры, зона, Pantone и комментарий будут удалены.',
        confirmLabel: 'Убрать',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setItems((arr) => arr.map((x, idx) => (
      idx === i ? { ...x, prints: x.prints.filter((_, j) => j !== pi) } : x)));
  };

  // Аккордеон-секции: все раскрыты по умолчанию
  const [open, setOpen] = useState({
    main: true, items: true, extra: true, tz: true,
    /**
     * Лист закупки свёрнут по умолчанию: закупка нужна не каждому заказу
     * (готовое изделие, давальческое сырьё, материалы подрядчика), и разворачивать
     * шесть полей всем подряд значит удлинять форму ради меньшинства случаев.
     * Резюме в заголовке показывает, есть ли внутри строки.
     */
    purchase: false,
  });
  const toggleSection = (key) => setOpen((o) => ({ ...o, [key]: !o[key] }));


  const tzValidation = useMemo(
    () => validateTzDocs(
      tzItems,
      tzDocs.map((d) => ({ itemIndex: d.itemIndex, uploaded: d.state === 'uploaded' })),
    ),
    [tzItems, tzDocs],
  );


  // Инлайн-валидация: после первой попытки сабмита ошибки живут вместе с вводом
  const [submitted, setSubmitted] = useState(false);
  const validation = useMemo(
    () => validateOrderForm(form, items, undefined, purchase),
    [form, items, purchase],
  );
  const fieldErrors = submitted ? validation.errors : {};
  const err = (key) => fieldErrors[key];
  const inputCls = (key) => (err(key) ? `${styles.input} ${styles.inputError}` : styles.input);

  // Автосейв черновика (debounce 500 мс); пустая форма — черновик удаляется
  useEffect(() => {
    const t = setTimeout(() => {
      if (isFormEmpty(form, items, initialLaunch) && purchase.every(isPurchaseRowEmpty)) {
        clearOrderDraft();
      } else {
        saveOrderDraft(form, items, purchase);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [form, items, purchase, initialLaunch]);

  const resetDraft = () => {
    clearOrderDraft();
    setForm(emptyOrderForm(initialLaunch));
    setItems([{ ...EMPTY_ITEM }]);
    setPurchase([]);
    setDraftRestored(false);
    setSubmitted(false);
  };

  // Закрытие (фон/крестик/Escape): пустая форма — сразу, иначе confirm
  const closingRef = useRef(false);
  const requestClose = async () => {
    if (saving || closingRef.current) return;
    if (isFormEmpty(form, items, initialLaunch) && purchase.every(isPurchaseRowEmpty)) {
      clearOrderDraft();
      onClose();
      return;
    }
    closingRef.current = true;
    const ok = await confirm({
      title: 'Закрыть форму заказа?',
      message: 'Заполненные поля сохранены как черновик — он восстановится при следующем '
        + 'открытии формы. Файлы (ТЗ и превью) в черновик не попадают: их придётся приложить заново.',
      confirmLabel: 'Закрыть',
      cancelLabel: 'Продолжить редактирование',
    });
    closingRef.current = false;
    if (ok) {
      saveOrderDraft(form, items, purchase);
      onClose();
    }
  };

  // Focus-trap + Escape → requestClose (важно: до эффекта autofocus, чтобы фокус остался на первом поле)
  const trapRef = useFocusTrap(true, requestClose);
  const firstFieldRef = useRef(null);

  useEffect(() => { firstFieldRef.current?.focus(); }, []);

  const setItem = (i, patch) =>
    setItems((arr) => arr.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  // Брендирование: при включении сразу добавляется одна пустая строка нанесения
  const setBranding = (i, on) =>
    setItems((arr) => arr.map((it, idx) =>
      idx === i
        ? {
            ...it,
            has_branding: on,
            prints: on && it.prints.length === 0 ? [{ ...EMPTY_PRINT }] : it.prints,
          }
        : it));

  const setPrint = (i, pi, patch) =>
    setItems((arr) => arr.map((it, idx) =>
      idx === i
        ? { ...it, prints: it.prints.map((p, j) => (j === pi ? { ...p, ...patch } : p)) }
        : it));

  const submit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    const { errors } = validateOrderForm(form, items, undefined, purchase);
    if (Object.keys(errors).length > 0) {
      // раскрыть секции с ошибками и проскроллить к первому ошибочному полю
      const inMain = Boolean(errors.title || errors.launch_date || errors.due_date);
      const inItems = Object.keys(errors).some((k) => k.startsWith('item_'));
      const inPurchase = Object.keys(errors).some((k) => k.startsWith('purchase_'));
      setOpen((o) => ({
        ...o,
        main: o.main || inMain,
        items: o.items || inItems,
        purchase: o.purchase || inPurchase,
      }));
      requestAnimationFrame(() => {
        const el = document.querySelector('[data-invalid="true"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (typeof el?.focus === 'function') el.focus({ preventScroll: true });
      });
      return;
    }
    const validItems = items.filter((it) => it.product_type.trim() && effectiveQty(it) > 0);
    // Гейт ТЗ (решение заказчика): у позиции с производственным маршрутом должно быть
    // ТЗ — своё или общее на заказ. Кнопка уже заблокирована, это страховка от Enter.
    if (tzValidation.missing.length > 0) {
      setOpen((o) => ({ ...o, tz: true }));
      toast.error(tzValidation.message);
      return;
    }
    if (tzUploading || tzFailed) {
      setOpen((o) => ({ ...o, tz: true }));
      toast.error(tzUploading
        ? 'ТЗ ещё загружается — дождитесь окончания'
        : 'ТЗ не загрузилось — повторите загрузку файла или уберите его');
      return;
    }
    /**
     * То же правило, что у ТЗ: заказ не создаётся, пока есть незавершённые
     * загрузки. Иначе форма покажет файл приложенным, а в Storage его не будет —
     * и обнаружит это цех, когда откроет пустое вложение.
     */
    if (attach.uploading || attach.failed) {
      toast.error(attach.uploading
        ? 'Файлы ещё загружаются — дождитесь окончания'
        : 'Файл не загрузился — повторите загрузку или уберите его');
      return;
    }

    setSaving(true);

    /**
     * Файлы ТЗ уже лежат в бакете (грузятся при выборе), заказ вместе с документами
     * создаётся одной транзакцией (RPC erp_create_order, секция tz). Иначе при сбое
     * дозагрузки остался бы заказ без ТЗ — ровно то, что запрещено.
     * Цена: файлы-сироты в tz/new/, если RPC упадёт или форму закроют; удалять из
     * бакета клиент не может (политика delete — только admin), поэтому префикс
     * намеренно отдельный.
     */
    const formToPayloadIndex = new Map(
      items
        .map((it, index) => ({ it, index }))
        .filter(({ it }) => it.product_type.trim() && effectiveQty(it) > 0)
        .map(({ index }, payloadIndex) => [index, payloadIndex]),
    );
    const actor = currentActor();
    const tzDocuments = [];
    for (const d of tzDocs) {
      if (d.state !== 'uploaded' || !d.path) continue;
      const itemIndex = d.itemIndex === null ? null : formToPayloadIndex.get(d.itemIndex);
      if (d.itemIndex !== null && itemIndex === undefined) continue; // позиция выпала из заказа
      tzDocuments.push({
        group_id: d.groupId,
        item_index: itemIndex ?? null,
        file_path: d.path,
        file_name: d.file.name,
        mime_type: TZ_MIME,
        size_bytes: d.file.size,
        uploaded_by: actor,
      });
    }
    let created = null;
    try {
    /**
     * Лист закупки: пустые строки отбрасываются, `item_index` пересобирается
     * под НОВУЮ нумерацию позиций — та же карта, что у ТЗ. Без неё материал,
     * привязанный к третьей позиции, уехал бы к другой, если вторая пустая
     * и в заказ не попала.
     */
    /**
     * Ключи строк В ТОМ ЖЕ ПОРЯДКЕ, в каком они уедут в секцию `materials`, —
     * по ним считается `material_index` файлов. Считать индекс по положению
     * в состоянии формы нельзя: пустые строки отбрасываются, и привязка
     * сдвинулась бы у всех, кто ниже.
     */
    const purchaseRows = purchase.filter((r) => !isPurchaseRowEmpty(r) && r.name.trim());
    const purchaseKeys = purchaseRows.map((r) => r.key);
    const materials = purchaseRows
      .map((r) => {
        const idx = r.item_index === null ? null : formToPayloadIndex.get(r.item_index);
        return {
          // Материал позиции, которая выпала из заказа, становится общим
          // по заказу, а не теряется вместе с ней: потребность реальна
          item_index: idx === undefined ? null : idx,
          kind: r.kind,
          role: r.role,
          name: r.name.trim(),
          color: r.color.trim() || undefined,
          qty_expected: Number(r.qty_expected) || null,
          unit: r.unit.trim() || undefined,
          manager_note: r.manager_note.trim() || undefined,
          source: 'purchase',
          status: 'pending',
        };
      });

    created = await createOrder({
      materials,
      // Вложения блоков: упаковка, техблок, лист закупки. Файлы уже в бакете —
      // грузятся при выборе, RPC только привязывает их одной транзакцией
      attachments: attach.payload(purchaseKeys),
      tz_required: true,
      // assignments не заполняем: ТЗ принадлежит позиции и видно всему её маршруту
      tz: { documents: tzDocuments, assignments: [] },
      bitrix_id: form.bitrix_id.trim() || undefined,
      title: form.title.trim(),
      customer: form.customer.trim() || undefined,
      manager: form.manager.trim() || undefined,
      launch_date: form.launch_date || undefined,
      due_date: form.due_date || undefined,
      buffer_days: Math.max(0, Number(form.buffer_days) || 0),
      packaging: form.packaging,
      packaging_note: form.packaging === 'other' ? form.packaging_note.trim() || undefined : undefined,
      stickers: form.stickers,
      stickers_note: form.stickers === 'other' ? form.stickers_note.trim() || undefined : undefined,
      no_chestny_znak: form.no_chestny_znak,
      items: validItems.map((it) => {
        const prints = it.has_branding ? it.prints : [];
        return {
          product_type: it.product_type.trim(),
          variant: it.variant.trim() || undefined,
          // сетка заполнена → количество из сетки, иначе ручной ввод
          qty: effectiveQty(it),
          production_type: it.production_type,
          // Технический блок и упаковка позиции (правки заказчика 16.08).
          // Пустое поле уходит undefined, а не пустой строкой: иначе колонка
          // хранит '' и «не заполняли» становится неотличимо от «заполнили
          // пустым» — а по этому различию считается, показывать ли блок цеху.
          fit: it.fit.trim() || undefined,
          trim_material: it.trim_material.trim() || undefined,
          cutting_note: it.cutting_note.trim() || undefined,
          sewing_note: it.sewing_note.trim() || undefined,
          labels_note: it.labels_note.trim() || undefined,
          packaging: it.packaging || 'inherit',
          packaging_size: it.packaging_size.trim() || undefined,
          sticker_place: it.sticker_place.trim() || undefined,
          marking_place: it.marking_place.trim() || undefined,
          packaging_note: it.packaging_note.trim() || undefined,
          // Подряд (волна 4.2): тип и источник материалов только для типа «Подряд»
          ...(it.production_type === 'outsource'
            ? { subcontract_kind: it.subcontract_kind || 'finished_product',
                material_source: it.material_source || 'pinhead',
                // Операция (правка 4.2.3) — только для отдельной операции
                subcontract_operation: (it.subcontract_kind || 'finished_product') === 'operation'
                  ? (it.subcontract_operation?.trim() || undefined) : undefined,
                // Следующий участок — только если для отдельной операции нужна доработка
                return_dept: (it.subcontract_kind || 'finished_product') === 'operation' && it.needs_further
                  ? (it.return_dept || null) : null }
            : {}),
          // маршрут строится по техникам из блоков «Нанесение №N»
          branding_methods: [...new Set(prints.map((p) => p.method))],
          /**
           * Правка маршрута человеком едет как есть; не тронутый маршрут —
           * `undefined`, и стор посчитает его сам тем же `formItemRoute`.
           * Передаём именно ПРАВКУ, а не готовый маршрут: правило «правка или
           * расчёт» должно остаться в одном месте, иначе форма и стор начнут
           * решать это по-разному.
           */
          route: it.route,
          branding_on: it.branding_on,
          size_grid: gridToPayload(it.size_grid),
          prints: prints.map((p) => ({
            method: p.method,
            zone: p.zone.trim() || undefined,
            width_mm: Number(p.width_mm) || null,
            height_mm: Number(p.height_mm) || null,
            offset_note: p.offset_note.trim() || undefined,
            pantone: p.pantone.trim() || undefined,
            comment: p.comment.trim() || undefined,
          })),
        };
      }),
    });
    if (created && previewFile) {
      await uploadOrderPreview(created.id, previewFile);
    }
    } finally {
      // `setSaving(false)` обязан быть в finally. Внутри два сетевых вызова,
      // и брошенное исключение (нет сети, CORS) оставило бы кнопку в
      // «Создание…» навсегда — вместе со всем заполненным заказом, который
      // человек набирал минутами. Сообщение об ошибке показывает стор.
      setSaving(false);
    }
    if (created) {
      clearOrderDraft();
      toast.success(`Заказ «${created.title}» создан, маршрут построен`);
      onClose();
    }
  };

  const printsCount = items.reduce((s, it) => s + (it.has_branding ? it.prints.length : 0), 0);
  const mainSummary = [
    form.title.trim() || 'без названия',
    form.due_date
      ? `до ${formatDateShort(form.due_date)}`
      : null,
  ].filter(Boolean).join(' · ');
  const itemsSummary =
    `${items.length} ${pluralize(items.length, 'позиция', 'позиции', 'позиций')}` +
    ` · ${printsCount} ${pluralize(printsCount, 'нанесение', 'нанесения', 'нанесений')}`;
  const purchaseFilled = purchase.filter((r) => !isPurchaseRowEmpty(r)).length;
  const purchaseSummary = purchaseFilled === 0
    ? 'закупка не требуется'
    : `${purchaseFilled} ${pluralize(purchaseFilled, 'позиция', 'позиции', 'позиций')}`;
  const tzUploaded = tzDocs.filter((d) => d.state === 'uploaded').length;
  const tzSummary = tzUploading
    ? 'загружается…'
    : tzFailed
      ? 'ошибка загрузки'
      : tzValidation.missing.length > 0
        ? `нет ТЗ у позиций: ${tzValidation.missing.length}`
        : `${tzUploaded} ${pluralize(tzUploaded, 'файл', 'файла', 'файлов')} · загружено`;
  const extraSummary = [
    `упаковка: ${PACKAGING_LABELS[form.packaging]}`,
    `стикеры: ${STICKERS_LABELS[form.stickers]}`,
    form.no_chestny_znak ? 'без ЧЗ' : null,
    previewFile ? 'превью добавлено' : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className={styles.modalOverlay} onClick={requestClose} role="presentation">
      <form
        ref={trapRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label="Новый производственный заказ"
      >
        <div className={styles.modalTitle}>Новый заказ</div>

        {draftRestored && (
          <div className={styles.draftBanner} role="status">
            <span>Восстановлен черновик</span>
            <Button variant="ghost" onClick={resetDraft}>
              Очистить
            </Button>
          </div>
        )}

        {/* Подсказки справочников для полей «Изделие» и «Поставщик» (правка 12) */}
        <DictionaryDatalist kind="product_type" id="erp-product-types" />
        {/* Подсказки кроя: Regular / Oversize / Free Fit — ввод остаётся свободным */}
        <DictionaryDatalist kind="fit" id="erp-fits" />
        <DictionaryDatalist kind="supplier" id="erp-suppliers" />

        <FormSection
          id="order-section-main"
          title="Основное"
          summary={mainSummary}
          open={open.main}
          onToggle={() => toggleSection('main')}
        >
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>№ сделки Bitrix</span>
            <input
              ref={firstFieldRef}
              className={styles.input}
              value={form.bitrix_id}
              onChange={(e) => setForm({ ...form, bitrix_id: e.target.value })}
              placeholder="напр. 54766"
              aria-describedby={dupes.length > 0 ? 'bitrix-dupes' : undefined}
            />
            {dupes.length > 0 && (
              <span id="bitrix-dupes" className={styles.fieldHint} role="status">
                <Icon name="alert" size={13} />
                {' '}
                {dupes.length === 1
                  ? `Заказ с этим № сделки уже есть: «${dupes[0].title}»`
                  : `Заказов с этим № сделки уже ${dupes.length}: ${dupes.map((d) => `«${d.title}»`).join(', ')}`}
                {'. Создать ещё один можно — проверьте, что это не повтор.'}
              </span>
            )}
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Название *</span>
            <input
              className={inputCls('title')}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="напр. BOX39 свитшоты"
              required
              maxLength={140}
              aria-invalid={err('title') ? true : undefined}
              aria-describedby={err('title') ? 'err-order-title' : undefined}
              data-invalid={err('title') ? true : undefined}
            />
            <FieldError id="err-order-title" text={err('title')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Клиент</span>
            <input
              className={styles.input}
              value={form.customer}
              onChange={(e) => setForm({ ...form, customer: e.target.value })}
              placeholder="напр. BOX39"
              maxLength={140}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Менеджер</span>
            <input
              className={styles.input}
              value={form.manager}
              onChange={(e) => setForm({ ...form, manager: e.target.value })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Дата запуска</span>
            <DateField
              min={initialLaunch}
              className={inputCls('launch_date')}
              value={form.launch_date}
              onChange={(v) => setForm({ ...form, launch_date: v })}
              aria-invalid={err('launch_date') ? true : undefined}
              aria-describedby={err('launch_date') ? 'err-order-launch' : undefined}
              data-invalid={err('launch_date') ? true : undefined}
            />
            <FieldError id="err-order-launch" text={err('launch_date')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок клиента</span>
            <DateField
              min={initialLaunch}
              className={inputCls('due_date')}
              value={form.due_date}
              onChange={(v) => setForm({ ...form, due_date: v })}
              aria-invalid={err('due_date') ? true : undefined}
              aria-describedby={err('due_date') ? 'err-order-due' : undefined}
              data-invalid={err('due_date') ? true : undefined}
            />
            <FieldError id="err-order-due" text={err('due_date')} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Буфер, дн.</span>
            <input
              type="number"
              min="0"
              className={styles.input}
              value={form.buffer_days}
              onChange={(e) => setForm({ ...form, buffer_days: e.target.value.replace('-', '') })}
            />
            <span className={styles.subText}>Запас до срока клиента</span>
          </label>
        </div>
        </FormSection>

        <FormSection
          id="order-section-items"
          title="Позиции и ТЗ"
          summary={itemsSummary}
          open={open.items}
          onToggle={() => toggleSection('items')}
        >
        {items.map((it, i) => (
          <ItemBlock
            key={i}
            it={it}
            i={i}
            itemsCount={items.length}
            err={err}
            inputCls={inputCls}
            route={itemRoutes[i]}
            attach={attach}
            setItem={setItem}
            setBranding={setBranding}
            setPrint={setPrint}
            removeItem={removeItem}
            removePrint={removePrint}
          />
        ))}
        <div>
          <Button variant="secondary" onClick={() => setItems((arr) => [...arr, { ...EMPTY_ITEM }])}>
            + Добавить позицию
          </Button>
        </div>
        </FormSection>

        <FormSection
          id="order-section-tz"
          title="ТЗ в PDF для цехов"
          summary={tzSummary}
          open={open.tz}
          onToggle={() => toggleSection('tz')}
        >
        <TzSection
          tzItems={tzItems}
          tzDocs={tzDocs}
          addTzDoc={addTzDoc}
          removeTzDoc={removeTzDoc}
          retryTzDoc={retryTzDoc}
        />
        </FormSection>

        <FormSection
          id="order-section-purchase"
          title="Лист закупки"
          summary={purchaseSummary}
          open={open.purchase}
          onToggle={() => toggleSection('purchase')}
        >
        <PurchaseListSection
          attach={attach}
          rows={purchase}
          items={items}
          err={err}
          inputCls={inputCls}
          addRow={addPurchaseRow}
          setRow={setPurchaseRow}
          removeRow={removePurchaseRow}
        />
        </FormSection>

        <FormSection
          id="order-section-extra"
          title="Упаковка и доп."
          summary={extraSummary}
          open={open.extra}
          onToggle={() => toggleSection('extra')}
        >
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Упаковка</span>
            <div className={styles.tileRow} role="radiogroup" aria-label="Упаковка">
              {Object.entries(PACKAGING_LABELS).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={form.packaging === v}
                  className={`${styles.tile} ${form.packaging === v ? styles.tileActive : ''}`}
                  onClick={() => setForm({ ...form, packaging: v })}>
                  {l}
                </button>
              ))}
            </div>
            {form.packaging === 'other' && (
              <input className={styles.input} placeholder="Какая? (с дизайном…)"
                value={form.packaging_note}
                onChange={(e) => setForm({ ...form, packaging_note: e.target.value })} />
            )}
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Стикеры</span>
            <div className={styles.tileRow} role="radiogroup" aria-label="Стикеры">
              {Object.entries(STICKERS_LABELS).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={form.stickers === v}
                  className={`${styles.tile} ${form.stickers === v ? styles.tileActive : ''}`}
                  onClick={() => setForm({ ...form, stickers: v })}>
                  {l}
                </button>
              ))}
            </div>
            {form.stickers === 'other' && (
              <input className={styles.input} placeholder="Какие? (со смежными размерами…)"
                value={form.stickers_note}
                onChange={(e) => setForm({ ...form, stickers_note: e.target.value })} />
            )}
          </div>
          <label className={`${styles.checkLabel} ${styles.checkLabelEnd}`}>
            <input
              type="checkbox"
              checked={form.no_chestny_znak}
              onChange={(e) => setForm({ ...form, no_chestny_znak: e.target.checked })}
            />
            Без Честного знака
          </label>
        </div>

        <div
          className={styles.dropZone}
          role="button"
          tabIndex={0}
          aria-label="Превью заказа: перетащите картинку, вставьте Ctrl+V или кликните"
          onClick={() => fileInputRef.current?.click()}
          // Space — такая же активация, как Enter, для role="button" (WCAG 2.1.1)
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            if (e.target !== e.currentTarget) return; // вложенной кнопке — её событие
            e.preventDefault();
            fileInputRef.current?.click();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); acceptPreview(e.dataTransfer.files?.[0]); }}
        >
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="Превью заказа" className={styles.dropZoneImg} />
              <Button
                variant="ghost"
                onClick={(e) => { e.stopPropagation(); setPreviewFile(null); setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return null; }); }}>
                <span className={styles.cellWithIcon}><Icon name="x" size={14} /> Убрать</span>
              </Button>
            </>
          ) : (
            <span className={styles.subText}>
              <Icon name="image" size={14} /> Превью заказа: перетащите картинку сюда, вставьте <kbd>Ctrl+V</kbd> или кликните
              (JPG/PNG/WEBP до 2 МБ)
            </span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: 'none' }}
            onChange={(e) => acceptPreview(e.target.files?.[0])}
          />
        </div>

        </FormSection>

        <div className={styles.modalActions}>
          {submitted && validation.missing.length > 0 && (
            <span className={styles.remainingHint} role="status">
              Осталось заполнить: {validation.missing.join(', ')}
            </span>
          )}
          {/* Заполнено, но неверно — отдельная формулировка: «Осталось заполнить:
              Дата запуска» при заполненной дате сбивало с толку */}
          {submitted && validation.invalid.length > 0 && (
            <span className={styles.remainingHint} role="status">
              Проверьте: {validation.invalid.join(', ')}
            </span>
          )}
          {/* Требование заказчика: без ТЗ кнопка недоступна СРАЗУ, с конкретной причиной.
              Незавершённая загрузка — та же история: пока файла нет в бакете, заказ
              создавать нельзя, и человек должен видеть, чего ждёт */}
          {(tzUploading || tzFailed || tzValidation.message) && (
            <span className={`${styles.remainingHint} ${styles.tzAssignMissing}`} role="status">
              {tzUploading
                ? 'ТЗ загружается — дождитесь окончания'
                : tzFailed
                  ? 'ТЗ не загрузилось — повторите загрузку файла или уберите его'
                  : tzValidation.message}
            </span>
          )}
          <Button variant="ghost" onClick={requestClose}>Отмена</Button>
          <Button
            variant="primary"
            type="submit"
            disabled={saving || tzUploading || tzFailed || attach.uploading || attach.failed
          || tzValidation.missing.length > 0
          || (submitted && (validation.missing.length > 0 || validation.invalid.length > 0))}>
            {saving ? 'Создание…' : 'Создать заказ'}
          </Button>
        </div>
      </form>
    </div>
  );
}
