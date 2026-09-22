/**
 * DTO/интерфейсы ERP-стора (вынесены из useErpStore.ts, рефакторинг по плану аудита).
 * Отдельный модуль — чтобы слайсы/хелперы могли ссылаться на ErpOrderFull и др.
 * без циклического импорта через useErpStore.ts. Реэкспорт — в useErpStore.ts.
 */

import type { ReportWithSizes } from '../utils/stageSizes';
import type { PermissionMatrix } from '../utils/permissions';
import type { CapacitySettings } from '../utils/capacity';
import type { RouteGroup } from '../utils/routeDraft';
import type {
  BrandingMethod,
  BrandingOn,
  DictionaryKind,
  EmployeeRole,
  ErpDepartment,
  ErpBypass,
  BypassKind,
  ErpDictionaryItem,
  ErpEmployee,
  ErpInvite,
  ErpNotification,
  ErpSkuCard,
  ErpSkuCardFile,
  ErpSkuCardVersion,
  ErpChatMessage,
  ErpChatPerson,
  ChatContext,
  ChatUnread,
  ChatReadReceipt,
  ChatReactionPerson,
  ChatSearchHit,
  ErpPermission,
  ErpRolePermission,
  ErpItemPrint,
  ErpItemStage,
  ErpMaterial,
  ErpMaterialReceipt,
  ErpMaterialSupplier,
  StageReportSizeInput,
  ErpAttachmentKind,
  ErpOrder,
  ErpOrderAttachment,
  ErpOrderDraft,
  ErpOrderItem,
  ErpOrderNote,
  DevOutcome,
  DevTaskStatus,
  ErpExperimental,
  ErpExperimentalTask,
  ErpProcurementTask,
  ErpStageEvent,
  ErpSubcontractOp,
  SubcontractMaterialSource,
  SubcontractMoveKind,
  ErpCalendarSlot,
  ErpPlanComment,
  ErpTzDocument,
  ErpWarehouseOp,
  ErpWarehouseTask,
  ItemPackagingType,
  MaterialAcceptStatus,
  ProcurementCauseType,
  ProductionType,
  SizeGridRow,
  StageStatus,
  WarehouseOpType,
  WarehouseTaskStatus,
} from '../types';

/** Профиль из общей таблицы profiles (единый источник сотрудников с Order Studio) */
export interface StaffProfile {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
  approved: boolean;
  active: boolean | null;
}

/**
 * Новая учётная запись, заводимая администратором вручную.
 *
 * Роль, цеховая роль и цех те же, что у приглашения, и не случайно: сервер
 * проставляет их ТЕМ ЖЕ путём — заводит одноразовое приглашение и отдаёт его
 * код триггеру регистрации. Вторая реализация «кому какие права» разъехалась
 * бы с первой в первую же правку.
 */
export interface NewUserDraft {
  name: string;
  email: string;
  password: string;
  profile_role: string;
  employee_role: string;
  department_id: string | null;
}

export interface ErpOrderAuditRow {
  id: string;
  order_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface ErpOrderComment {
  id: string;
  order_id: string;
  author: string;
  text: string;
  created_at: string;
}

/**
 * Вложение заказа — зеркало таблицы, поэтому объявление живёт в `erp/types.ts`
 * рядом с остальной схемой: разработка ссылается на него тоже, и держать тип
 * здесь значило бы завести цикл импортов ради одного поля.
 */
export type { ErpAttachmentKind, ErpOrderAttachment } from '../types';

/** Заказ со вложенными позициями/этапами/материалами (join при загрузке) */
export interface ErpOrderFull extends ErpOrder {
  items: (ErpOrderItem & { stages: ErpItemStage[]; prints?: ErpItemPrint[] })[];
  materials: ErpMaterial[];
  attachments?: ErpOrderAttachment[];
  procurement_tasks?: ErpProcurementTask[];
  warehouse_ops?: ErpWarehouseOp[];
  warehouse_tasks?: ErpWarehouseTask[];
  /** ТЗ в PDF: все версии всех групп заказа. Документ принадлежит позиции */
  tz_documents?: ErpTzDocument[];
  /**
   * Заметки к заказу (правка 22.08, п. 5.8). Алиас `notes_list`, а не `notes`:
   * колонка `erp_orders.notes` уже занята свободным комментарием заказа,
   * и одно имя на два разных смысла — верный способ однажды затереть одно
   * другим.
   */
  notes_list?: ErpOrderNote[];
  /**
   * Разработки образцов заказа (правки 02.09, п. 2).
   *
   * Нужны ГЕЙТУ ОТГРУЗКИ, а не экрану: у образца в маршруте остаётся одна
   * закупка, и без этого поля `isOrderReadyToShip` объявил бы заказ готовым
   * сразу после её закрытия — то есть в начале разработки. Приезжают эмбедом
   * в обеих выборках заказа; поле, не попавшее в выборку, стало бы `undefined`
   * молча, и гейт открылся бы там, ради чего он и заведён (сторожит
   * `orderSelect.test.ts`).
   */
  developments?: OrderDevelopment[];
}

/**
 * Разработка образца глазами заказа: ровно то, что нужно гейту отгрузки.
 * Полный тип — `ErpExperimental` в `erp/types.ts`; тащить его целиком
 * в списочную выборку значило бы возить полтора десятка колонок финального
 * пакета по каждому заказу.
 */
export interface OrderDevelopment {
  id: string;
  item_id: string | null;
  outcome: string | null;
  handed_to_warehouse_at: string | null;
  /**
   * Комментарий по проработке (правка 13.09, п. 10): его показывает цеху
   * задание этапа нанесения. Едет тем же эмбедом, а не отдельным запросом,
   * — иначе у строки очереди появился бы свой поход в базу на каждое
   * задание. Опциональный: у заказов из старых фикстур и кэша его нет.
   */
  branding_note?: string | null;
}

/**
 * Параметры возврата брака: пользователь выбирает этап устранения.
 * target: 'current' — переделка на месте; <stageId> — перенос на конкретный этап;
 * 'procurement' — материал испорчен, нужна закупка. needsMaterial — задача закупки.
 */
export interface ReportDefectOptions {
  qty: number;
  reason: string;
  target?: 'current' | 'procurement' | 'subcontractor' | (string & {});
  needsMaterial?: boolean;
  cause?: ProcurementCauseType;
  supplier?: string | null;
  plannedDate?: string | null;
  materialName?: string | null;
  requiredQty?: string | null;
  /** target='subcontractor': операция и контрагент для создаваемой операции подряда */
  subcontractOperation?: string | null;
  contractor?: string | null;
  /**
   * План завершения ПЕРЕДЕЛКИ у этапа-получателя (`plannedDate` — это другое:
   * срок замены материала в задаче закупщику). Возврат брака переводит этап
   * в работу, и без даты он выпадает из контроля сроков целиком.
   */
  reworkPlannedEnd?: string | null;
}

export interface NewPrintInput {
  /**
   * Ключ строки формы (правка 22.08, п. 5.2). По нему макет находит своё
   * нанесение: строки `erp_item_prints` в момент выбора файла ещё нет.
   * В payload сервера ключ не едет — только номер внутри позиции.
   */
  key?: string;
  method: BrandingMethod;
  fabric?: string;
  zone?: string;
  width_mm?: number | null;
  height_mm?: number | null;
  offset_note?: string;
  pantone?: string;
  /** Спецэффект шелкографии (правки 07.09, п. 10) — колонка `special` */
  special?: string;
  /** Тип изделия для вышивки (правки 07.09, п. 11) */
  garment_kind?: string;
  comment?: string;
}

export interface NewLabelInput {
  /** Ключ строки формы — по нему файл бирки находит свою строку */
  key?: string;
  label_type?: string;
  place?: string;
  size?: string;
  comment?: string;
}

export interface NewOrderItemInput {
  product_type: string;
  variant?: string;
  qty: number;
  production_type: ProductionType;
  branding_methods: BrandingMethod[];
  branding_on: BrandingOn;
  notes?: string;
  size_grid?: SizeGridRow[] | null;
  prints?: NewPrintInput[];
  /** Бирки позиции (правка 22.08, п. 5.3) — повторяемый блок, как нанесения */
  labels?: NewLabelInput[];
  /** Подряд (волна 4.2): тип и источник материалов — для production_type='outsource' */
  subcontract_kind?: 'finished_product' | 'operation';
  material_source?: SubcontractMaterialSource;
  /** Что за операция делает подрядчик (правка 4.2.3) — для «отдельной операции» */
  subcontract_operation?: string;
  /** Следующий участок после отдельной операции (код цеха); null = доработка не нужна */
  return_dept?: string | null;
  /**
   * Технический блок и упаковка позиции (правки заказчика 16.08).
   * Пустые поля не отправляются вовсе: колонка со значением `''` сделала бы
   * «не заполняли» неотличимым от «заполнили пустым».
   */
  fit?: string;
  /** Основное полотно — отдельно от отделочного (правка 22.08, п. 5.1) */
  main_fabric?: string;
  color_supplier?: string;
  trim_material?: string;
  cutting_note?: string;
  sewing_note?: string;
  labels_note?: string;
  /** `inherit` — упаковка берётся из заказа (см. utils/packaging) */
  packaging?: ItemPackagingType;
  /** Размер пакета, расположение стикера и маркировки — п. 1 документа 16.08 */
  packaging_size?: string;
  sticker_place?: string;
  marking_place?: string;
  packaging_note?: string;
  /** Размер упаковки позиции в мм (правки 07.09, п. 16) */
  packaging_width_mm?: number | null;
  packaging_height_mm?: number | null;
  /**
   * Маршрут, ПРАВЛЕННЫЙ человеком в конструкторе (правки заказчика 16.08).
   * `undefined` — не трогали: стор посчитает маршрут сам тем же
   * `formItemRoute`, и правило «правка или расчёт» остаётся в одном месте.
   */
  route?: RouteGroup[];
}

/**
 * Черновики формы создания заказа (правка 22.08, п. 5.5).
 *
 * Их несколько и они В БАЗЕ: прежний единственный ключ localStorage
 * не давал вести два заказа параллельно и не переживал смену устройства.
 */
export interface OrderDraftsSlice {
  orderDrafts: ErpOrderDraft[];
  orderDraftsLoaded: boolean;
  orderDraftsError: string | null;
  loadOrderDrafts: () => Promise<void>;
  /** `id === null` — создать новый; возвращает строку или null при отказе */
  saveOrderDraft: (
    id: string | null, title: string | null, payload: unknown,
  ) => Promise<ErpOrderDraft | null>;
  deleteOrderDraft: (id: string) => Promise<boolean>;
}

/**
 * Строка листа закупки в payload создания заказа.
 *
 * Здесь только ПОТРЕБНОСТЬ: поставщик, цена, план и факт прихода — часть
 * закупщика, и заполняет он их у себя. Документ требует разделения прямо:
 * «один показатель не должен заменять другой».
 */
export interface NewOrderMaterialInput {
  /** Индекс позиции в `items`; null — материал на весь заказ */
  item_index: number | null;
  kind: string;
  role?: string;
  name: string;
  color?: string;
  /** Плановая потребность заказа */
  qty_expected: number | null;
  unit?: string;
  manager_note?: string;
  source?: string;
  status?: string;
}

/** Документ ТЗ в payload создания заказа: файл уже лежит в бакете */
export interface NewOrderTzDocument {
  group_id: string;
  /** Индекс позиции в `items`; null — общее ТЗ заказа */
  item_index: number | null;
  file_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  uploaded_by?: string;
}

/**
 * @deprecated Поцеховое назначение ТЗ отменено 2026-08-03: документ принадлежит
 * позиции и виден всему её маршруту. Тип оставлен, потому что RPC `erp_create_order`
 * по-прежнему принимает секцию `tz.assignments`; клиент шлёт пустой массив.
 */
export interface NewOrderTzAssignment {
  item_index: number;
  department_id: string;
  group_id: string;
  assigned_by?: string;
}

export interface NewOrderInput {
  bitrix_id?: string;
  title: string;
  /** Клиент — показывается цеху в задании и участвует в фильтрах (правки 5/9) */
  customer?: string;
  manager?: string;
  launch_date?: string;
  due_date?: string;
  buffer_days?: number;
  notes?: string;
  packaging?: string;
  packaging_note?: string;
  /** Размер упаковки заказа в мм (правки 07.09, п. 16) */
  packaging_width_mm?: number | null;
  packaging_height_mm?: number | null;
  stickers?: string;
  stickers_note?: string;
  no_chestny_znak?: boolean;
  /** Требовать ли ТЗ (волна 4). Новые заказы из формы — всегда true */
  tz_required?: boolean;
  items: NewOrderItemInput[];
  /**
   * Лист закупки (правки заказчика 16.08): потребность, сформированная
   * МЕНЕДЖЕРОМ при создании заказа. Уезжает той же транзакцией — закупщик
   * получает готовые строки, а не заводит их заново.
   */
  materials?: NewOrderMaterialInput[];
  /**
   * Заметки к заказу (правка 22.08, п. 5.8) — то, что нельзя разложить
   * по структурным полям. Изображения приезжают вложениями с `note_index`.
   *
   * Имя `notes_list`, а не `notes`: `notes` у заказа уже занято свободным
   * комментарием, и одно имя на два разных смысла однажды затрёт одно
   * другим. В payload RPC секция называется `notes` — там она одна.
   */
  notes_list?: { seq: number; text: string | null }[];
  /**
   * ТЗ в PDF: файлы уже загружены в бакет, RPC вставляет их одной транзакцией
   * с заказом — «создать заказ без ТЗ» невозможно даже при сбое.
   * `assignments` больше не заполняется (см. NewOrderTzAssignment).
   */
  tz?: { documents: NewOrderTzDocument[]; assignments?: NewOrderTzAssignment[] };
  /**
   * Вложения блоков заказа: упаковка, техблок, лист закупки (правки 16.08).
   * Файлы уже лежат в бакете — их грузит форма при ВЫБОРЕ, а RPC только
   * привязывает строки той же транзакцией, что и заказ.
   */
  attachments?: NewOrderAttachment[];
}

/** Вложение в payload создания заказа: файл уже в бакете */
export interface NewOrderAttachment {
  /** Индекс позиции в `items`; null — файл заказа целиком */
  item_index: number | null;
  /** Индекс строки в `materials`; null — файл не относится к листу закупки */
  material_index: number | null;
  file_path: string;
  file_name: string;
  kind: ErpAttachmentKind;
  uploaded_by?: string;
}

/** Нормализованное realtime-событие postgres_changes (для точечного применения) */
export interface ErpRealtimeEvent {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  new: Record<string, unknown> | null;
  old: Record<string, unknown> | null;
}

/**
 * Контракт стора разбит на доменные под-интерфейсы (по одному на слайс,
 * рефакторинг по плану аудита). ErpStore = их пересечение. Слайсы (store/slices/*)
 * импортируют ErpStore и свой под-интерфейс отсюда — односторонний импорт,
 * без рантайм-цикла (файл типов стирается при компиляции).
 */

/** Заказы: загрузка (активные/архив/один), CRUD, отгрузка, вложения, история, комментарии */
/**
 * Бутстрап оболочки: цеха, права, справочники, подряд, эксперим. цех и цех
 * вызывающего одним RPC вместо шести запросов при монтировании ErpLayout.
 */
export interface BootstrapSlice {
  bootstrapLoaded: boolean;
  loadBootstrap: () => Promise<void>;
}

/** Пакет спутников заказа: история этапов, лог правок, комментарии — одним RPC */
export interface ErpOrderBundle {
  events: ErpStageEvent[];
  audit: ErpOrderAuditRow[];
  comments: ErpOrderComment[];
}

/** Заказ в одну строку — для проверки дублей по № сделки */
export interface ErpOrderBrief {
  id: string;
  title: string;
  status: string;
  created_at: string;
}

export interface OrdersSlice {
  departments: ErpDepartment[];
  orders: ErpOrderFull[];
  loading: boolean;
  loaded: boolean;
  /** Ошибка загрузки loadAll — для inline-блока «Не удалось загрузить · Повторить» */
  loadError: boolean;
  /** Архив (status != active) грузится лениво — при первом заходе на вкладку */
  archiveLoaded: boolean;
  archiveLoading: boolean;
  /** В архиве осталась ещё страница — показываем кнопку «Показать ещё» */
  archiveHasMore: boolean;
  /**
   * Сколько строк архива уже запрошено — смещение следующей страницы.
   *
   * Считать его из стора (`orders.filter(status !== 'active').length`) нельзя:
   * туда попадают архивные заказы, пришедшие мимо пагинации — по диплинку
   * (`loadOne`) или из realtime, когда активный заказ уехал в архив. Каждый такой
   * сдвигал смещение вперёд, и ровно столько строк следующая страница
   * ПЕРЕПРЫГИВАЛА: дедуп по id ловит дубли, но пропуск не виден вообще.
   */
  archiveOffset: number;
  /**
   * Заказы, загруженные ПОЛНЫМ select-ом (`loadOne`).
   *
   * Списочный запрос не тянет колонки, нужные только карточке (размерная сетка),
   * поэтому «заказ есть в сторе» больше не значит «данных достаточно». Карточка
   * дозагружает себя по этому признаку; без него она молча рисовала бы позицию
   * без размерной сетки.
   */
  detailIds: string[];
  /**
   * Отказ ТОЧЕЧНОЙ загрузки (`loadOne`/`findOrderIdByStage`), иначе null.
   *
   * Заведён аудитом 03.09: обе функции возвращали `null` и при «нет такой
   * строки», и при сбое сети, а экран трактовал `null` как «не найдено».
   * Человек по ссылке из чата читал «Заказ не найден» / «Задание не найдено
   * или было удалено» — то есть «запись удалили» вместо «связь оборвалась» —
   * и шёл выяснять к диспетчеру.
   */
  detailError: string | null;

  /** Основная загрузка: только активные заказы (архив — loadArchive) */
  loadAll: () => Promise<void>;
}

/**
 * ЗАГРУЗКИ ЗАКАЗОВ ПО ТРЕБОВАНИЮ — то, что зовут ЭКРАНЫ, а не оболочка.
 *
 * Отделено от `OrdersSlice` 14.09. Оболочке нужен активный список — из него
 * считаются бейджи разделов, счётчики цехов и колокол; всё остальное чтение
 * зовут только экраны, и потому оно приезжает доменным чанком вместе с первым
 * из них. Данные при этом остаются в ядре (`domainState`): их наполняет
 * `loadAll` ещё до открытия любого экрана.
 */
export interface OrdersOnDemandSlice {
  /** Ленивая загрузка архива (status != active) при первом заходе на вкладку — первая страница */
  loadArchive: () => Promise<void>;
  /** Следующая страница архива (кнопка «Показать ещё») */
  loadMoreArchive: () => Promise<void>;
  /**
   * Заказы с тем же № сделки — подсказка форме создания.
   *
   * На 03.08.2026 в базе пять групп дублей: один и тот же № сделки заведён
   * дважды-четырежды с интервалом 25–80 секунд. Двойной клик исключён (кнопка
   * блокируется на время запроса) — заказ создавал человек, не увидевший
   * результата первой попытки. Ничто ему об этом не говорило.
   *
   * `excludeOrderId` — заказ, который сам себе дублем не считается: в режиме
   * правки форма спрашивает о ТОМ ЖЕ номере, что у открытого заказа.
   */
  findOrdersByBitrixId: (
    bitrixId: string,
    excludeOrderId?: string,
  ) => Promise<ErpOrderBrief[]>;

  /**
   * История этапов + лог правок + комментарии одним RPC вместо трёх запросов.
   * `force` сбрасывает кэш — нужен после действия, изменившего ленту.
   */
  loadOrderBundle: (
    orderId: string,
    options?: { force?: boolean },
  ) => Promise<ErpOrderBundle | null>;

  /** Перезагрузка одного заказа тем же вложенным select (upsert в стор) */
  loadOne: (orderId: string) => Promise<ErpOrderFull | null>;
}

/** Этапы: смена статуса, частичная готовность, брак/переделка, план дат */
export interface StagesSlice {
  setStageStatus: (
    stageId: string,
    status: StageStatus,
    extra?: {
      qty_done?: number;
      block_reason?: string | null;
      /** Исполнитель, за которым закрепляется задание («Взять в работу», правка 8) */
      assignee?: string | null;
      comment?: string;
    },
  ) => Promise<boolean>;
  /**
   * Частичная готовность: qty_done += qty; при qty_done >= qty позиции
   * этап закрывается (done), иначе остаётся in_progress с прогрессом «300/500».
   */
  reportProgress: (
    stageId: string,
    qty: number,
    /** Подпись события журнала; по умолчанию «Частичная готовность» */
    opts?: { comment?: string },
  ) => Promise<boolean>;
  /** Брак: пользователь выбирает этап устранения; при необходимости — задача закупки */
  /**
   * ПРИНУДИТЕЛЬНОЕ ЗАВЕРШЕНИЕ ЭТАПА (правка 20.09, п. 5).
   *
   * Закрывает ОДИН заблокированный этап, не выполняя обычных условий:
   * заказы, заведённые до новых проверок, их не проходят и стоят.
   * Количество не пишется и последующие этапы не трогаются — «по умолчанию
   * весь тираж» правило раздела прямо запрещает.
   *
   * Причина обязательна: действие обходит все проверки сразу, и через месяц
   * «почему этап закрыт без результата» не восстановить ничем, кроме текста.
   */
  forceCompleteStage: (stageId: string, reason: string) => Promise<boolean>;
  /**
   * Отчёт цеха по схеме участка (правки 10.08, P2): журнал + приращение
   * счётчиков одной транзакцией. `qtyIn` — снимок входа, считает
   * `utils/stageInput` на клиенте (обход `depends_on` живёт там).
   */
  submitStageReport: (stageId: string, input: {
    qtyIn?: number | null;
    qtyGood?: number;
    qtyDefect?: number;
    qtyRework?: number;
    qtyExtra?: number;
    comment?: string | null;
    extra?: Record<string, unknown>;
    /**
     * Результат в разрезе размеров (правки 16.09, пп. 1, 4, 6) — строки
     * `erp_stage_report_sizes`. Когда разбивка есть, заголовочные числа
     * отчёта СЧИТАЕТ СЕРВЕР по ней же: иначе у `qty_good` два писателя
     * (форма и сумма строк), и разойдутся они молча.
     */
    sizes?: StageReportSizeInput[];
    /**
     * Расход ткани по рулонам (правка 16.09, п. 4). Когда он есть, сервер
     * считает `qty_good` по нему и сам ведёт статус рулона: «израсходован»
     * по галочке закройщика, «в работе» при первом расходе.
     */
    /**
     * Фактическая стоимость сборки за единицу (правка 16.09, п. 6). Пишется
     * В ПОЗИЦИЮ заказа, и единственный её писатель — этот RPC: документ просит
     * «один раз на всю позицию», а у этапа их бывает несколько (возврат брака
     * заводит второй швейный этап со своим циклом).
     */
    assemblyCost?: number | null;
    rolls?: {
      roll_id: string;
      material_id?: string | null;
      qty_used: number;
      finished?: boolean;
      sizes: StageReportSizeInput[];
    }[];
  }) => Promise<boolean>;
  /**
   * Отчёты этапов вместе с размерными строками (правка 16.09, п. 6):
   * из них считается «принято из закроя» по каждому размеру.
   *
   * ТОЧЕЧНО, а не в выборке заказа: журнал результатов растёт быстрее всего,
   * а нужен он ровно на одной форме — сдаче результата участка, который
   * отчитывается по размерам.
   */
  loadStageReports: (stageIds: string[]) => Promise<ReportWithSizes[]>;
  reportDefect: (stageId: string, opts: ReportDefectOptions) => Promise<boolean>;
  /** Последние события возврата брака по этапам (для баннера получателю) */
  loadStageReworkEvents: (stageIds: string[]) => Promise<Record<string, ErpStageEvent>>;
  /** Заказ, которому принадлежит этап — для диплинка на страницу задания (правка 5) */
  findOrderIdByStage: (stageId: string) => Promise<string | null>;
  /** Обработка просрочки этапа (правка 8): комментарий причины + отметка времени */
  ackStageOverdue: (stageId: string, comment: string) => Promise<boolean>;
  /** Ручные плановые даты этапа */
  setStagePlan: (
    stageId: string,
    plan: { planned_start?: string | null; planned_end?: string | null },
  ) => Promise<boolean>;
  /**
   * Приоритет задания в очереди своего цеха (правка 3): задание встаёт между
   * prevStageId и nextStageId (null — край очереди). Пишет одну строку —
   * позицию-середину; при исчерпании точности перенумеровывает очередь цеха.
   * Перемещение фиксируется в истории (кто, когда, куда).
   */
  reorderStageQueue: (
    stageId: string,
    prevStageId: string | null,
    nextStageId: string | null,
  ) => Promise<boolean>;
  /**
   * Перенос задания в другой цех (канбан): текущий этап закрывается, этап целевого
   * цеха открывается; если его нет в маршруте — добавляется. Последствия и запреты
   * считает analyzeStageMove, подтверждение показывает UI. Возврат назад и пропуск
   * этапов требуют комментария — он уходит в историю обоих этапов.
   */
  moveStageToDepartment: (
    stageId: string,
    targetDepartmentId: string,
    opts?: { comment?: string | null },
  ) => Promise<boolean>;
  /**
   * Сохранение маршрута позиции ОДНОЙ транзакцией (`erp_route_apply`).
   *
   * Что именно сохранять, решил клиент — `utils/routeDraft.linearize`; сюда
   * приезжает уже плоский список с `depends_on` ИНДЕКСАМИ массива (у нового
   * этапа идентификатора ещё нет). Сервер отвечает за атомарность: правка
   * маршрута трогает несколько строк, и `Promise.all` из отдельных запросов
   * означал бы откат интерфейса поверх уже закоммиченного.
   */
  applyItemRoute: (
    orderId: string,
    itemId: string,
    steps: RouteStepWrite[],
  ) => Promise<boolean>;
}

/** Шаг маршрута в payload `erp_route_apply` */
export interface RouteStepWrite {
  /** null — этапа ещё нет в базе */
  stage_id: string | null;
  department_id: string;
  sort_order: number;
  executor: 'internal' | 'contractor';
  contractor: string | null;
  operation: string | null;
  /** ИНДЕКСЫ предшественников в этом же массиве, не идентификаторы */
  depends_on: number[];
}

/** Материалы: добавление/правка, подтверждение склада, авто-закрытие закупки */
export interface MaterialsSlice {
  /**
   * Предварительные закупки — строки `erp_materials` без заказа (п. 17
   * документа 16.08). Держим их ОТДЕЛЬНЫМ списком, а не в `orders`: обычные
   * материалы приезжают join-ом к заказу, и строка без заказа не попала бы
   * туда никогда — её бы просто не existовало для интерфейса.
   */
  preliminary: ErpMaterial[];
  preliminaryLoaded: boolean;
  loadPreliminary: () => Promise<void>;
  addPreliminaryMaterial: (
    material: Partial<ErpMaterial> & Pick<ErpMaterial, 'kind' | 'name'>,
  ) => Promise<ErpMaterial | null>;
  /**
   * Привязка предварительной закупки к заказу — UPDATE существующей строки.
   * Не копия: документ прямо требует, чтобы система «не создавала вторую
   * дублирующую закупку».
   */
  attachPreliminaryToOrder: (materialId: string, orderId: string) => Promise<boolean>;
  addMaterial: (
    orderId: string,
    material: Partial<ErpMaterial> & Pick<ErpMaterial, 'kind' | 'name'>,
  ) => Promise<ErpMaterial | null>;
  updateMaterial: (id: string, patch: Partial<ErpMaterial>) => Promise<boolean>;
  /** Подтвердить наличие материала со склада → «Доступен со склада» (открывает закрой) */
  confirmStockMaterial: (id: string) => Promise<boolean>;

  /** Варианты поставщиков на позицию закупки (правка 10) */
  addSupplierOption: (
    materialId: string,
    option: Partial<ErpMaterialSupplier> & Pick<ErpMaterialSupplier, 'supplier'>,
  ) => Promise<ErpMaterialSupplier | null>;
  updateSupplierOption: (
    materialId: string,
    optionId: string,
    patch: Partial<ErpMaterialSupplier>,
  ) => Promise<boolean>;
  /** Выбрать итогового поставщика: снимает флаг с прежнего и пишет имя в материал */
  selectSupplierOption: (materialId: string, optionId: string) => Promise<boolean>;
  /** Удалить вариант; удаление выбранного очищает поставщика у позиции */
  deleteSupplierOption: (materialId: string, optionId: string) => Promise<boolean>;
  /** Все материалы заказа готовы → закрыть этап «Закупка» (received/reserved/not_needed) */
  maybeCloseSupply: (orderId: string) => Promise<void>;
  /**
   * Взять закупку по заказу в работу — все её открытые этапы разом.
   * Без этого у закупки нет состояния «этим уже занимаются».
   */
  /**
   * Взять закупку заказа в работу. `plannedEnd` — план завершения: этап
   * переходит в `in_progress`, и без даты он выпадает из контроля сроков
   * (просрочка этапа и «Загрузка цехов» считаются по `planned_end`).
   */
  takeSupply: (orderId: string, plannedEnd?: string | null) => Promise<boolean>;
  /**
   * Закрыть закупку по заказу ЯВНЫМ действием, с комментарием.
   *
   * До 12.08 единственным путём закрытия был побочный эффект
   * `maybeCloseSupply` внутри добавления/правки материала, и он требовал
   * непустого списка материалов. У заказа, которому закупка не нужна
   * (или нужна вне системы), этап не закрывался никогда, и весь маршрут
   * за ним стоял.
   */
  closeSupply: (orderId: string, comment: string) => Promise<boolean>;
}

/** Склад: числовая приёмка материалов + история складских операций (правки 2, 3) */
/** Фильтр раздела «Аналитика» */
export interface AnalyticsFilter {
  from: string;
  to: string;
  bucket?: 'day' | 'week';
  product?: string | null;
  dept?: string | null;
}

/** Карточки «Обзора»: то, что возвращает `erp_analytics_overview` */
export interface AnalyticsOverview {
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  released: number;
  released_prev: number;
  defect: number;
  rework: number;
  /** «Плюсы» — изделия сверх тиража (решение владельца 16.09) */
  extra: number;
  /** Средневзвешенная по выпуску; `null` — стоимость нигде не проставлена */
  assembly_avg: number | null;
  /** Сколько изделий выпуска покрыто стоимостью: среднее без покрытия врёт */
  assembly_covered_qty: number;
  fabric_kg: number;
  fabric_rolls: number;
  fabric_per_item: number | null;
}

export interface AnalyticsSeriesRow {
  bucket: string;
  released: number;
  defect: number;
  rework: number;
  extra: number;
  fabric: number;
}

export interface AnalyticsSkuRow {
  sku_card_id: string | null;
  product_type: string;
  released: number;
  defect: number;
  rework: number;
  extra: number;
  defect_pct: number | null;
  assembly_avg: number | null;
  orders: number;
}

export interface AnalyticsDeptRow {
  department_id: string;
  released: number;
  defect: number;
  rework: number;
  defect_pct: number | null;
}

export interface AnalyticsSnapshot {
  overview: AnalyticsOverview | null;
  series: AnalyticsSeriesRow[];
  bySku: AnalyticsSkuRow[];
  byDept: AnalyticsDeptRow[];
}

/**
 * ЭКОНОМИКА ПОЗИЦИИ (правка 20.09, п. 9) — ответ `erp_item_economics`.
 *
 * Расход полотна возвращается РАЗБИВКОЙ ПО ЕДИНИЦАМ, а стоимость — одним
 * числом: сложить «61 кг и 120 м» нельзя (правило раздела «пересчёта единиц
 * система не делает»), а рубли складываются всегда.
 *
 * Ключа «расход на годную единицу» здесь НЕТ намеренно: документ прямо
 * запрещает его выводить, а «посчитать и не показать» — приглашение вернуть
 * его следующей правкой.
 */
export interface ItemEconomicsFabric {
  unit: string | null;
  qty_used: number;
  cost: number | null;
  /** По какой доле расхода цена нашлась: среднее по трети выглядит как среднее по всему */
  priced_qty: number;
  /** Средний расход на ВЫКРОЕННУЮ единицу; null — кроя ещё не было */
  avg_per_cut: number | null;
}

export interface ItemEconomics {
  item_id: string;
  fabric: ItemEconomicsFabric[];
  fabric_cost_total: number | null;
  rolls_used: number;
  qty_cut: number;
  qty_good: number;
  assembly: {
    avg: number | null;
    covered_qty: number;
    /** `reports` — из отчётов швейки; `item_fallback` — из колонки позиции */
    source: 'reports' | 'item_fallback' | null;
  };
  fabric_cost_per_good: number | null;
  direct_unit_cost: number | null;
}

export interface OrderEconomicsRow {
  item_id: string;
  product_type: string | null;
  variant: string | null;
  qty: number;
  economics: ItemEconomics;
}

export interface AnalyticsSlice {
  /**
   * Экономика позиций ОДНОГО заказа, ключ — его id (правка 20.09, п. 9).
   * Вкладка делает один вызов на заказ, а не по одному на позицию.
   */
  orderEconomics?: Record<string, OrderEconomicsRow[]>;
  economicsLoading?: boolean;
  loadOrderEconomics: (orderId: string) => Promise<OrderEconomicsRow[] | null>;
  /** Последний снимок и его ключ: тот же фильтр — тот же ответ */
  analytics?: AnalyticsSnapshot | null;
  analyticsKey?: string | null;
  analyticsLoading?: boolean;
  /**
   * Сводка за период. Возвращает `null`, когда хотя бы одна агрегация
   * не удалась: половина снимка молча врала бы про остальные показатели.
   */
  loadAnalytics: (filter: AnalyticsFilter) => Promise<AnalyticsSnapshot | null>;
}

export interface WarehouseSlice {
  /**
   * Приёмка материала складом ОДНОЙ транзакцией (RPC `erp_material_accept`):
   * строка журнала `erp_material_receipts` плюс статус позиции. Сумму журнала
   * в `qty_received` кладёт триггер — он единственный писатель количества.
   *
   * `qty` необязателен: правка статуса или комментария у уже принятого
   * материала нового прихода не означает. Гейт «принято невозможно при нулевом
   * приходе» стоит на сервере.
   *
   * Факт-атрибуты (правка 4.1.3) — что фактически поступило (пересорт/расхождение).
   */
  acceptMaterial: (
    materialId: string,
    opts: {
      qty?: number | null;
      accept_status: MaterialAcceptStatus;
      accept_comment?: string | null;
      invoice?: string | null;
      fact_name?: string | null;
      fact_color?: string | null;
      fact_article?: string | null;
      /**
       * Ключ идемпотентности ОДНОЙ попытки приёмки. Повтор той же попытки
       * (обрыв ответа, второе нажатие) несёт тот же ключ и второй строки
       * журнала не создаёт: сумма журнала — это количество материала
       * на фабрике, и удвоить её молча нельзя.
       */
      clientKey?: string | null;
      /**
       * Что пришло по размерам (правка 16.09, п. 2) — только у закупки
       * готового изделия. При непустой разбивке количество прихода
       * СЧИТАЕТ СЕРВЕР по ней же, и поле «Пришло сейчас» из формы уходит:
       * два писателя одного числа разошлись бы на первой опечатке.
       */
      sizeGrid?: SizeGridRow[] | null;
      /**
       * Сколько РУЛОНОВ пришло (правка 16.09, п. 5). Обязательно для единиц,
       * учитываемых рулонами (`utils/materialUnit`), и то же условие стоит
       * внутри RPC: гейт формы и гейт сервера ставятся одним коммитом.
       */
      rolls?: number | null;
      /**
       * Вес КАЖДОГО рулона в порядке их создания (правка 21.09, п. 2).
       * Сумма обязана сойтись с приходом — это проверяет и форма, и сервер
       * (22023). Пусто — рулоны заводятся без веса, как до правки: очередь
       * офлайна хранит уже собранные вызовы, и ломать их выкатом нельзя.
       */
      rollWeights?: number[] | null;
    },
  ) => Promise<boolean>;
  /**
   * Проставить вес рулонам, принятым ДО правки 21.09 (у них он пуст).
   * Сумма сверяется со всем принятым количеством материала — на сервере,
   * тем же правилом, что при приёмке.
   */
  setRollWeights: (
    materialId: string,
    weights: { roll_id: string; qty: number }[],
  ) => Promise<boolean>;
  /**
   * Журнал приходов конкретных позиций закупки (`erp_material_receipts`).
   *
   * ТОЧЕЧНО, а не в общей выборке заказа: журнал растёт быстрее всего,
   * а нужен он ровно в двух местах — окне приёмки изделия (сложить
   * фактически закупленное по размерам) и карточке закупки. Класть его
   * в `ORDER_SELECT` значило бы возить историю приходов на каждый экран.
   */
  loadMaterialReceipts: (materialIds: string[]) => Promise<ErpMaterialReceipt[]>;
  /** Прочая складская операция (упаковка/отгрузка/маркировка) → строка erp_warehouse_ops */
  /**
   * Отчёт склада по задаче (волна 3.4): журнал `erp_stage_reports` с якорем
   * складской задачи. Приёмка ГП считается в штуках — там же, где отчёты цехов.
   */
  submitWarehouseReport: (taskId: string, input: {
    qtyIn?: number | null;
    qtyGood?: number;
    qtyDefect?: number;
    comment?: string | null;
    extra?: Record<string, unknown>;
  }) => Promise<boolean>;
  logWarehouseOp: (
    orderId: string,
    op: { op_type: WarehouseOpType; material_id?: string | null; qty?: number | null; note?: string | null },
  ) => Promise<ErpWarehouseOp | null>;
  /**
   * Продвижение задачи склада по её стейт-машине (волна 4). Optimistic+rollback;
   * значимые переходы пишутся в историю erp_warehouse_ops; pack_ship→shipped
   * вызывает shipOrder (гейт isOrderReadyToShip) — заказ уходит в архив.
   */
  advanceWarehouseTask: (
    taskId: string,
    status: WarehouseTaskStatus,
    extra?: { marking_type?: string | null; deadline?: string | null; note?: string | null },
  ) => Promise<boolean>;
}

/** Задачи закупки (дозакупка/замена при возврате брака) */
export interface ProcurementSlice {
  /** Задача закупки (возврат из закроя → дозакупка/замена, не трогая исходную закупку) */
  createProcurementTask: (
    orderId: string,
    task: Partial<ErpProcurementTask> & Pick<ErpProcurementTask, 'material_name' | 'cause_type'>,
  ) => Promise<ErpProcurementTask | null>;
  updateProcurementTask: (id: string, patch: Partial<ErpProcurementTask>) => Promise<boolean>;
}

/** Подряд: операции у внешних подрядчиков (грузятся лениво по вкладке) */
export interface SubcontractingSlice {
  subcontracting: ErpSubcontractOp[];
  subcontractingLoaded: boolean;
  /**
   * Сообщение об отказе загрузки, иначе null.
   *
   * Заведено аудитом 03.09: без флага экран не мог отличить «ещё едет»
   * от «не приехало», и правило проекта «ошибка → скелетон → пусто»
   * исполнялось на треть. Скелетон висел на `!loaded`, а `loaded` при
   * отказе не поднимается — то есть экран грузился ВЕЧНО, а эффект
   * `if (!loaded) load()` второй раз не срабатывает: выход только F5.
   */
  subcontractingError: string | null;
  /** Подряд: список операций у подрядчиков (join заголовок заказа) */
  loadSubcontracting: () => Promise<void>;
  createSubcontractOp: (
    op: Partial<ErpSubcontractOp> & Pick<ErpSubcontractOp, 'order_id' | 'operation'>,
  ) => Promise<ErpSubcontractOp | null>;
  /**
   * Перемещение по подряду (волна 3.5): строка журнала `erp_subcontract_moves`.
   * Количества на карточке ведёт триггер; приёмка приращает `qty_done`
   * привязанного этапа — подряд ведёт себя как этап маршрута.
   */
  addSubcontractMove: (subcontractId: string, input: {
    kind: SubcontractMoveKind;
    qty: number;
    movedOn?: string | null;
    comment?: string | null;
  }) => Promise<boolean>;
  /**
   * Действие над операцией (правки 20.08): фаза и запись журнала одной
   * транзакцией (`erp_subcontract_apply`). Спецификации действий —
   * `utils/subcontractFlow.SUBCONTRACT_ACTIONS`.
   */
  applySubcontractAction: (
    id: string,
    action: {
      phase: string;
      move: 'send' | 'return' | 'defect' | null;
      /** Действие задаёт объём работы у подрядчика (правка 22.08, п. 3.8) */
      asksInWork?: boolean;
    },
    input?: {
      qty?: number | string;
      /** Сколько единиц подрядчик делает — отдельно от физической передачи */
      inWorkQty?: number | string;
      movedOn?: string | null;
      comment?: string | null;
    },
  ) => Promise<boolean>;
  /**
   * Приёмка подряда складом ОДНИМ действием: принято и брак — две записи
   * журнала в одной транзакции (`erp_subcontract_receive`).
   *
   * Раздельные вставки означали бы окно, в котором принято уже записано,
   * а брак ещё нет, — и правда о партии на экране неполная. Тем же приёмом
   * устроена приёмка материала.
   */
  receiveSubcontract: (id: string, input: {
    accepted: number | string;
    defect?: number | string;
    /**
     * Сколько партия физически привезла (§3.5 обхода 04.09). До 04.09 возврат
     * фиксировал только менеджер, и склад ждал его, чтобы принять то, что уже
     * стоит на складе.
     */
    returned?: number | string;
    movedOn?: string | null;
    comment?: string | null;
  }) => Promise<boolean>;
  updateSubcontractOp: (id: string, patch: Partial<ErpSubcontractOp>) => Promise<boolean>;

  /**
   * ТЗ и файлы подрядного ЭТАПА (документ 20.08, девятое поле подрядного шага).
   * Файл уезжает наружу вместе с партией, поэтому привязан к этапу, а не
   * к позиции: подрядных этапов в позиции бывает несколько, и чужая схема
   * узла хуже никакой.
   */
  /**
   * `kind` — вид вложения (правка 12.09, баг 02): `subcontract` — файл,
   * который ОТДАЮТ подрядчику, `stage_result` — результат, который цех СДАЁТ
   * (программа вышивки). Путь в бакет, уборка сироты и привязка к этапу у них
   * одни; вторая копия действия разошлась бы с первой молча — обе «работают»,
   * просто пишут по-разному.
   */
  uploadStageFile: (input: {
    stageId: string;
    orderId: string;
    itemId?: string | null;
    file: File;
    kind?: Extract<ErpAttachmentKind, 'subcontract' | 'stage_result'>;
  }) => Promise<boolean>;
  /** Снять файл этапа: пустой ответ DELETE — отказ RLS, а не «файл снят» */
  deleteStageFile: (orderId: string, attachmentId: string) => Promise<boolean>;
}

/** Сотрудники и профили: список, привязка цеха, роли */
export interface EmployeesSlice {
  employees: ErpEmployee[];
  profilesList: StaffProfile[];
  employeesLoaded: boolean;
  /**
   * Причина, по которой список не загрузился. Отдельно от `employeesLoaded`:
   * «ещё не грузили» и «попытались и не смогли» — разные состояния экрана,
   * и второе обязано давать кнопку повтора (правило UX-2).
   */
  employeesError: string | null;
  /** Цех текущего пользователя (erp_employees.department_id по profile_id) */
  myDeptId: string | null;
  /** Цеховая роль текущего пользователя — вход в матрицу прав (ядро правки 11) */
  myRole: EmployeeRole | null;
  myDeptLoaded: boolean;

  /** Автопривязка цеха и цеховой роли: ищет erp_employees по profile_id пользователя */
  loadMyDept: (profileId: string | undefined) => Promise<void>;
  loadEmployees: () => Promise<boolean>;
  createEmployee: (emp: Partial<ErpEmployee> & { full_name: string }) => Promise<ErpEmployee | null>;
  updateEmployee: (id: string, patch: Partial<ErpEmployee>) => Promise<boolean>;
  /** Профили общие с Order Studio: те же действия, что в Админке */
  updateProfile: (id: string, patch: Partial<StaffProfile>) => Promise<boolean>;
  /** Цеховая надстройка профиля: upsert erp_employees по profile_id */
  upsertProfileDept: (
    profile: StaffProfile,
    patch: Partial<Pick<ErpEmployee, 'department_id' | 'role' | 'notes'>>,
  ) => Promise<boolean>;

  /**
   * Администрирование учётных записей. Всё это умеет только Admin API GoTrue
   * (`service_role`), поэтому идёт через серверную функцию `admin-users`:
   * ключ, обходящий RLS, в браузере не бывает. Гейт на сервере — `is_admin()`,
   * та же функция, на которой стоят политики `profiles`.
   */
  createUserAccount: (draft: NewUserDraft) => Promise<boolean>;
  /** Задать пароль сотруднику: письма встроенного SMTP теряются, звонок — нет */
  setUserPassword: (userId: string, password: string) => Promise<boolean>;
  /** Сменить адрес входа — и в `auth.users`, и в `profiles` одним действием */
  setUserEmail: (userId: string, email: string) => Promise<boolean>;
  /** Безвозвратно: не замена «Отключить», а случай «заведён по ошибке» */
  deleteUserAccount: (userId: string) => Promise<boolean>;

  /** Справочник цехов (правки 11/12): создание участка и правка его атрибутов */
  createDepartment: (
    dept: Pick<ErpDepartment, 'code' | 'name'> & Partial<ErpDepartment>,
  ) => Promise<ErpDepartment | null>;
  /** Название, порядок, признак брендирования, активность, руководитель, норматив */
  updateDepartment: (id: string, patch: Partial<ErpDepartment>) => Promise<boolean>;
}

/**
 * Приглашения по ссылке (`erp_invites`) — заведение сотрудника одним действием.
 * Гасит код серверный триггер регистрации, поэтому здесь только выдача,
 * список и отзыв.
 */
export interface InvitesSlice {
  invites: ErpInvite[];
  invitesLoaded: boolean;
  loadInvites: () => Promise<void>;
  /**
   * Возвращает созданную строку — админке нужен её `code`, чтобы собрать
   * ссылку и дать её скопировать.
   */
  createInvite: (draft: {
    profile_role: string;
    employee_role: EmployeeRole;
    department_id: string | null;
    email: string | null;
    note: string | null;
    expiresInHours: number;
  }) => Promise<ErpInvite | null>;
  /** Отзыв — `revoked_at`, не DELETE: журнал остаётся */
  revokeInvite: (code: string) => Promise<boolean>;
}

/** Права: матрица «роль × право» из erp_role_permissions (правка 11) */
export interface PermissionsSlice {
  /** null — матрица ещё не загружена (действуют DEFAULT_PERMISSIONS) */
  permissionMatrix: PermissionMatrix | null;
  /**
   * Последние правки матрицы — «кто трогал права недавно» (§5 обхода 04.09).
   * Не журнал: строка одна на пару «роль × право», значит виден ПОСЛЕДНИЙ
   * писатель каждой пары, а не история. Так и подписано на экране.
   */
  permissionTrail: ErpRolePermission[];
  permissionsLoaded: boolean;
  /**
   * Сообщение об отказе загрузки, иначе null.
   *
   * Заведено аудитом 03.09: без флага экран не мог отличить «ещё едет»
   * от «не приехало», и правило проекта «ошибка → скелетон → пусто»
   * исполнялось на треть. Скелетон висел на `!loaded`, а `loaded` при
   * отказе не поднимается — то есть экран грузился ВЕЧНО, а эффект
   * `if (!loaded) load()` второй раз не срабатывает: выход только F5.
   */
  permissionsError: string | null;
  loadPermissions: () => Promise<void>;
  /** Переключить право роли из редактора матрицы в админке */
  setRolePermission: (
    role: EmployeeRole,
    permission: ErpPermission,
    allowed: boolean,
  ) => Promise<boolean>;
}

/** Справочники админки: причины блокировок, типы проблем, изделий, поставщики (правка 12) */
export interface DictionariesSlice {
  dictionaries: ErpDictionaryItem[];
  dictionariesLoaded: boolean;
  /**
   * Сообщение об отказе загрузки, иначе null.
   *
   * Заведено аудитом 03.09: без флага экран не мог отличить «ещё едет»
   * от «не приехало», и правило проекта «ошибка → скелетон → пусто»
   * исполнялось на треть. Скелетон висел на `!loaded`, а `loaded` при
   * отказе не поднимается — то есть экран грузился ВЕЧНО, а эффект
   * `if (!loaded) load()` второй раз не срабатывает: выход только F5.
   */
  dictionariesError: string | null;
  loadDictionaries: () => Promise<void>;
  /** Код значения генерируется из названия, порядок — в конец списка вида */
  createDictionaryItem: (
    kind: DictionaryKind,
    name: string,
  ) => Promise<ErpDictionaryItem | null>;
  /** Переименование, деактивация (active:false вместо удаления), правка meta */
  updateDictionaryItem: (
    id: string,
    patch: Partial<Pick<ErpDictionaryItem, 'name' | 'active' | 'sort_order' | 'meta'>>,
  ) => Promise<boolean>;
  /** Переставить значение на позицию вверх/вниз внутри своего вида */
  moveDictionaryItem: (id: string, direction: 'up' | 'down') => Promise<boolean>;
}

/**
 * Аварийно снятые блокировки (правки заказчика 10.08).
 *
 * Список маленький и меняется редко, поэтому живёт целиком в сторе: гейты
 * спрашивают его синхронно, а `utils/bypass` решает, действует ли снятие.
 */
/**
 * Персональные уведомления — то, что адресовано ЧЕЛОВЕКУ, в отличие
 * от вычисляемых поводов вмешаться (`utils/notifications`), одинаковых
 * для всех. Слайс в ядре: счётчик показывает колокол оболочки, то есть
 * до открытия любого экрана.
 */
export interface NotificationsSlice {
  notifications: ErpNotification[];
  notificationsLoaded: boolean;
  loadNotifications: () => Promise<void>;
  /** Отметить прочитанными; уже прочитанные не трогаются — иначе read_at соврёт */
  markNotificationsRead: (ids: string[]) => Promise<boolean>;
  /**
   * ВСПЛЫВАЮЩИЕ (правка 20.09, п. 4) — то, что пришло ПРИ ЖИЗНИ вкладки.
   * Очередь считает слайс, а не компонент: правило «первая загрузка молчит»
   * иначе жило бы в эффекте оболочки, где его не проверить.
   */
  noticePopups: ErpNotification[];
  /** Что эта вкладка уже видела; сбрасывается вместе со стором при смене смены */
  noticeSeen: string[];
  /** Закрыть карточку — по нажатию или по таймеру */
  dismissNoticePopup: (id: string) => void;
}

/**
 * ЧАТ ВНУТРИ СДЕЛКИ (правка 14.09, п. 5).
 *
 * Данные лежат в ядре (`domainState`), как у всех доменных слайсов, — и по той
 * же причине, что у остальных: `resetErpStore()` обязан их вычистить, иначе
 * на общем цеховом планшете следующая смена откроет чужую переписку.
 * Действия приезжают доменным чанком: чат открывают с экрана.
 */
export interface ChatSlice {
  /**
   * ОКНО ЧАТА ПОВЕРХ ERP (правка 20.09, п. 4): «на компьютере открывать чат
   * в отдельном окне поверх ERP шириной примерно 760–960 px, с возможностью
   * развернуть».
   *
   * Состояние живёт В СТОРЕ, а не в экране: окно не должно закрываться
   * от перехода между разделами — в том и смысл окна поверх, что человек
   * продолжает работать, не теряя разговора.
   */
  chatWindow?: {
    orderId: string;
    title: string;
    context: ChatContext;
    contextLabel?: string | null;
    expanded: boolean;
  } | null;
  openChatWindow: (
    orderId: string,
    title: string,
    context?: ChatContext,
    contextLabel?: string | null,
  ) => void;
  closeChatWindow: () => void;
  /** Режим уведомлений по заказу: 'all' | 'mentions' | 'none' */
  loadChatMode: (orderId: string) => Promise<string>;
  setChatMode: (orderId: string, mode: string) => Promise<boolean>;
  toggleChatWindowSize: () => void;
  /**
   * Отметить показанные сообщения просмотренными (правка 20.09, п. 4).
   * Возвращает, сколько отметок реально добавилось: повтор той же пачки
   * не считается.
   */
  markChatSeen: (messageIds: string[]) => Promise<number>;
  /** Кто прочитал эти сообщения — для «Прочитали N» с именами и временем */
  loadChatReadReceipts: (messageIds: string[]) => Promise<ChatReadReceipt[]>;
  /**
   * Первое непрочитанное на момент ОТКРЫТИЯ переписки (правка 20.09, п. 4) —
   * перед ним лента рисует черту «Непрочитанные сообщения».
   *
   * Снимок, а не производная от счётчика: показ ленты тут же гасит счётчик,
   * и вычисляемая граница исчезала бы в тот же кадр.
   */
  chatUnreadAnchor?: string | null;
  /** Кого можно упомянуть и как называть автора; пусто — справочник не грузили */
  chatDirectory: ErpChatPerson[];
  chatDirectoryLoaded: boolean;
  /** Открытое обсуждение: заказ и контекст. `null` — окно закрыто */
  chatOrderId: string | null;
  chatContext: ChatContext;
  chatMessages: ErpChatMessage[];
  /** Есть ли что дочитывать ВВЕРХ (страница отдаёт последние N) */
  chatHasMore: boolean;
  chatLoading: boolean;
  chatError: string | null;
  /** Непрочитанное по заказам: вкладка «Чат» и кнопка у задания читают его */
  chatUnread: Record<string, ChatUnread>;
  /**
   * Звонок realtime: счётчик событий `erp_chat_messages`. Из события берётся
   * ТОЛЬКО факт «что-то пришло» — содержимое дочитывается `erp_chat_page`,
   * иначе видимость решалась бы дважды, фильтром подписки и функцией чтения.
   */
  chatPing: number;

  loadChatDirectory: () => Promise<void>;
  openChat: (orderId: string, context?: ChatContext) => Promise<void>;
  loadMoreChat: () => Promise<void>;
  refreshChat: () => Promise<void>;
  sendChatMessage: (input: {
    orderId: string;
    body: string;
    /** Ключ попытки (`utils/attemptKey`): повтор не создаёт второго сообщения */
    clientKey: string;
    context?: ChatContext;
    replyTo?: string | null;
    mentions?: string[];
    attachments?: { file_path: string; file_name?: string | null }[];
  }) => Promise<{ message_id: string; mentioned: string[] } | null>;
  /**
   * ПРАВКА СВОЕГО СООБЩЕНИЯ (вторая очередь чата). Только своё — это
   * проверяет и сервер (`erp_chat_edit`, 42501): возможность переписать
   * чужую реплику обесценивает переписку целиком.
   */
  editChatMessage: (input: {
    messageId: string;
    body: string;
    mentions?: string[];
  }) => Promise<boolean>;
  /**
   * УДАЛЕНИЕ СВОЕГО СООБЩЕНИЯ. Не оптимистично (правило раздела): удаление
   * необратимо, и показать «удалено» до ответа сервера значит однажды
   * показать это по ошибке сети.
   */
  deleteChatMessage: (messageId: string) => Promise<boolean>;
  /**
   * ПЕРЕКЛЮЧИТЬ РЕАКЦИЮ (вторая очередь чата). Одно действие на оба исхода:
   * решает сервер по факту удаления строки — клиент не знает наверняка,
   * стоит ли уже его реакция, и «посмотреть, потом поставить» давало бы
   * гонку на быстрых нажатиях.
   */
  toggleChatReaction: (messageId: string, emoji: string) => Promise<boolean>;
  /** Кто поставил реакции этого сообщения — по требованию, для подсказки */
  loadChatReactionPeople: (messageId: string) => Promise<ChatReactionPerson[]>;
  /**
   * ПОИСК ПО ПЕРЕПИСКЕ СДЕЛКИ (вторая очередь чата). Не фильтр поверх
   * загруженной ленты: искомое обычно ВЫШЕ страницы, и локальный фильтр
   * отвечал бы «ничего не найдено» там, где сообщение просто не доехало.
   */
  searchChat: (orderId: string, query: string) => Promise<ChatSearchHit[]>;
  loadChatUnread: (orderId: string) => Promise<void>;
  /**
   * Счётчики непрочитанного СРАЗУ ПО СПИСКУ заказов (правка 20.09, п. 4):
   * «в списке заказов показывать число непрочитанных сообщений». Один вызов
   * на страницу, а не на строку — иначе открытие раздела означало бы
   * полсотни запросов.
   */
  loadChatUnreadMany: (orderIds: string[]) => Promise<void>;
  markChatRead: (orderId: string, stageId?: string | null) => Promise<void>;
  closeChat: () => void;
}

/**
 * КАТАЛОГ SKU (правка 14.09, п. 6). Данные — в ядре (`domainState`), как
 * у всех доменных слайсов: `resetErpStore()` обязан их вычистить.
 */
export interface SkuSlice {
  skuCards: ErpSkuCard[];
  skuCardsLoaded: boolean;
  skuCardsError: string | null;
  /**
   * Коды, уже выпущенные в прайс-каталог визарда. Не флаг у карточки:
   * «выпущен ли артикул» — факт ПРАЙСА, и хранить его копией значило бы
   * завести второй источник, который разойдётся в первую же публикацию.
   */
  skuPriceCodes: string[];

  loadSkuCards: () => Promise<void>;
  saveSkuCard: (id: string, patch: Partial<ErpSkuCard>) => Promise<boolean>;
  createSkuCard: (input: Partial<ErpSkuCard> & { code: string; name: string })
    => Promise<ErpSkuCard | null>;
  loadSkuCardDetail: (id: string)
    => Promise<{ versions: ErpSkuCardVersion[]; files: ErpSkuCardFile[] }>;
  loadSkuCardStats: (id: string)
    => Promise<{ orders: number; qty: number; lastOrderAt: string | null } | null>;
}

export interface BypassSlice {
  bypasses: ErpBypass[];
  bypassesLoaded: boolean;
  /**
   * Сообщение об отказе загрузки, иначе null.
   *
   * Заведено аудитом 03.09: без флага экран не мог отличить «ещё едет»
   * от «не приехало», и правило проекта «ошибка → скелетон → пусто»
   * исполнялось на треть. Скелетон висел на `!loaded`, а `loaded` при
   * отказе не поднимается — то есть экран грузился ВЕЧНО, а эффект
   * `if (!loaded) load()` второй раз не срабатывает: выход только F5.
   */
  bypassesError: string | null;
  loadBypasses: () => Promise<void>;
  /** Снять проверку: причина обязательна, `orderId = null` — для всей системы */
  createBypass: (
    kind: BypassKind,
    orderId: string | null,
    reason: string,
  ) => Promise<ErpBypass | null>;
  /** Вернуть проверку. Запись остаётся в журнале — это не удаление */
  restoreBypass: (id: string) => Promise<boolean>;
}

/**
 * Настройки производства (правки заказчика 10.08, волна 2).
 *
 * Пока это одна запись — общая мощность в единицах за месяц. В `erp_bootstrap()`
 * она не едет: пакет оболочки приезжает КАЖДОМУ на каждом экране, а мощность
 * нужна трём — обзору, плану и загрузке. Они её и просят, один раз за сессию.
 */
export interface SettingsSlice {
  capacity: CapacitySettings;
  capacityLoaded: boolean;
  /**
   * Сообщение об отказе загрузки, иначе null.
   *
   * Заведено аудитом 03.09: без флага экран не мог отличить «ещё едет»
   * от «не приехало», и правило проекта «ошибка → скелетон → пусто»
   * исполнялось на треть. Скелетон висел на `!loaded`, а `loaded` при
   * отказе не поднимается — то есть экран грузился ВЕЧНО, а эффект
   * `if (!loaded) load()` второй раз не срабатывает: выход только F5.
   */
  capacityError: string | null;
  loadSettings: () => Promise<void>;
  /** Сохранить мощность; право — `plan.manage`, как у самого плана */
  saveCapacity: (next: CapacitySettings) => Promise<boolean>;
}

/** Realtime: точечное применение postgres_changes + подписка */
export interface RealtimeSlice {
  /**
   * Живой ли канал изменений. `false` означает, что экран мог устареть:
   * события за время разрыва не придут никогда, их можно только запросить.
   * Интерфейс обязан это ПОКАЗЫВАТЬ — планшет цеха после сна выглядел
   * рабочим, показывая позавчерашнюю очередь.
   */
  realtimeLive: boolean;
  /** Идёт перечитывание после разрыва */
  realtimeResyncing: boolean;
  /** Перечитать данные: возврат вкладки, появление сети, восстановление канала */
  resyncRealtime: () => Promise<void>;
  /** Точечное применение realtime-события (экспорт действия — для тестов) */
  applyRealtimeEvent: (ev: ErpRealtimeEvent) => void;
  /** Realtime: доска/очереди обновляются сами; возвращает отписку */
  subscribeRealtime: () => () => void;
}

/** Экспериментальный цех (правка 6): воронка разработки со стейт-машиной фаз */
/**
 * Правка разработки.
 *
 * Колонка `constructor` (конструктор изделия) сталкивается с
 * `Object.prototype.constructor`: тип с полем `constructor?: string`
 * TypeScript не даёт заполнить объектным литералом ВООБЩЕ — ни `Partial`,
 * ни `Omit` с обратным добавлением не спасают, проверяется «видимый» тип
 * литерала. Поэтому поле приходит под своим именем `constructorName`,
 * а слайс перекладывает его в колонку. Переименовывать колонку в базе
 * ради этого нельзя — она уже в данных и в истории.
 */
export type DevPatch =
  Partial<Omit<ErpExperimental, 'constructor' | 'tasks' | 'ops' | 'order' | 'attachments'>> & {
    /** Конструктор изделия → колонка `constructor` */
    constructorName?: string | null;
  };

/** Одна задача во входе `addDevTasks`; `depends_on` — ИНДЕКСЫ в этом же массиве */
export interface DevTaskInput {
  task_type: string;
  title?: string | null;
  responsible?: string | null;
  due_date?: string | null;
  status?: DevTaskStatus;
  comment?: string | null;
  qty?: number | null;
  depends_on?: number[];
}

export interface ExperimentalSlice {
  experimental: ErpExperimental[];
  experimentalLoaded: boolean;
  /**
   * Сообщение об отказе загрузки, иначе null.
   *
   * Заведено аудитом 03.09: без флага экран не мог отличить «ещё едет»
   * от «не приехало», и правило проекта «ошибка → скелетон → пусто»
   * исполнялось на треть. Скелетон висел на `!loaded`, а `loaded` при
   * отказе не поднимается — то есть экран грузился ВЕЧНО, а эффект
   * `if (!loaded) load()` второй раз не срабатывает: выход только F5.
   */
  experimentalError: string | null;
  loadExperimental: () => Promise<void>;
  /**
   * `orderId` НЕОБЯЗАТЕЛЕН (правка 14.09): `null` заводит разработку «на полку».
   * Сигнатура осталась позиционной, потому что вызывающих два и оба передают
   * заказ явно — создание из формы заказа и форма «Завести разработку».
   */
  createExperimental: (
    orderId: string | null,
    input?: { item_id?: string | null; tech_name?: string | null },
  ) => Promise<ErpExperimental | null>;
  /**
   * Привязать разработку «с полки» к сделке. Отдельное действие, а не правка
   * колонки через `updateExperimental`: после него разработка попадает в гейт
   * отгрузки заказа, её переписка становится видна из чата сделки, а завершение
   * заводит складскую задачу приёмки ГП. Повторная привязка запрещена сервером.
   */
  attachOrderToDev: (
    devId: string,
    orderId: string,
    itemId?: string | null,
  ) => Promise<boolean>;
  updateExperimental: (id: string, patch: DevPatch) => Promise<boolean>;

  /**
   * Пачка задач ОДНОЙ транзакцией (`erp_experimental_add_tasks`).
   * Зависимости внутри пачки задаются индексами массива — так же, как этапы
   * в `erp_create_order`. Какие задачи создать и как связать, решает клиент;
   * сервер отвечает за атомарность и номер круга.
   */
  addDevTasks: (
    experimentalId: string,
    tasks: DevTaskInput[],
  ) => Promise<ErpExperimentalTask[] | null>;

  /**
   * Правка задачи. Задача, переданная в цех (`stage_id`), статуса отсюда
   * НЕ принимает: его ведёт триггер, и второй писатель затирал бы первого.
   */
  updateDevTask: (
    id: string,
    patch: Partial<ErpExperimentalTask>,
  ) => Promise<boolean>;

  /**
   * Передача задачи в цех (`erp_experimental_task_send`): этап с
   * `origin='experimental'` + привязка `stage_id`, одной транзакцией.
   */
  sendDevTaskToDept: (
    taskId: string,
    input: { department_id: string; planned_end?: string | null; qty?: number | null },
  ) => Promise<boolean>;

  /**
   * Перенос финального пакета в каталог SKU (решение заказчика 21.08).
   * Возвращает код артикула или null. Недостающее собирает форма сверки —
   * действие ничего не придумывает (`utils/skuFromDev` считает перечень).
   */
  transferDevToSku: (devId: string, sku: Record<string, unknown>) => Promise<string | null>;

  /** Зафиксировать исход разработки (ТЗ п.9) — финальный статус, не этап */
  closeExperimental: (
    id: string,
    input: { outcome: DevOutcome; comment?: string | null },
  ) => Promise<boolean>;

  /**
   * Образец утверждён (правки 20.08). ЕДИНСТВЕННОЕ хранимое решение по этапам:
   * из статусов задач его не вывести — закрытая примерка означает и «принято»,
   * и «не принято». Снятие (`null`) допустимо: решение принимает человек,
   * и ошибиться он вправе.
   */

  /**
   * Файл финального пакета: лекала, техпаспорт, фото образца. Уходит в бакет
   * СРАЗУ и привязывается к РАЗРАБОТКЕ (`experimental_id`), а не к позиции:
   * лекала описывают модель, а не тот заказ, из которого она вышла.
   */
  uploadDevFile: (input: {
    devId: string;
    orderId: string;
    kind: ErpAttachmentKind;
    file: File;
    /** Задача, к которой приложен файл (п. 4.4). Пусто — файл всей разработки */
    taskId?: string | null;
  }) => Promise<boolean>;

  /** Снять файл пакета (техпаспорт вышел новой версией, фото переснято) */
  deleteDevFile: (devId: string, attachmentId: string) => Promise<boolean>;
}

/**
 * Технические задания в PDF (волна 4): загрузка, версии, назначение цехам.
 * Просмотр правом не гейтится — читают все; правит только `tz.manage`.
 */
export interface TzSlice {
  /** Загрузить новый документ ТЗ. `itemId = null` — общее ТЗ заказа */
  uploadTzDocument: (input: {
    orderId: string;
    itemId?: string | null;
    file: File;
    note?: string | null;
  }) => Promise<ErpTzDocument | null>;
  /**
   * Заменить файл: новая версия в той же группе, `is_current` снимается со старой.
   * ТЗ принадлежит позиции, поэтому обновление подхватывают все цеха её маршрута.
   */
  replaceTzDocument: (groupId: string, file: File, note?: string | null)
    => Promise<ErpTzDocument | null>;
  /** Включить/выключить требование ТЗ у заказа (для заказов, заведённых до внедрения) */
  setTzRequired: (orderId: string, required: boolean) => Promise<boolean>;
}

/**
 * Производственный план (правка менеджера 2026-08-03): раскладка этапов по цехам
 * и дням + ежедневный факт от цеха. Система план не составляет и остаток сама
 * не переносит — только показывает отклонение.
 */
export interface PlanSlice {
  planSlots: ErpCalendarSlot[];
  planComments: ErpPlanComment[];
  planLoaded: boolean;
  planLoading: boolean;
  planLoadError: boolean;

  /**
   * Этапы, у которых уже есть НЕотменённая задача на сегодня или позже.
   *
   * Отдельно от `planSlots`, потому что вопрос другой: слоты грузятся за
   * видимую неделю, а «запланировано ли вообще» смотрит вперёд без границы.
   * Считать по загруженной неделе значило бы показывать в очереди
   * «Не запланировано» работу, разложенную на следующую, — и планировать её
   * дважды.
   */
  plannedStageIds: string[];
  plannedAheadLoaded: boolean;
  loadPlannedAhead: () => Promise<void>;

  /** Задачи за период (обычно неделя) */
  loadPlan: (fromDate: string, toDate: string) => Promise<void>;
  /** Поставить этап в план на дату; повторная постановка на ту же дату — правка */
  planStage: (input: {
    stageId: string;
    departmentId: string;
    workDate: string;
    qty: number;
    comment?: string | null;
    priority?: number;
  }) => Promise<ErpCalendarSlot | null>;
  updatePlanSlot: (id: string, patch: Partial<ErpCalendarSlot>) => Promise<boolean>;
  /** Перенести задачу на другой день (встаёт в конец того дня) */
  movePlanSlot: (id: string, workDate: string) => Promise<boolean>;
  /** Снять задачу из плана — статусом, не удалением */
  cancelPlanSlot: (id: string) => Promise<boolean>;
  /** Факт за день: qty_done накопительный, повторный ввод исправляет */
  reportPlanFact: (id: string, input: {
    qty: number;
    defect?: number;
    comment?: string | null;
    deviationReason?: string | null;
  }) => Promise<boolean>;
  reportPlanProblem: (id: string, problem: {
    type: string;
    note?: string | null;
    affectsDue?: boolean;
    needsHelp?: boolean;
    canContinue?: boolean;
  }) => Promise<boolean>;
  clearPlanProblem: (id: string) => Promise<boolean>;
  loadPlanComments: (slotId: string) => Promise<void>;
  addPlanComment: (slotId: string, text: string, side: 'manager' | 'shop')
    => Promise<ErpPlanComment | null>;
}

/** Полный контракт ERP-стора — пересечение доменных слайсов */

/**
 * Запись по заказу — доменный слайс `orderWriteSlice`.
 * Список читает оболочка, а ПИШЕТ только ленивый экран: почему это
 * разделено, написано в шапке самого слайса.
 */
export interface OrderWriteSlice {
  /**
   * Правка созданного заказа одной транзакцией (правка 12.09, п. 7).
   * `payload` — секции `order` и `items` (с нанесениями и бирками) в том же
   * виде, что принимает `erp_update_order`. Маршрут сюда не входит: он
   * правится конструктором, иначе правка срока стёрла бы факт цеха.
   */
  saveOrderEdits: (orderId: string, payload: Record<string, unknown>) => Promise<boolean>;
  createOrder: (input: NewOrderInput) => Promise<ErpOrderFull | null>;
  updateOrder: (id: string, patch: Partial<ErpOrder>) => Promise<boolean>;
  /**
   * Сформировать PDF листа закупки (правки 16.08, п. 15). Считает и кладёт файл
   * СЕРВЕР: документ требует, чтобы система делала это сама, а PDF-библиотека
   * в клиенте стоила бы 100–200 кБ при оболочке на 97 % бюджета.
   */
  generatePurchaseListPdf: (orderId: string) => Promise<boolean>;
  /**
   * Отгрузка готового заказа: status → done_* (по сроку клиента),
   * shipped_status → shipped, shipped_at/shipped_by. Заказ уходит в архив.
   */
  /**
   * Фактическая передача клиенту (правка 30.08, п. 6). `lines` — что отдано
   * СЕЙЧАС; без них отгружается весь остаток (прежнее поведение «Отгрузить»
   * целиком). `clientKey` — ключ идемпотентности повторной отправки.
   */
  shipOrder: (
    orderId: string,
    lines?: { item_id: string; qty: number }[] | null,
    opts?: { note?: string | null; clientKey?: string | null },
  ) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  /** Фото брака/блокировки: файл в bucket erp-attachments + запись kind=attachment */
  /**
   * Загрузить файл заказа. `kind` (правка 14.09, п. 3) выбирает папку:
   * `attachment` — «Файлы сделки», `production` — «Файлы производства».
   * По умолчанию прежнее поведение: два вызывающих на `.js` (фото блокировки
   * и фото брака) аргумент не передают.
   */
  uploadOrderAttachment: (
    orderId: string, file: File, note?: string, kind?: ErpAttachmentKind,
  ) => Promise<boolean>;
  /** Снять файл заказа (строка + объект бакета). Не оптимистично: «0 строк» — отказ RLS */
  deleteOrderAttachment: (orderId: string, attachmentId: string) => Promise<boolean>;
  /** Переложить файл между папками: пишется РОВНО `kind`, зеркало — `erp_attachment_guard` */
  moveOrderAttachment: (
    orderId: string, attachmentId: string, kind: ErpAttachmentKind,
  ) => Promise<boolean>;
  addComment: (orderId: string, text: string) => Promise<ErpOrderComment | null>;
}

export type ErpStore = BootstrapSlice &
  OrdersSlice &
  OrdersOnDemandSlice &
  OrderWriteSlice &
  StagesSlice &
  MaterialsSlice &
  WarehouseSlice &
  ProcurementSlice &
  SubcontractingSlice &
  OrderDraftsSlice &
  EmployeesSlice &
  InvitesSlice &
  PermissionsSlice &
  DictionariesSlice &
  ExperimentalSlice &
  TzSlice &
  PlanSlice &
  BypassSlice &
  SettingsSlice &
  NotificationsSlice &
  ChatSlice &
  SkuSlice &
  AnalyticsSlice &
  RealtimeSlice;
