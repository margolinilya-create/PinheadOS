import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
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
  effectiveQty,
  emptyPrint,
  emptyOrderForm,
  gridToPayload,
  isFormEmpty,
  isItemEmpty,
  loadOrderDraft,
  normalizeDraft,
  validateOrderForm,
} from '../../utils/orderForm';
import { managerOptions } from '../../utils/managers';
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
import styles from '../../styles';

// Секции и примитивы формы вынесены в ./create/ — модалка осталась композицией
import { FormSection, FieldError } from './create/FormParts';
import { TzSection } from './create/TzSection';
import { PurchaseListSection } from './create/PurchaseListSection';
import { NotesSection } from './create/NotesSection';
import { useAttachmentUploads } from '../../hooks/useAttachmentUploads';
import { ItemBlock } from './create/ItemBlock';
import { Button } from '../../components/Button';
import { scrollIntoViewSafely } from '../../utils/scrollIntoViewSafely';

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


/**
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
export function CreateOrderModal({ onClose, draftId = null }) {
  const createOrder = useErpStore((s) => s.createOrder);
  const findOrdersByBitrixId = useErpStore((s) => s.findOrdersByBitrixId);
  const departments = useErpStore((s) => s.departments);
  const [saving, setSaving] = useState(false);
  /*
    БЛОКА «ПРЕВЬЮ ЗАКАЗА» БОЛЬШЕ НЕТ (правки 07.09, п. 15). Вместе с ним ушли
    состояние `previewFile`/`previewUrl`, приём Ctrl+V на всё окно и вызов
    `uploadOrderPreview` после создания.

    Первая редакция этого комментария обещала, что «само действие стора
    остаётся: превью грузится и из карточки заказа». ЭТО БЫЛО НЕПРАВДОЙ:
    вызывающих у `uploadOrderPreview` не осталось ни одного, то есть вид
    вложения `preview` перестал создаваться вовсе, а показывали его три
    поверхности — очередь цеха, канбан и страница задания. Они рисовали бы
    картинку, которой больше не бывает.

    Разобрано по ЖИВЫМ ДАННЫМ: вложений вида `preview` на боевой базе НОЛЬ
    за всё время. Дроп-зоной не воспользовались ни разу — то есть заказчик
    убрал блок, которым и не пользовались, а показ был мёртвой веткой ещё
    до правки. Поэтому ввод не возвращён, а снят и показ: действие стора,
    хелпер `orderPreviewUrl`, три ветки показа и осиротевший `Lightbox`.
    Понадобится превью снова — это ввод в карточке заказа, рядом с файлами,
    а не дроп-зона в форме создания.
  */
  // Дата запуска по умолчанию — сегодня; черновик восстанавливается из localStorage
  const initialLaunch = useMemo(() => factoryToday(), []);
  const {
    drafts, saveDraftRow, deleteDraftRow,
    employees, profilesList, employeesLoaded, loadEmployees,
  } = useErpStore(useShallow((s) => ({
    drafts: s.orderDrafts,
    saveDraftRow: s.saveOrderDraft,
    deleteDraftRow: s.deleteOrderDraft,
    employees: s.employees,
    profilesList: s.profilesList,
    employeesLoaded: s.employeesLoaded,
    loadEmployees: s.loadEmployees,
  })));
  /**
   * Список сотрудников под подсказку поля «Менеджер» (правки 07.09, п. 1).
   *
   * Грузится ЗДЕСЬ, а не берётся готовым: `erp_bootstrap` отдаёт только
   * `my_employee` (свой цех и роль), а массива сотрудников в пакете нет вовсе —
   * на странице заказов он пуст. Отказ загрузки поле не ломает: подсказка
   * пропадёт, свободный ввод останется.
   */
  useEffect(() => {
    if (!employeesLoaded) loadEmployees();
  }, [employeesLoaded, loadEmployees]);
  const managers = useMemo(
    () => managerOptions(employees, profilesList),
    [employees, profilesList],
  );
  /**
   * Открытый черновик берётся ОДИН РАЗ, при монтировании: дальше форма — сама
   * себе источник правды, и перечитывание строки из стора после каждого
   * автосохранения затирало бы то, что человек печатает прямо сейчас.
   */
  const [restoredDraft] = useState(() => {
    if (draftId) {
      const row = drafts.find((d) => d.id === draftId);
      return row?.payload ? normalizeDraft(row.payload) : null;
    }
    // Разовый перенос локального черновика прежней версии
    return loadOrderDraft();
  });
  const [rowId, setRowId] = useState(draftId);
  const [form, setForm] = useState(() => restoredDraft?.form ?? emptyOrderForm(initialLaunch));
  const [items, setItems] = useState(() => restoredDraft?.items ?? [{ ...EMPTY_ITEM }]);
  /*
    СТРОК-ПОДСКАЗОК ЛИСТА ЗАКУПКИ БОЛЬШЕ НЕТ (правки 07.09, п. 14): состояние
    `purchase`, его действия и секция `materials` payload ушли вместе с блоком.
    Потребность задаёт ФАЙЛ (`kind: 'purchase_list'`), а сказать словами есть
    куда — «Заметки к заказу» и комментарий. Восстановленный черновик со
    строками не падает: `normalizeDraft` их вернёт, а форма просто не покажет.
  */
  /**
   * Заметки к заказу (правка 22.08, п. 5.8). Уровня ЗАКАЗА, а не позиции,
   * и живут в черновике вместе с формой: File-объекты в них не попадают —
   * изображения держит `useAttachmentUploads`, как и остальные вложения.
   */
  const [notes, setNotes] = useState(() => restoredDraft?.notes ?? []);
  /**
   * Вложения блоков: упаковка, техблок, лист закупки (правки заказчика 16.08 —
   * документ требует файлы в шести местах). File-объекты живут ОТДЕЛЬНО от
   * form/items, как и ТЗ: черновик пишется через `JSON.stringify`, и File
   * сериализовался бы в `{}` молча.
   */
  const attach = useAttachmentUploads('new');
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
    // Контекст заказа обязаны передавать ВСЕ читатели правила: иначе гейт ТЗ
    // считался бы по маршруту с закупкой, а заказ создался бы без неё
    () => items.map((it) => formItemRoute(it, { needsPurchase: form.purchase_required !== false })),
    [items, form.purchase_required],
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

  /**
   * Копия позиции (п. 5.7). Ключи нанесений и бирок ПЕРЕСОЗДАЮТСЯ: по ним
   * файлы находят свою строку, и общий ключ отдал бы копии чужой макет.
   * Файлы копируются следом — по новым ключам и настоящими объектами
   * в бакете, а не ссылкой на тот же путь.
   */
  const copyItem = (i) => {
    const src = items[i];
    if (!src) return;
    const prints = (src.prints ?? []).map((p) => ({ ...p, key: crypto.randomUUID() }));
    const labels = (src.labels ?? []).map((l) => ({ ...l, key: crypto.randomUUID() }));
    setItems((arr) => [...arr, { ...src, route: undefined, prints, labels }]);
    // Макеты и файлы бирок копируются вместе со строками (п. 5.4): копируют
    // затем, чтобы не заводить одно и то же дважды
    (src.prints ?? []).forEach((p, j) => attach.copyOwner(p.key, prints[j].key));
    (src.labels ?? []).forEach((l, j) => attach.copyOwner(l.key, labels[j].key));
  };

  /**
   * Копирование ОДНОГО нанесения из другой позиции (п. 5.4): «в одной сделке
   * могут быть футболка и свитшот с полностью одинаковыми нанесениями».
   * Копируются ВСЕ семь полей документа, включая прикреплённый макет.
   * После копирования данные правятся независимо от источника.
   */
  const copyPrint = (targetIndex, sourceIndex, printIndex) => {
    const src = items[sourceIndex]?.prints?.[printIndex];
    if (!src) return;
    const copy = { ...src, key: crypto.randomUUID() };
    setItems((arr) => arr.map((it, idx) => (idx === targetIndex
      ? { ...it, has_branding: true, prints: [...it.prints, copy] }
      : it)));
    // Документ перечисляет «прикреплённый макет» среди копируемого (п. 5.4):
    // объект в бакете копируется настоящий, иначе удаление одной строки
    // унесло бы файл у другой
    attach.copyOwner(src.key, copy.key);
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
    main: true, items: true, extra: true, tz: true, notes: false,
    /**
     * Лист закупки РАЗВЁРНУТ (правки 20.08). Он был свёрнут, пока внутри лежали
     * необязательные строки. Теперь там обязательное решение — приложить лист
     * или отметить «закупка не требуется», — и прятать его за свёрнутым
     * заголовком значит гарантировать, что человек упрётся в отказ сабмита,
     * не понимая, где именно поле.
     */
    purchase: true,
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
  /**
   * Приложен ли файл листа закупки. Считаем по СОСТОЯНИЮ загрузки, а не по
   * «есть ли выбранный файл»: файл, который ещё грузится или упал, приложенным
   * не является — иначе форма отпустила бы заказ с листом, которого нет
   * в Storage (правило «файл уходит в бакет при выборе»).
   */
  const hasPurchaseList = attach.files.some(
    (f) => f.kind === 'purchase_list' && f.state === 'uploaded',
  );
  const validation = useMemo(
    () => validateOrderForm(form, items, undefined, hasPurchaseList),
    [form, items, hasPurchaseList],
  );
  const fieldErrors = submitted ? validation.errors : {};
  const err = (key) => fieldErrors[key];
  const inputCls = (key) => (err(key) ? `${styles.input} ${styles.inputError}` : styles.input);

  /**
   * Автосейв черновика (debounce 500 мс) — теперь В БАЗУ.
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
    const t = setTimeout(async () => {
      try {
        if (isFormEmpty(form, items, initialLaunch)) {
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
        const title = form.title.trim() || (form.bitrix_id.trim() ? `№${form.bitrix_id.trim()}` : null);
        const row = await saveDraftRow(
          rowIdRef.current, title, { form, items, notes });
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
  }, [form, items, notes, initialLaunch, saveDraftRow, deleteDraftRow]);

  const resetDraft = async () => {
    clearOrderDraft();
    if (rowIdRef.current) {
      const id = rowIdRef.current;
      rowIdRef.current = null;
      setRowId(null);
      await deleteDraftRow(id);
    }
    setForm(emptyOrderForm(initialLaunch));
    setItems([{ ...EMPTY_ITEM }]);
    setDraftRestored(false);
    setSubmitted(false);
  };

  // Закрытие (фон/крестик/Escape): пустая форма — сразу, иначе confirm
  const closingRef = useRef(false);
  const requestClose = async () => {
    if (saving || closingRef.current) return;
    if (isFormEmpty(form, items, initialLaunch)) {
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
      // Автосейв уже записал состояние в базу; здесь только выходим
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
            prints: on && it.prints.length === 0 ? [emptyPrint()] : it.prints,
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
    const { errors } = validateOrderForm(form, items, undefined, hasPurchaseList);
    if (Object.keys(errors).length > 0) {
      // раскрыть секции с ошибками и проскроллить к первому ошибочному полю
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
     * Ключи заметок В ТОМ ЖЕ ПОРЯДКЕ, в каком они уедут в секцию `notes`:
     * по ним изображение находит свою заметку. Отбор здесь обязан совпадать
     * с отбором в самой секции — иначе подпись уедет к соседней картинке.
     */
    const noteKeys = notes
      .filter((n) => n.text.trim() || attach.files.some(
        (f) => f.ownerKey === n.key && f.state === 'uploaded'))
      .map((n) => n.key);

    created = await createOrder({
      /*
        Секция `materials` уезжает ПУСТОЙ (правки 07.09, п. 14): строки-подсказки
        менеджера убраны, а строки закупки заводит закупщик у себя. Ключ секции
        оставлен — RPC его принимает, и убирать его из контракта ради пустого
        массива значило бы менять функцию БД без нужды.
      */
      materials: [],
      // Вложения блоков: упаковка, техблок, лист закупки. Файлы уже в бакете —
      // грузятся при выборе, RPC только привязывает их одной транзакцией
      attachments: attach.payload([], noteKeys),
      /**
       * Заметки к заказу (п. 5.8). Совсем пустая не едет: человек мог нажать
       * «+ Заметка» и передумать — то же правило, что у строк листа закупки
       * и бирок. Изображение без текста заметкой является: подпись
       * необязательна, а фото само по себе несёт смысл.
       */
      notes_list: notes
        .filter((n) => n.text.trim() || attach.files.some(
          (f) => f.ownerKey === n.key && f.state === 'uploaded'))
        .map((n, i) => ({ seq: i + 1, text: n.text.trim() || null })),
      tz_required: true,
      // assignments не заполняем: ТЗ принадлежит позиции и видно всему её маршруту
      tz: { documents: tzDocuments, assignments: [] },
      bitrix_id: form.bitrix_id.trim() || undefined,
      title: form.title.trim(),
      customer: form.customer.trim() || undefined,
      manager: form.manager.trim() || undefined,
      launch_date: form.launch_date || undefined,
      due_date: form.due_date || undefined,
      // `buffer_days` не шлём (правки 07.09, п. 2) — RPC подставит дефолт 0
      packaging: form.packaging,
      packaging_note: form.packaging === 'other' ? form.packaging_note.trim() || undefined : undefined,
      // Размер упаковки (п. 16). У «Нет» размера не бывает — не шлём вовсе
      packaging_width_mm: form.packaging === 'none'
        ? undefined : Number(form.packaging_width_mm) || undefined,
      packaging_height_mm: form.packaging === 'none'
        ? undefined : Number(form.packaging_height_mm) || undefined,
      stickers: form.stickers,
      stickers_note: form.stickers === 'other' ? form.stickers_note.trim() || undefined : undefined,
      no_chestny_znak: form.no_chestny_znak,
      // Отметка «Закупка не требуется»: заказ не появится у закупщика,
      // и этап «Закупка» в маршрут не попадёт (`buildItemRoute`)
      purchase_required: form.purchase_required !== false,
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
          // Основная ткань — отдельным полем (правка 22.08, п. 5.1)
          main_fabric: it.main_fabric.trim() || undefined,
          trim_material: it.trim_material.trim() || undefined,
          cutting_note: it.cutting_note.trim() || undefined,
          sewing_note: it.sewing_note.trim() || undefined,
          labels_note: it.labels_note.trim() || undefined,
          packaging: it.packaging || 'inherit',
          packaging_size: it.packaging_size.trim() || undefined,
          sticker_place: it.sticker_place.trim() || undefined,
          marking_place: it.marking_place.trim() || undefined,
          packaging_note: it.packaging_note.trim() || undefined,
          // Размер упаковки позиции (п. 16). Пусто — берётся размер заказа
          packaging_width_mm: Number(it.packaging_width_mm) || undefined,
          packaging_height_mm: Number(it.packaging_height_mm) || undefined,
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
            // Ключ уезжает в стор, а не на сервер: по нему макет находит
            // своё нанесение, пока строки `erp_item_prints` ещё не существует
            key: p.key,
            method: p.method,
            zone: p.zone.trim() || undefined,
            width_mm: Number(p.width_mm) || null,
            height_mm: Number(p.height_mm) || null,
            offset_note: p.offset_note.trim() || undefined,
            pantone: p.pantone.trim() || undefined,
            /*
              Эффект и тип изделия — величины РАЗНЫХ техник (пп. 10 и 11),
              и каждая едет только со своей: эффект, оставшийся от переключения
              на вышивку, читался бы цехом как требование к вышивке.
            */
            special: p.method === 'silkscreen'
              ? (p.special?.trim() || undefined) : undefined,
            garment_kind: p.method === 'embroidery'
              ? (p.garment_kind || undefined) : undefined,
            comment: p.comment.trim() || undefined,
          })),
          /**
           * Бирки позиции (правка 22.08, п. 5.3). Совсем пустая строка
           * не едет: человек мог нажать «+ Бирка» и передумать — тем же
           * правилом отбрасываются пустые строки листа закупки.
           */
          labels: (it.labels ?? [])
            .filter((l) => l.label_type.trim() || l.place.trim()
              || l.size.trim() || l.comment.trim())
            .map((l) => ({
              key: l.key,
              label_type: l.label_type.trim() || undefined,
              place: l.place.trim() || undefined,
              size: l.size.trim() || undefined,
              comment: l.comment.trim() || undefined,
            })),
        };
      }),
    });
    } finally {
      // `setSaving(false)` обязан быть в finally. Внутри два сетевых вызова,
      // и брошенное исключение (нет сети, CORS) оставило бы кнопку в
      // «Создание…» навсегда — вместе со всем заполненным заказом, который
      // человек набирал минутами. Сообщение об ошибке показывает стор.
      setSaving(false);
    }
    if (created) {
      clearOrderDraft();
      // Черновик отработал: заказ создан, держать его снимок больше незачем
      if (rowIdRef.current) await deleteDraftRow(rowIdRef.current);
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
  const purchaseSummary = form.purchase_required === false
    ? 'закупка не требуется'
    : hasPurchaseList
      ? 'лист приложен'
      : 'лист не приложен';
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
    form.packaging !== 'none' && Number(form.packaging_width_mm) > 0
      && Number(form.packaging_height_mm) > 0
      ? `${form.packaging_width_mm}×${form.packaging_height_mm} мм`
      : null,
    `стикеры: ${STICKERS_LABELS[form.stickers]}`,
    form.no_chestny_znak ? 'без ЧЗ' : null,
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
        {/*
          Справочника кроя больше нет: 18.08 его удалили из базы («крой
          подсказывает КАТАЛОГ, а не справочник» — миграция 20260818203320),
          а вид `fit` убрали из CHECK. Клиент про это не знал и продолжал
          показывать вкладку в админке, где добавление значения отвечало бы
          23514. Поле «Крой» остаётся свободным вводом с подсказкой
          в placeholder; подстановка из каталога SKU — отдельная работа.
        */}
        <DictionaryDatalist kind="supplier" id="erp-suppliers" />
        {/* Подсказки поля «Эффекты» у нанесения шелкографией (правки 07.09, п. 10) */}
        <DictionaryDatalist kind="print_effect" id="erp-print-effects" />

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
            {/*
              ВЫПАДАЮЩИЙ СПИСОК ПОВЕРХ СВОБОДНОГО ВВОДА (правки 07.09, п. 1).
              Не `select`: в `erp_employees` менеджеров сопровождения нет ни
              одного (пять человек — директор и четыре руководителя
              производства), а в заведённых заказах менеджеры записаны
              вразнобой — «Никита», «никита», «игорь». Закрытый список сегодня
              был бы пуст, то есть поле стало бы незаполнимым; `datalist`
              убирает разнобой и не запирает заказ из-за незаведённого
              сотрудника — тот же приём, что у справочников раздела.
            */}
            <input
              className={styles.input}
              list="erp-managers"
              value={form.manager}
              onChange={(e) => setForm({ ...form, manager: e.target.value })}
              placeholder="кто ведёт заказ"
              maxLength={140}
            />
            <datalist id="erp-managers">
              {managers.map((m) => <option key={m} value={m} />)}
            </datalist>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Дата запуска</span>
            {/*
              `min` ЗДЕСЬ НЕТ СОЗНАТЕЛЬНО (правка заказчика 30.08, п. 10).
              Заказ, фактически запущенный раньше, переносят в ERP задним
              числом, и календарь, не дающий выбрать прошедший день, делал
              такой перенос невозможным вовсе. Дата запуска — ФАКТ, а не
              намерение; системная дата создания записи от неё не зависит
              (`created_at` ставит база).

              У «Срока клиента» ниже `min` остаётся: срок в прошлом —
              это ошибка ввода, а не перенос.
            */}
            <DateField
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
          {/*
            ПОЛЯ «БУФЕР, ДН.» БОЛЬШЕ НЕТ (правки 07.09, п. 2). В расчёте сроков
            оно не участвовало никогда — ни `stagePlan.defaultPlannedEnd`,
            ни просрочка его не читают, — и на боевой базе стояло нулём
            у 46 заказов из 47. Колонка `erp_orders.buffer_days` остаётся:
            её несут заведённые заказы, и история правок её подписывает.
          */}
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
            allItems={items}
            onCopyPrint={copyPrint}
          />
        ))}
        <div className={styles.checkRow}>
          <Button variant="secondary" onClick={() => setItems((arr) => [...arr, { ...EMPTY_ITEM }])}>
            + Добавить позицию
          </Button>
          {/*
            КОПИРОВАНИЕ ПОЗИЦИИ (правка 22.08, п. 5.7): «если несколько позиций
            одинаковые или почти одинаковые, можно предусмотреть Копировать
            данные из позиции». Заказ из четырёх подрядных изделий иначе
            заполняется четырежды вручную.

            Маршрут в копию НЕ переносится: он пересчитается по новым данным,
            а перенесённая правка означала бы, что человек утвердил маршрут,
            которого не видел.
          */}
          {items.length > 0 && (
            <Button variant="ghost" onClick={() => copyItem(items.length - 1)}>
              Копировать последнюю позицию
            </Button>
          )}
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
          err={err}
          notRequired={form.purchase_required === false}
          onToggleNotRequired={(v) => setForm({ ...form, purchase_required: !v })}
        />
        </FormSection>

        <FormSection
          id="order-section-notes"
          title="Заметки к заказу"
          summary={notes.length > 0 ? `${notes.length}` : 'нет'}
          open={open.notes}
          onToggle={() => toggleSection('notes')}
        >
          <NotesSection notes={notes} setNotes={setNotes} attach={attach} />
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
            {/*
              РАЗМЕР ВЫБРАННОЙ УПАКОВКИ (правки 07.09, п. 16): «нужны поля
              ширина и высота в мм для БОПП-пакета, ZIP-пакета и варианта
              „Другое“». У «Нет» размера не бывает — поля и не показываются.
            */}
            {form.packaging !== 'none' && (
              <div className={styles.checkRow}>
                <label className={`${styles.checkLabel} ${styles.mmLabel}`}>
                  <span className={styles.subText}>Ш, мм</span>
                  <input
                    type="number"
                    min="1"
                    className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                    aria-label="Ширина упаковки, мм"
                    value={form.packaging_width_mm}
                    onChange={(e) => setForm({
                      ...form, packaging_width_mm: e.target.value.replace('-', ''),
                    })}
                  />
                </label>
                <label className={`${styles.checkLabel} ${styles.mmLabel}`}>
                  <span className={styles.subText}>В, мм</span>
                  <input
                    type="number"
                    min="1"
                    className={`${styles.input} ${styles.inputSm} ${styles.mmInput}`}
                    aria-label="Высота упаковки, мм"
                    value={form.packaging_height_mm}
                    onChange={(e) => setForm({
                      ...form, packaging_height_mm: e.target.value.replace('-', ''),
                    })}
                  />
                </label>
              </div>
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
