/**
 * DTO/интерфейсы ERP-стора (вынесены из useErpStore.ts, рефакторинг по плану аудита).
 * Отдельный модуль — чтобы слайсы/хелперы могли ссылаться на ErpOrderFull и др.
 * без циклического импорта через useErpStore.ts. Реэкспорт — в useErpStore.ts.
 */

import type { PermissionMatrix } from '../utils/permissions';
import type {
  BrandingMethod,
  BrandingOn,
  DictionaryKind,
  EmployeeRole,
  ErpDepartment,
  ErpDictionaryItem,
  ErpEmployee,
  ErpPermission,
  ErpItemPrint,
  ErpItemStage,
  ErpMaterial,
  ErpMaterialSupplier,
  ErpOrder,
  ErpOrderItem,
  ErpExperimental,
  ErpExperimentalOp,
  ErpProcurementTask,
  ErpStageEvent,
  ErpSubcontractOp,
  ErpCalendarSlot,
  ErpPlanComment,
  ErpTzDocument,
  ErpWarehouseOp,
  ErpWarehouseTask,
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

export interface ErpOrderAttachment {
  id: string;
  order_id: string;
  file_path: string;
  file_name: string | null;
  kind: 'preview' | 'attachment';
  uploaded_by: string | null;
  created_at: string;
}

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
  method: BrandingMethod;
  fabric?: string;
  zone?: string;
  width_mm?: number | null;
  height_mm?: number | null;
  offset_note?: string;
  pantone?: string;
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
  /** Подряд (волна 4.2): тип и источник материалов — для production_type='outsource' */
  subcontract_kind?: 'finished_product' | 'operation';
  material_source?: 'pinhead' | 'contractor';
  /** Что за операция делает подрядчик (правка 4.2.3) — для «отдельной операции» */
  subcontract_operation?: string;
  /** Следующий участок после отдельной операции (код цеха); null = доработка не нужна */
  return_dept?: string | null;
  /**
   * Нужен ли финальный ОТК (галочка позиции в форме, по умолчанию да).
   * Влияет только на маршрут: в `erp_order_items` не пишется, потому что
   * этапы уже материализованы и повторно по флагу не пересчитываются.
   */
  needs_qc?: boolean;
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
   * ТЗ в PDF: файлы уже загружены в бакет, RPC вставляет их одной транзакцией
   * с заказом — «создать заказ без ТЗ» невозможно даже при сбое.
   * `assignments` больше не заполняется (см. NewOrderTzAssignment).
   */
  tz?: { documents: NewOrderTzDocument[]; assignments?: NewOrderTzAssignment[] };
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
   * Заказы, загруженные ПОЛНЫМ select-ом (`loadOne`).
   *
   * Списочный запрос не тянет колонки, нужные только карточке (размерная сетка),
   * поэтому «заказ есть в сторе» больше не значит «данных достаточно». Карточка
   * дозагружает себя по этому признаку; без него она молча рисовала бы позицию
   * без размерной сетки.
   */
  detailIds: string[];

  /** Основная загрузка: только активные заказы (архив — loadArchive) */
  loadAll: () => Promise<void>;
  /** Ленивая загрузка архива (status != active) при первом заходе на вкладку — первая страница */
  loadArchive: () => Promise<void>;
  /** Следующая страница архива (кнопка «Показать ещё») */
  loadMoreArchive: () => Promise<void>;
  /** Перезагрузка одного заказа тем же вложенным select (upsert в стор) */
  loadOne: (orderId: string) => Promise<ErpOrderFull | null>;
  createOrder: (input: NewOrderInput) => Promise<ErpOrderFull | null>;
  updateOrder: (id: string, patch: Partial<ErpOrder>) => Promise<boolean>;
  /**
   * Отгрузка готового заказа: status → done_* (по сроку клиента),
   * shipped_status → shipped, shipped_at/shipped_by. Заказ уходит в архив.
   */
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
}

/** Материалы: добавление/правка, подтверждение склада, авто-закрытие закупки */
export interface MaterialsSlice {
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
}

/** Склад: числовая приёмка материалов + история складских операций (правки 2, 3) */
export interface WarehouseSlice {
  /**
   * Приёмка материала складом: сверка план/факт + статус + запись в историю склада.
   * Факт-атрибуты (правка 4.1.3) — что фактически поступило (пересорт/расхождение).
   */
  acceptMaterial: (
    materialId: string,
    opts: {
      qty_received: number | null;
      accept_status: MaterialAcceptStatus;
      accept_comment?: string | null;
      fact_name?: string | null;
      fact_color?: string | null;
      fact_article?: string | null;
    },
  ) => Promise<boolean>;
  /** Прочая складская операция (упаковка/отгрузка/маркировка) → строка erp_warehouse_ops */
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
  updateSubcontractOp: (id: string, patch: Partial<ErpSubcontractOp>) => Promise<boolean>;
}

/** Сотрудники и профили: список, привязка цеха, роли */
export interface EmployeesSlice {
  employees: ErpEmployee[];
  profilesList: StaffProfile[];
  employeesLoaded: boolean;
  /** Цех текущего пользователя (erp_employees.department_id по profile_id) */
  myDeptId: string | null;
  /** Цеховая роль текущего пользователя — вход в матрицу прав (ядро правки 11) */
  myRole: EmployeeRole | null;
  myDeptLoaded: boolean;

  /** Автопривязка цеха и цеховой роли: ищет erp_employees по profile_id пользователя */
  loadMyDept: (profileId: string | undefined) => Promise<void>;
  loadEmployees: () => Promise<void>;
  createEmployee: (emp: Partial<ErpEmployee> & { full_name: string }) => Promise<ErpEmployee | null>;
  updateEmployee: (id: string, patch: Partial<ErpEmployee>) => Promise<boolean>;
  /** Профили общие с Order Studio: те же действия, что в Админке */
  updateProfile: (id: string, patch: Partial<StaffProfile>) => Promise<boolean>;
  /** Цеховая надстройка профиля: upsert erp_employees по profile_id */
  upsertProfileDept: (
    profile: StaffProfile,
    patch: Partial<Pick<ErpEmployee, 'department_id' | 'role' | 'notes'>>,
  ) => Promise<boolean>;

  /** Справочник цехов (правки 11/12): создание участка и правка его атрибутов */
  createDepartment: (
    dept: Pick<ErpDepartment, 'code' | 'name'> & Partial<ErpDepartment>,
  ) => Promise<ErpDepartment | null>;
  /** Название, порядок, признак брендирования, активность, руководитель, норматив */
  updateDepartment: (id: string, patch: Partial<ErpDepartment>) => Promise<boolean>;
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

/** Realtime: точечное применение postgres_changes + подписка */
export interface RealtimeSlice {
  /** Точечное применение realtime-события (экспорт действия — для тестов) */
  applyRealtimeEvent: (ev: ErpRealtimeEvent) => void;
  /** Realtime: доска/очереди обновляются сами; возвращает отписку */
  subscribeRealtime: () => () => void;
}

/** Экспериментальный цех (правка 6): воронка разработки со стейт-машиной фаз */
export interface ExperimentalSlice {
  experimental: ErpExperimental[];
  experimentalLoaded: boolean;
  loadExperimental: () => Promise<void>;
  createExperimental: (orderId: string) => Promise<ErpExperimental | null>;
  updateExperimental: (id: string, patch: Partial<ErpExperimental>) => Promise<boolean>;
  createExperimentalOp: (
    experimentalId: string,
    op: Partial<ErpExperimentalOp> & Pick<ErpExperimentalOp, 'kind'>,
  ) => Promise<ErpExperimentalOp | null>;
  /** Завершить передачу (returned) → заказ авто-возвращается на фазу «Проработка» */
  completeExperimentalOp: (opId: string) => Promise<boolean>;
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
export type ErpStore = OrdersSlice &
  StagesSlice &
  MaterialsSlice &
  WarehouseSlice &
  ProcurementSlice &
  SubcontractingSlice &
  EmployeesSlice &
  PermissionsSlice &
  DictionariesSlice &
  ExperimentalSlice &
  TzSlice &
  PlanSlice &
  RealtimeSlice;
