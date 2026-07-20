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
  | 'planned' | 'sent' | 'in_progress' | 'returned' | 'delayed' | 'cancelled';

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
};

export const SUBCONTRACT_OP_TYPE_LABELS: Record<SubcontractOpType, string> = {
  finished_product: 'Готовое изделие',
  operation: 'Отдельная операция',
};

export const SUBCONTRACT_MATERIAL_SOURCE_LABELS: Record<SubcontractMaterialSource, string> = {
  pinhead: 'Материалы Pinhead',
  contractor: 'Материалы подрядчика',
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
