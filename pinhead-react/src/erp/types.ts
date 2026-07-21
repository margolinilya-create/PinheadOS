/**
 * Типы ERP — зеркало схемы erp_* в Supabase
 * (supabase/migrations/20260716140000_erp_phase1_core_schema.sql).
 *
 * Модель: заказ → позиции (изделие × вариант) → этапы (позиция × цех).
 * Статус ready вычисляется из depends_on + материалов, см. docs/erp/spreadsheet-analysis.md.
 */

// --- Справочники значений ---------------------------------------------------

export type ErpOrderStatus =
  | 'active'
  | 'done_on_time'
  | 'done_late'
  | 'done_early'
  | 'cancelled';

export type ErpShippedStatus = 'not_shipped' | 'partial' | 'shipped';

/** Тип производства позиции (лист «Маршруты») */
export type ProductionType =
  | 'no_product'     // Без изделий (только нанесение на давальческое)
  | 'ready_garment'  // Готовое изделие (закупаем готовое)
  | 'cut'            // Крой (продаём крой)
  | 'sewing'         // Пошив (полный цикл)
  | 'samples'        // Образцы
  | 'outsource';     // Подряд

export type BrandingMethod =
  | 'embroidery'     // Вышивка
  | 'silkscreen'     // Шелкография
  | 'dtf'            // ДТФ
  | 'heat_transfer'  // Термоперенос
  | 'other';         // Прочие (пришив нашивок и т.п.)

/** Нанесение на крое (до пошива) или на готовом изделии */
export type BrandingOn = 'cut' | 'finished';

export type StageStatus =
  | 'waiting'      // ждёт зависимости (крой/нанесение/пошив/материалы)
  | 'ready'        // готов к работе — можно ставить в календарь
  | 'in_progress'  // в работе
  | 'done'         // завершён
  | 'skipped'      // не нужен для этой позиции
  | 'blocked';     // ручная блокировка цехом (block_reason)

export type MaterialKind = 'fabric' | 'hardware' | 'labels' | 'packaging' | 'other';
export type MaterialSource = 'purchase' | 'stock' | 'client' | 'none';
export type MaterialStatus =
  | 'pending' | 'ordered' | 'in_transit' | 'received' | 'partial' | 'not_needed' | 'reserved';
/** Статус приёмки складом (правка 3): результат сверки план/факт */
export type MaterialAcceptStatus =
  | 'accepted_full' | 'accepted_partial' | 'shortage' | 'mismatch' | 'rejected';
/** Тип складской операции (правка 2): история сопровождения заказа складом */
export type WarehouseOpType =
  | 'material_receipt' | 'rework_receipt' | 'partial_receipt' | 'packaging' | 'shipment' | 'marking';

/** Тип задачи склада (волна 4): заказ проходит склад несколько раз */
export type WarehouseTaskType = 'material_receipt' | 'marking' | 'pack_ship';
/** Статусы задач склада по типам */
export type MaterialReceiptStatus = 'awaiting' | 'accepted';
export type MarkingStatus = 'new' | 'in_progress' | 'issued';
export type PackShipStatus =
  | 'awaiting_receipt' | 'accepted' | 'packing' | 'packed' | 'ready_to_ship' | 'shipped';
export type WarehouseTaskStatus = MaterialReceiptStatus | MarkingStatus | PackShipStatus;

export type SlotStatus = 'planned' | 'confirmed' | 'done' | 'moved' | 'cancelled';

// --- Строки таблиц ----------------------------------------------------------

export interface ErpDepartment {
  id: string;
  code: string;
  name: string;
  type: string;
  sort_order: number;
  is_branding: boolean;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ErpOrder {
  id: string;
  bitrix_id: string | null;
  title: string;
  manager: string | null;
  launch_date: string | null;
  due_date: string | null;
  buffer_days: number;
  priority: number;
  status: ErpOrderStatus;
  shipped_status: ErpShippedStatus;
  delivered_at: string | null;
  /** Отгрузка (кнопка «Отгрузить»): когда и кто (uuid профиля; dev-режим — null) */
  shipped_at?: string | null;
  shipped_by?: string | null;
  notes: string | null;
  packaging?: PackagingType;
  packaging_note?: string | null;
  stickers?: StickersType;
  stickers_note?: string | null;
  no_chestny_znak?: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ErpOrderItem {
  id: string;
  order_id: string;
  product_type: string;
  variant: string | null;
  qty: number;
  production_type: ProductionType;
  branding_methods: BrandingMethod[];
  branding_on: BrandingOn | null;
  notes: string | null;
  size_grid?: SizeGridRow[] | null;
  sort_order: number;
  /** Подряд (волна 4.2): выбирается при создании заказа с типом «Подряд» */
  subcontract_kind?: SubcontractOpType | null;
  material_source?: SubcontractMaterialSource | null;
  created_at: string;
  updated_at: string;
}

export interface ErpItemStage {
  id: string;
  item_id: string;
  department_id: string;
  depends_on: string[];
  status: StageStatus;
  qty_done: number;
  qty_rework: number;
  planned_start: string | null;
  planned_end: string | null;
  started_at: string | null;
  finished_at: string | null;
  assignee: string | null;
  block_reason: string | null;
  notes: string | null;
  sort_order: number;
  // Обработка просрочки (правка 8): комментарий причины задержки + время подтверждения
  overdue_comment?: string | null;
  overdue_ack_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ErpMaterial {
  id: string;
  order_id: string;
  item_id: string | null;
  kind: MaterialKind;
  name: string;
  source: MaterialSource;
  supplier: string | null;
  qty: string | null;
  status: MaterialStatus;
  eta_date: string | null;
  received_at: string | null;
  notes: string | null;
  // Приёмка складом (правка 3)
  qty_expected: number | null;
  qty_received: number | null;
  accept_status: MaterialAcceptStatus | null;
  accepted_at: string | null;
  accepted_by: string | null;
  accept_comment: string | null;
  created_at: string;
  updated_at: string;
}

/** Складская операция (правка 2): строка истории сопровождения заказа складом */
export interface ErpWarehouseOp {
  id: string;
  order_id: string;
  material_id: string | null;
  op_type: WarehouseOpType;
  qty: number | null;
  note: string | null;
  actor: string | null;
  created_at: string;
}

/** Задача склада (волна 4): приёмка материалов / выпуск маркировки / упаковка и отгрузка */
export interface ErpWarehouseTask {
  id: string;
  order_id: string;
  item_id: string | null;
  task_type: WarehouseTaskType;
  status: WarehouseTaskStatus;
  marking_type: string | null;
  deadline: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

// --- Задачи закупки (возврат из закроя → дозакупка/замена) -------------------

export type ProcurementCauseType =
  | 'supplier_defect'         // брак поставщика
  | 'wrong_consumption'       // неверно рассчитанный расход
  | 'damaged_in_production'   // материал испорчен на производстве
  | 'shortage'                // нехватка материала
  | 'other';                  // прочая причина

/** replacement = возврат/замена (брак поставщика); restock = дозакупка (внутренняя ошибка) */
export type ProcurementTaskKind = 'replacement' | 'restock';

export type ProcurementTaskStatus =
  | 'new' | 'in_progress' | 'ordered' | 'done' | 'cancelled';

export interface ErpProcurementTask {
  id: string;
  order_id: string;
  item_id: string | null;
  source_stage_id: string | null;
  initiating_dept: string | null;
  material_name: string;
  rework_qty: number | null;
  required_qty: string | null;
  cause_type: ProcurementCauseType;
  kind: ProcurementTaskKind;
  reason: string | null;
  supplier: string | null;
  planned_date: string | null;
  responsible: string | null;
  status: ProcurementTaskStatus;
  counts_as_purchase: boolean;
  created_at: string;
  updated_at: string;
}

// --- Подряд (операции, переданные внешним подрядчикам) -----------------------

export type SubcontractStatus =
  // отдельная операция
  | 'planned' | 'sent' | 'in_progress' | 'returned' | 'delayed' | 'cancelled'
  // готовое изделие от подрядчика (волна 4.2)
  | 'awaiting_payment' | 'awaiting_materials' | 'started'
  | 'ready_to_ship' | 'shipped_by_contractor' | 'received_at_pinhead';

/** Жизненный цикл статусов «готового изделия» от подрядчика (для стейт-машины) */
export const SUBCONTRACT_FINISHED_FLOW: SubcontractStatus[] = [
  'awaiting_payment', 'awaiting_materials', 'started',
  'ready_to_ship', 'shipped_by_contractor', 'received_at_pinhead',
];

/** Тип операции подряда: готовое изделие целиком или отдельная тех. операция */
export type SubcontractOpType = 'finished_product' | 'operation';
/** Кто предоставляет материалы: Pinhead (проходит закупку) или подрядчик (не проходит) */
export type SubcontractMaterialSource = 'pinhead' | 'contractor';

export interface ErpSubcontractOp {
  id: string;
  order_id: string;
  item_id: string | null;
  operation: string;
  op_type: SubcontractOpType;
  material_source: SubcontractMaterialSource;
  /** Цех возврата после «отдельной операции» (null для готового изделия) */
  return_dept: string | null;
  contractor: string | null;
  qty: number | null;
  sent_date: string | null;
  planned_date: string | null;
  returned_date: string | null;
  status: SubcontractStatus;
  delay_comment: string | null;
  created_at: string;
  updated_at: string;
  /** Присоединяется при загрузке (заголовок/№ заказа для таблицы) */
  order?: { title: string; bitrix_id: string | null } | null;
}

// --- Экспериментальный цех (правка 6) --------------------------------------

export type ExperimentalPhase =
  | 'patterns' | 'development' | 'final_fitting' | 'returned_to_constructor' | 'done';
export type ExperimentalOutcome =
  | 'approved' | 'needs_rework' | 'needs_rebranding' | 'needs_pattern_change' | 'ready_for_serial';
export type ExperimentalOpKind = 'to_sewing' | 'to_branding';
export type ExperimentalOpStatus = 'sent' | 'in_progress' | 'returned' | 'cancelled';

export interface ErpExperimentalOp {
  id: string;
  experimental_id: string;
  kind: ExperimentalOpKind;
  operation: string | null;
  qty: number | null;
  responsible: string | null;
  planned_date: string | null;
  comment: string | null;
  status: ExperimentalOpStatus;
  returned_at: string | null;
  branding_method: string | null;
  mockup: string | null;
  zone: string | null;
  size_mm: string | null;
  colors: string | null;
  created_at: string;
}

export interface ErpExperimental {
  id: string;
  order_id: string;
  phase: ExperimentalPhase;
  tech_name: string | null;
  measurement_table: string | null;
  has_3d: boolean;
  constructor: string | null;
  technologist: string | null;
  final_outcome: ExperimentalOutcome | null;
  constructor_return_comment: string | null;
  created_at: string;
  updated_at: string;
  /** Присоединяются при загрузке */
  ops?: ErpExperimentalOp[];
  order?: { title: string; bitrix_id: string | null } | null;
}

export interface ErpCalendarSlot {
  id: string;
  department_id: string;
  stage_id: string | null;
  work_date: string;
  qty_planned: number;
  qty_done: number | null;
  assignee: string | null;
  status: SlotStatus;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

// --- Подписи для UI (язык интерфейса — русский) ------------------------------

export const PRODUCTION_TYPE_LABELS: Record<ProductionType, string> = {
  no_product: 'Без изделий',
  ready_garment: 'Готовое изделие',
  cut: 'Крой',
  sewing: 'Пошив',
  samples: 'Образцы',
  outsource: 'Подряд',
};

export const BRANDING_METHOD_LABELS: Record<BrandingMethod, string> = {
  embroidery: 'Вышивка',
  silkscreen: 'Шелкография',
  dtf: 'ДТФ',
  heat_transfer: 'Термоперенос',
  other: 'Прочие',
};

export const STAGE_STATUS_LABELS: Record<StageStatus, string> = {
  waiting: 'Ожидает',
  ready: 'Готов к работе',
  in_progress: 'В работе',
  done: 'Готово',
  skipped: 'Пропущен',
  blocked: 'Заблокирован',
};

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  pending: 'Не заказано',
  ordered: 'Заказано',
  in_transit: 'В пути',
  received: 'Пришло',
  partial: 'Частично',
  not_needed: 'Не требуется',
  reserved: 'Доступен со склада',
};

export const MATERIAL_ACCEPT_LABELS: Record<MaterialAcceptStatus, string> = {
  accepted_full: 'Принято полностью',
  accepted_partial: 'Принято частично',
  shortage: 'Недостача',
  mismatch: 'Пересорт',
  rejected: 'Не принято',
};

export const WAREHOUSE_OP_LABELS: Record<WarehouseOpType, string> = {
  material_receipt: 'Приёмка материалов',
  rework_receipt: 'Приёмка после дозакупки',
  partial_receipt: 'Частичная приёмка',
  packaging: 'Упаковка',
  shipment: 'Отгрузка',
  marking: 'Выпуск маркировки',
};

export const WAREHOUSE_TASK_TYPE_LABELS: Record<WarehouseTaskType, string> = {
  material_receipt: 'Приёмка материалов',
  marking: 'Выпуск маркировки',
  pack_ship: 'Упаковка и отгрузка',
};

export const MARKING_STATUS_LABELS: Record<MarkingStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  issued: 'Маркировка выпущена',
};

export const PACK_SHIP_STATUS_LABELS: Record<PackShipStatus, string> = {
  awaiting_receipt: 'Ожидает приёмки',
  accepted: 'Принято',
  packing: 'На упаковке',
  packed: 'Упаковано',
  ready_to_ship: 'Готово к отгрузке',
  shipped: 'Отгружено',
};

export const PROCUREMENT_CAUSE_LABELS: Record<ProcurementCauseType, string> = {
  supplier_defect: 'Брак поставщика',
  wrong_consumption: 'Неверно рассчитанный расход',
  damaged_in_production: 'Материал испорчен на производстве',
  shortage: 'Нехватка материала',
  other: 'Прочая причина',
};

export const PROCUREMENT_STATUS_LABELS: Record<ProcurementTaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  ordered: 'Заказано',
  done: 'Выполнено',
  cancelled: 'Отменена',
};

export const PROCUREMENT_KIND_LABELS: Record<ProcurementTaskKind, string> = {
  replacement: 'Возврат/замена',
  restock: 'Дозакупка',
};

export const SUBCONTRACT_STATUS_LABELS: Record<SubcontractStatus, string> = {
  planned: 'Запланировано',
  sent: 'Передано',
  in_progress: 'В работе',
  returned: 'Возвращено',
  delayed: 'Задержка',
  cancelled: 'Отменено',
  // готовое изделие от подрядчика (волна 4.2)
  awaiting_payment: 'Ожидает оплаты',
  awaiting_materials: 'Ожидает материалов',
  started: 'Начал работу',
  ready_to_ship: 'Готово к отгрузке',
  shipped_by_contractor: 'Отгружено подрядчиком',
  received_at_pinhead: 'Поступило на производство',
};

export const SUBCONTRACT_OP_TYPE_LABELS: Record<SubcontractOpType, string> = {
  finished_product: 'Готовое изделие',
  operation: 'Отдельная операция',
};

export const SUBCONTRACT_MATERIAL_SOURCE_LABELS: Record<SubcontractMaterialSource, string> = {
  pinhead: 'Материалы Pinhead',
  contractor: 'Материалы подрядчика',
};

export const EXPERIMENTAL_PHASE_LABELS: Record<ExperimentalPhase, string> = {
  patterns: 'Построение лекал',
  development: 'Проработка',
  final_fitting: 'Финальная примерка',
  returned_to_constructor: 'Возврат конструктору',
  done: 'Готов к серии',
};

export const EXPERIMENTAL_OUTCOME_LABELS: Record<ExperimentalOutcome, string> = {
  approved: 'Образец утверждён',
  needs_rework: 'Нужна доработка',
  needs_rebranding: 'Повторное нанесение',
  needs_pattern_change: 'Изменение лекал',
  ready_for_serial: 'Готов к серийному производству',
};

export const EXPERIMENTAL_OP_KIND_LABELS: Record<ExperimentalOpKind, string> = {
  to_sewing: 'В общий швейный цех',
  to_branding: 'На нанесение',
};

export const EXPERIMENTAL_OP_STATUS_LABELS: Record<ExperimentalOpStatus, string> = {
  sent: 'Передано',
  in_progress: 'В работе',
  returned: 'Возвращено',
  cancelled: 'Отменено',
};

export const ORDER_STATUS_LABELS: Record<ErpOrderStatus, string> = {
  active: 'В работе',
  done_on_time: 'Сдан вовремя',
  done_late: 'Сдан с опозданием',
  done_early: 'Сдан заранее',
  cancelled: 'Отменён',
};

export const SHIPPED_STATUS_LABELS: Record<ErpShippedStatus, string> = {
  not_shipped: 'Не отгружено',
  partial: 'Отгружено частично',
  shipped: 'Отгружено',
};

// --- Сотрудники и аудит (блок улучшений) -------------------------------------

export type EmployeeRole =
  | 'worker' | 'foreman' | 'dispatcher' | 'purchaser'
  | 'storekeeper' | 'hr' | 'manager' | 'director';

export interface ErpEmployee {
  id: string;
  full_name: string;
  role: EmployeeRole;
  department_id: string | null;
  extra_department_ids: string[];
  profile_id: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ErpStageEvent {
  id: string;
  stage_id: string;
  order_id: string;
  actor: string | null;
  from_status: string | null;
  to_status: string;
  qty_done: number | null;
  qty_rework: number | null;
  comment: string | null;
  created_at: string;
}

export const EMPLOYEE_ROLE_LABELS: Record<EmployeeRole, string> = {
  worker: 'Сотрудник цеха',
  foreman: 'Бригадир',
  dispatcher: 'Диспетчер',
  purchaser: 'Закупщик',
  storekeeper: 'Кладовщик',
  hr: 'HR',
  manager: 'Менеджер',
  director: 'Директор',
};

// --- Поля ТЗ (docs/erp/tz-format-analysis.md) --------------------------------

export type PackagingType = 'none' | 'bopp' | 'zip' | 'other';
export type StickersType = 'none' | 'blank' | 'other';

export const PACKAGING_LABELS: Record<PackagingType, string> = {
  none: 'Нет',
  bopp: 'БОПП-пакет',
  zip: 'ZIP-пакет',
  other: 'Другое',
};

export const STICKERS_LABELS: Record<StickersType, string> = {
  none: 'Нет',
  blank: 'Бланк',
  other: 'Другое',
};

/** Размерная сетка позиции: цвет × размер → шт */
export interface SizeGridRow {
  color: string;
  sizes: Record<string, number>;
}

/** Нанесение с параметрами (страницы «Нанесение №N» ТЗ) */
export interface ErpItemPrint {
  id: string;
  item_id: string;
  seq: number;
  method: BrandingMethod;
  fabric: string | null;
  zone: string | null;
  width_mm: number | null;
  height_mm: number | null;
  offset_note: string | null;
  pantone: string | null;
  special: string | null;
  comment: string | null;
  created_at: string;
}

export type MaterialRole =
  | 'main' | 'trim' | 'lining' | 'hardware' | 'labels' | 'packaging' | 'other';

export const MATERIAL_ROLE_LABELS: Record<MaterialRole, string> = {
  main: 'Основное полотно',
  trim: 'Отделочное',
  lining: 'Подклад',
  hardware: 'Фурнитура',
  labels: 'Бирки/этикетки',
  packaging: 'Упаковка',
  other: 'Прочее',
};
