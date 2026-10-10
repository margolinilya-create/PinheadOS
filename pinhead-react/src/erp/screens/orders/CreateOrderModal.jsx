import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { DictionaryDatalist } from '../../components/DictionaryDatalist';
import {deptShortName} from '../../data/departments';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { formatDateShort } from '../../utils/time';
import { confirm } from '../../../store/useConfirmStore';
import { pluralize } from '../../../utils/i18n';
import {
  newDraftItem,
  clearOrderDraft,
  effectiveQty,
  emptyPrint,
  emptyOrderForm,
  draftFromOrder,
  isItemEmpty,
  orderNeedsPurchase,
  validateOrderForm,
} from '../../utils/orderForm';
import { managerOptions } from '../../utils/managers';
import { factoryToday } from '../../../utils/date';
import { formItemRoute } from '../../utils/routeDraft';
import { DateField } from '../../components/DateField';
import { DraftPicker } from './create/DraftPicker';
import { Icon } from '../../components/Icon';
import { deptNeedsTz, validateTzDocs } from '../../utils/tz';
import {
  PACKAGING_LABELS,
  STICKERS_LABELS,
} from '../../types';
import styles from '../../styles';

// Секции и примитивы формы вынесены в ./create/ — модалка осталась композицией
import { FormSection, FieldError } from './create/FormParts';
import { TzSection } from './create/TzSection';
import { useTzDocs } from './create/useTzDocs';
import { PurchaseListSection } from './create/PurchaseListSection';
import { EditOtherFilesSection, EditPurchaseList, EditTzFiles } from './create/EditOrderFiles';
import { useEditOrderFiles } from './create/useEditOrderFiles';
import { NotesSection } from './create/NotesSection';
import { useAttachmentUploads } from '../../hooks/useAttachmentUploads';
import { ItemBlock } from './create/ItemBlock';
import { Button } from '../../components/Button';
import { pickRestoredDraft, useOrderDraft } from './create/useOrderDraft';
import { useOrderSubmit } from './create/useOrderSubmit';

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


/*
  Черновики формы (выбор, автосохранение, «Сохранить в черновики») —
  `create/useOrderDraft`, сборка и отправка заказа — `create/useOrderSubmit`
  и чистые сборщики payload `create/orderPayload` (резка 26.09).
*/
/**
 * ОДНА ФОРМА НА СОЗДАНИЕ И ПРАВКУ (правка 12.09, п. 7).
 *
 * «В карточке уже созданного заказа добавить действие „Редактировать".
 * По нажатию должна открываться форма заказа с уже заполненными текущими
 * значениями. Разрешить редактировать те же пользовательские поля заказа
 * и позиций, которые заполняются при создании».
 *
 * Вторая форма рядом разошлась бы с первой в первую же правку — тот же довод,
 * по которому конструктор маршрута (`RouteFields`) общий для карточки заказа
 * и формы создания. Расходятся ровно три вещи: откуда берётся начальное
 * состояние, что делает сабмит и как называются заголовок с кнопкой.
 *
 * `order` — ПОЛНЫЙ заказ (после `loadOne`), а не списочный: `size_grid`
 * намеренно выброшена из `ORDER_LIST_SELECT`, и на списочном форма открылась
 * бы с пустой размерной сеткой, а первое же сохранение её стёрло.
 */
export function CreateOrderModal({ onClose, draftId = null, order = null }) {
  const isEdit = Boolean(order);
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
    drafts, employees, profilesList, employeesLoaded, loadEmployees,
  } = useErpStore(useShallow((s) => ({
    drafts: s.orderDrafts,
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
  // Открытый черновик — один раз, при монтировании (см. `pickRestoredDraft`)
  const [restoredDraft] = useState(() => pickRestoredDraft(isEdit, draftId, drafts));
  /**
   * Начальное состояние: в правке — из заказа, иначе — черновик или пустая
   * форма. Обратное преобразование живёт в `utils/orderForm.draftFromOrder`
   * и покрыто инвариантом «открыл и не тронул — тот же заказ»: иначе одно
   * открытие карточки молча меняло бы данные.
   */
  const [initial] = useState(() => (isEdit ? draftFromOrder(order) : null));
  const [form, setForm] = useState(
    () => initial?.form ?? restoredDraft?.form ?? emptyOrderForm(initialLaunch),
  );
  const [items, setItems] = useState(
    () => initial?.items ?? restoredDraft?.items ?? [newDraftItem()],
  );
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
  /**
   * ФАЙЛЫ ТЕПЕРЬ ЖИВУТ В ЧЕРНОВИКЕ (правка 20.09, п. 6): документ требует
   * сохранять «все введённые данные… и загруженные файлы».
   *
   * Это возможно потому, что файл уходит в бакет ПРИ ВЫБОРЕ, а не в сабмите
   * (правило проекта): в черновике лежит не `File`, а путь уже загруженного
   * объекта. Восстановленная строка сразу готова к отправке — повторять
   * загрузку не нужно.
   */
  const attach = useAttachmentUploads('new', restoredDraft?.attachments ?? []);

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
      findOrdersByBitrixId(form.bitrix_id, order?.id)
        .then((rows) => { if (alive) setDupes(rows); });
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [form.bitrix_id, findOrdersByBitrixId, order?.id]);

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
   * ТЗ в PDF — своя подсистема формы (`useTzDocs`, вынос 27.09): выбор,
   * загрузка при выборе, повтор, снимок для черновика. Из черновика приходят
   * только загруженные документы — без `File`, с именем/типом/размером.
   */
  const tz = useTzDocs(restoredDraft?.tzDocs);
  const { tzDocs, addTzDoc, retryTzDoc, removeTzDoc } = tz;
  const tzUploading = tz.uploading;
  const tzFailed = tz.failed;

  // Файлы правимого заказа (п. 6 правки 01.10) — `create/useEditOrderFiles`
  const {
    liveOrder, savedTzDocs, savedPurchaseFiles, filesPending, trackFileOp, reloadIfTouched,
  } = useEditOrderFiles(order, isEdit);

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
    tz.dropItem(i);
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
    setItems((arr) => [...arr, { ...src, key: crypto.randomUUID(), route: undefined, prints, labels }]);
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
    main: true, items: true, extra: true, tz: true, notes: false, files: true,
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


  /**
   * Гейт ТЗ — ТОЛЬКО ПРИ СОЗДАНИИ (правка 12.09, п. 7).
   *
   * Он отвечает на вопрос «можно ли ЗАВЕСТИ заказ без техзадания»: заказ
   * с производственным маршрутом без ТЗ встанет в первом же цехе. К правке
   * существующего заказа вопрос не относится — документы у него свои,
   * правятся сразу (карточка `TzDocsSection` и с 01.10 — `create/EditOrderFiles`
   * в этой же форме), и секция `tz` в payload правки не едет вовсе. Оставь гейт здесь — и заказ, заведённый до появления
   * требования, стало бы нельзя отредактировать вообще: кнопка заблокирована
   * из-за файла, которого эта форма даже не показывает.
   */
  const tzValidation = useMemo(
    () => (isEdit
      ? { missing: [], message: '' }
      : validateTzDocs(
        tzItems,
        tzDocs.map((d) => ({ itemIndex: d.itemIndex, uploaded: d.state === 'uploaded' })),
      )),
    [isEdit, tzItems, tzDocs],
  );


  // Инлайн-валидация: после первой попытки сабмита ошибки живут вместе с вводом
  const [submitted, setSubmitted] = useState(false);
  /**
   * Приложен ли файл листа закупки. Считаем по СОСТОЯНИЮ загрузки, а не по
   * «есть ли выбранный файл»: файл, который ещё грузится или упал, приложенным
   * не является — иначе форма отпустила бы заказ с листом, которого нет
   * в Storage (правило «файл уходит в бакет при выборе»).
   *
   * В правке к этому добавляется УЖЕ ПРИЛОЖЕННЫЙ лист (баг 03): состояние
   * `attach` принадлежит форме и стартует пустым, поэтому без второго
   * слагаемого гейт требовал приложить заново файл, который у заказа есть.
   */
  const hasPurchaseList = attach.files.some(
    (f) => f.kind === 'purchase_list' && f.state === 'uploaded',
  ) || savedPurchaseFiles.length > 0;
  const validation = useMemo(
    () => validateOrderForm(form, items, undefined, hasPurchaseList),
    [form, items, hasPurchaseList],
  );
  const fieldErrors = submitted ? validation.errors : {};
  const err = (key) => fieldErrors[key];
  const inputCls = (key) => (err(key) ? `${styles.input} ${styles.inputError}` : styles.input);

  const draft = useOrderDraft({
    isEdit, draftId, initialLaunch, saving,
    form, items, notes, setForm, setItems, setNotes,
    attach, tz, onReset: () => setSubmitted(false),
  });

  /**
   * ЗАКРЫТИЕ БЕЗ ВОПРОСОВ (правка заказчика 21.09, п. 6).
   *
   * Документ: «при нажатии „Отмена", закрытии формы или выходе из создания
   * заказа не показывать дополнительное окно „Сохранить черновик?"…
   * Это убирает дублирование: отдельная кнопка сохранения уже есть внизу
   * формы, а выбор сохранённых черновиков вынесен в отдельное меню».
   *
   * ЭТО ОТМЕНЯЕТ ПРЕЖНЕЕ РЕШЕНИЕ (20.09): «закрытие формы с несохранёнными
   * изменениями — ТРИ исхода, а не два». Оно было верным, пока форма писала
   * черновик сама: тогда «выйти без сохранения» требовало ещё и удалить
   * заведённую фоном строку, и умолчать об этом было нельзя. Теперь фон
   * ничего не заводит (см. автосохранение в `create/useOrderDraft`), терять нечего, и окно
   * спрашивало бы о том, чего не происходит.
   */
  const closingRef = useRef(false);
  const requestClose = async () => {
    if (saving || closingRef.current) return;
    clearOrderDraft();
    reloadIfTouched(); // файлы правились в форме — карточка перечитает заказ
    onClose();
  };

  /**
   * Focus-trap БЕЗ закрытия по Escape (правка заказчика 01.10, п. 3): «форма
   * нового заказа закрывается от случайного клика… Закрыть — через „Отмена",
   * сохранить — „Сохранить в черновики"». Escape закрывал форму молча — тот же
   * случайный выход, что и промах мышью мимо панели, и набранное терялось без
   * вопроса (окна «Сохранить черновик?» больше нет — правка 21.09, п. 6).
   * Трап нужен по-прежнему: без него Tab уходит под оверлей. Стоит до эффекта
   * autofocus, чтобы фокус остался на первом поле.
   */
  const trapRef = useFocusTrap(true);
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

  const submit = useOrderSubmit({
    isEdit, order, form, items, notes, attach, hasPurchaseList,
    tzDocs, tzValidation, tzUploading, tzFailed, filesPending,
    setSaving, setSubmitted, setOpen, onClose,
    onCreated: draft.discardAfterCreate,
  });


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
  /**
   * Нужна ли закупка вообще (правки 07.09, п. 4): отметка менеджера ЛИБО
   * состав заказа. Величина одна на три места — подпись свёрнутой секции,
   * объяснение внутри неё и проверка в `validateOrderForm`, — и считает её
   * одна функция: вторая формула разошлась бы с проверкой, и человек получил
   * бы «лист не приложен» у заказа, где он не нужен.
   */
  const purchaseNeeded = orderNeedsPurchase(form, items);
  const purchaseSummary = form.purchase_required === false
    ? 'закупка не требуется'
    : hasPurchaseList
      ? 'лист приложен'
      : purchaseNeeded
        ? 'лист не приложен'
        : 'покупать нечего';
  const tzUploaded = tzDocs.filter((d) => d.state === 'uploaded').length;
  /**
   * В правке подпись считается по ПРИЛОЖЕННОМУ К ЗАКАЗУ, а не по состоянию
   * загрузки формы: последнее там пусто всегда, и свёрнутая секция сообщала бы
   * «0 файлов · загружено» у заказа, где ТЗ есть.
   */
  const tzSummary = isEdit
    ? `${savedTzDocs.length} ${pluralize(savedTzDocs.length, 'файл', 'файла', 'файлов')}`
    : tzUploading
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
    /* Клик мимо панели форму НЕ закрывает (п. 3 правки 01.10) — только «Отмена» */
    <div className={styles.modalOverlay} role="presentation">
      <form
        ref={trapRef}
        className={styles.modal}
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Правка заказа ${order.title}` : 'Новый производственный заказ'}
      >
        <div className={styles.modalTitle}>
          {isEdit ? `Правка заказа${order.bitrix_id ? ` №${order.bitrix_id}` : ''}` : 'Новый заказ'}
        </div>

        {/*
          ВЫБОР ЧЕРНОВИКА ПРЯМО В ФОРМЕ (правка заказчика 21.09, п. 6):
          «добавить отдельное раскрывающееся действие „Черновики" / „Выбрать
          черновик". Оно должно быть доступно прямо в интерфейсе нового заказа
          и не зависеть от того, был ли автоматически восстановлен последний
          черновик».

          В режиме правки списка нет: `erp_order_drafts` — про НЕсозданный
          заказ, и подставлять черновик в правку существующего значило бы
          затереть живой заказ чужими данными.
        */}
        {!isEdit && (
          <DraftPicker
            drafts={drafts}
            openId={draft.rowId}
            dirty={draft.dirty}
            onPick={draft.applyDraft}
            onFresh={draft.startFreshDraft}
            onDelete={draft.removeDraft}
          />
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
            key={it.key ?? i}
            it={it}
            i={i}
            itemsCount={items.length}
            err={err}
            inputCls={inputCls}
            route={itemRoutes[i]}
            // В правке пикеров нет — сироты в бакете (п. 6, 01.10; см. ItemFilePicker)
            attach={isEdit ? null : attach} isEdit={isEdit}
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
          <Button variant="secondary" onClick={() => setItems((arr) => [...arr, newDraftItem()])}>
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
        {isEdit ? (
          <EditTzFiles order={liveOrder} track={trackFileOp} />
        ) : (
          <TzSection
            tzItems={tzItems}
            tzDocs={tzDocs}
            addTzDoc={addTzDoc}
            removeTzDoc={removeTzDoc}
            retryTzDoc={retryTzDoc}
          />
        )}
        </FormSection>

        <FormSection
          id="order-section-purchase"
          title="Лист закупки"
          summary={purchaseSummary}
          open={open.purchase}
          onToggle={() => toggleSection('purchase')}
        >
        {isEdit ? (
          <EditPurchaseList
            order={liveOrder}
            notRequired={form.purchase_required === false}
            onToggleNotRequired={(v) => setForm({ ...form, purchase_required: !v })}
            error={err('purchase_list')}
            track={trackFileOp}
          />
        ) : (
          <PurchaseListSection
            attach={attach}
            err={err}
            notRequired={form.purchase_required === false}
            notNeededByItems={form.purchase_required !== false && !purchaseNeeded}
            onToggleNotRequired={(v) => setForm({ ...form, purchase_required: !v })}
          />
        )}
        </FormSection>

        {/*
          ЗАМЕТКИ — ТОЛЬКО ПРИ СОЗДАНИИ. Правка заказа их не сохраняет
          (`erp_update_order` секции заметок не знает), а секция в правке
          стартовала пустой: набранное терялось молча, а изображение уходило
          в бакет сиротой. Изображения уже заведённых заметок правятся
          в «Файлах заказа» (п. 6 правки 01.10).
        */}
        {!isEdit && (
          <FormSection
            id="order-section-notes"
            title="Заметки к заказу"
            summary={notes.length > 0 ? `${notes.length}` : 'нет'}
            open={open.notes}
            onToggle={() => toggleSection('notes')}
          >
            <NotesSection notes={notes} setNotes={setNotes} attach={attach} />
          </FormSection>
        )}

        {isEdit && (
          <EditOtherFilesSection
            order={liveOrder}
            open={open.files}
            onToggle={() => toggleSection('files')}
            track={trackFileOp}
          />
        )}

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
          {/*
            «СОХРАНИТЬ В ЧЕРНОВИКИ» РЯДОМ С СОЗДАНИЕМ (правка 20.09, п. 6):
            «в форме „Новый заказ" добавить кнопку „Сохранить в черновики"
            рядом с основным действием создания заказа».

            Гейта обязательных полей у неё НЕТ намеренно — черновик и заводят
            затем, чтобы дозаполнить позже. А вот незавершённую загрузку файла
            она ждёт: в черновик уходит путь объекта в бакете, и сохранять
            ссылку на то, чего там ещё нет, нельзя.

            В режиме правки её не показываем: `erp_order_drafts` — про
            НЕсозданный заказ, и запись туда правки существующего затёрла бы
            чужой черновик (то же решение, что у автосохранения).
          */}
          {!isEdit && (
            <Button
              variant="secondary"
              onClick={draft.saveDraftNow}
              disabled={saving || draft.savingDraft || tzUploading || attach.uploading}
            >
              {draft.savingDraft ? 'Сохранение…' : 'Сохранить в черновики'}
            </Button>
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={saving || tzUploading || tzFailed || attach.uploading || attach.failed
          || filesPending > 0
          || tzValidation.missing.length > 0
          || (submitted && (validation.missing.length > 0 || validation.invalid.length > 0))}>
            {isEdit
              ? (saving ? 'Сохранение…' : 'Сохранить изменения')
              : (saving ? 'Создание…' : 'Создать заказ')}
          </Button>
        </div>
      </form>
    </div>
  );
}
