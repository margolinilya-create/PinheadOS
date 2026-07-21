/**
 * DTO/интерфейсы ERP-стора (вынесены из useErpStore.ts, рефакторинг по плану аудита).
 * Отдельный модуль — чтобы слайсы/хелперы могли ссылаться на ErpOrderFull и др.
 * без циклического импорта через useErpStore.ts. Реэкспорт — в useErpStore.ts.
 */

import type {
  BrandingMethod,
  BrandingOn,
  ErpDepartment,
  ErpEmployee,
  ErpItemPrint,
  ErpItemStage,
  ErpMaterial,
  ErpOrder,
  ErpOrderItem,
  ErpExperimental,
  ErpExperimentalOp,
  ErpProcurementTask,
  ErpStageEvent,
  ErpSubcontractOp,
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
}

export interface NewOrderInput {
  bitrix_id?: string;
  title: string;
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
  items: NewOrderItemInput[];
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

  /** Основная загрузка: только активные заказы (архив — loadArchive) */
  loadAll: () => Promise<void>;
  /** Ленивая загрузка архива (status != active) при первом заходе на вкладку */
  loadArchive: () => Promise<void>;
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
    extra?: { qty_done?: number; block_reason?: string | null; comment?: string },
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
  /** Обработка просрочки этапа (правка 8): комментарий причины + отметка времени */
  ackStageOverdue: (stageId: string, comment: string) => Promise<boolean>;
  /** Ручные плановые даты этапа */
  setStagePlan: (
    stageId: string,
    plan: { planned_start?: string | null; planned_end?: string | null },
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
  /** Все материалы заказа готовы → закрыть этап «Закупка» (received/reserved/not_needed) */
  maybeCloseSupply: (orderId: string) => Promise<void>;
}

/** Склад: числовая приёмка материалов + история складских операций (правки 2, 3) */
export interface WarehouseSlice {
  /** Приёмка материала складом: сверка план/факт + статус + запись в историю склада */
  acceptMaterial: (
    materialId: string,
    opts: {
      qty_received: number | null;
      accept_status: MaterialAcceptStatus;
      accept_comment?: string | null;
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
  myDeptLoaded: boolean;

  /** Автопривязка цеха: ищет erp_employees по profile_id текущего пользователя */
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

/** Полный контракт ERP-стора — пересечение доменных слайсов */
export type ErpStore = OrdersSlice &
  StagesSlice &
  MaterialsSlice &
  WarehouseSlice &
  ProcurementSlice &
  SubcontractingSlice &
  EmployeesSlice &
  ExperimentalSlice &
  RealtimeSlice;
