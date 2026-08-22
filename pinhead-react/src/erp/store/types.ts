/**
 * DTO/интерфейсы ERP-стора (вынесены из useErpStore.ts, рефакторинг по плану аудита).
 * Отдельный модуль — чтобы слайсы/хелперы могли ссылаться на ErpOrderFull и др.
 * без циклического импорта через useErpStore.ts. Реэкспорт — в useErpStore.ts.
 */

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
  ErpPermission,
  ErpItemPrint,
  ErpItemStage,
  ErpMaterial,
  ErpMaterialSupplier,
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
  orderDraftById: (id: string) => ErpOrderDraft | null;
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
  is_demo?: boolean;
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
   * Показывать ли тестовые заказы (`is_demo`). По умолчанию нет.
   *
   * Фильтр применяется в САМОМ запросе, а не в экранах: на 03.08.2026 демо —
   * это 26 активных заказов из 76, и они одинаково попадали и в списки,
   * и в счётчики цехов, и в уведомления о просрочке. Отфильтровать их
   * в пятнадцати местах значит однажды забыть одно.
   *
   * `loadOne` фильтру НЕ подчиняется: прямая ссылка на демо-заказ обязана
   * открываться, иначе спрятанное становится недоступным.
   */
  showDemoOrders: boolean;
  /** Переключить показ демо и перезагрузить списки (доступно admin/director) */
  setShowDemoOrders: (value: boolean) => Promise<void>;
  /** Пометить заказ тестовым / снять пометку */
  setOrderDemo: (id: string, value: boolean) => Promise<boolean>;

  /** Основная загрузка: только активные заказы (архив — loadArchive) */
  loadAll: () => Promise<void>;
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
   */
  findOrdersByBitrixId: (bitrixId: string) => Promise<ErpOrderBrief[]>;

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
  createOrder: (input: NewOrderInput) => Promise<ErpOrderFull | null>;
  updateOrder: (id: string, patch: Partial<ErpOrder>) => Promise<boolean>;
  /**
   * Отгрузка готового заказа: status → done_* (по сроку клиента),
   * shipped_status → shipped, shipped_at/shipped_by. Заказ уходит в архив.
   */
  /**
   * Сформировать PDF листа закупки (правки 16.08, п. 15). Считает и кладёт файл
   * СЕРВЕР: документ требует, чтобы система делала это сама, а PDF-библиотека
   * в клиенте стоила бы 100–200 кБ при оболочке на 97 % бюджета.
   */
  generatePurchaseListPdf: (orderId: string) => Promise<boolean>;
  shipOrder: (orderId: string) => Promise<boolean>;
  deleteOrder: (id: string) => Promise<boolean>;
  /** Фото брака/блокировки: файл в bucket erp-attachments + запись kind=attachment */
  uploadOrderAttachment: (orderId: string, file: File, note?: string) => Promise<boolean>;
  loadOrderEvents: (orderId: string) => Promise<ErpStageEvent[] | null>;
  loadOrderAudit: (orderId: string) => Promise<ErpOrderAuditRow[] | null>;
  uploadOrderPreview: (orderId: string, file: File) => Promise<boolean>;
  loadComments: (orderId: string) => Promise<ErpOrderComment[] | null>;
  addComment: (orderId: string, text: string) => Promise<ErpOrderComment | null>;
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
  reportProgress: (stageId: string, qty: number) => Promise<boolean>;
  /** Брак: пользователь выбирает этап устранения; при необходимости — задача закупки */
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
  }) => Promise<boolean>;
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
  takeSupply: (orderId: string) => Promise<boolean>;
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
    },
  ) => Promise<boolean>;
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
  uploadStageFile: (input: {
    stageId: string;
    orderId: string;
    itemId?: string | null;
    file: File;
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
  permissionsLoaded: boolean;
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
export interface BypassSlice {
  bypasses: ErpBypass[];
  bypassesLoaded: boolean;
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
  loadExperimental: () => Promise<void>;
  createExperimental: (
    orderId: string,
    input?: { item_id?: string | null; tech_name?: string | null },
  ) => Promise<ErpExperimental | null>;
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
  approveSample: (id: string, note?: string | null) => Promise<boolean>;

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
export type ErpStore = BootstrapSlice &
  OrdersSlice &
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
  RealtimeSlice;
