/**
 * DTO/интерфейсы ERP-стора (вынесены из useErpStore.ts, рефакторинг по плану аудита).
 * Отдельный модуль — чтобы слайсы/хелперы могли ссылаться на ErpOrderFull и др.
 * без циклического импорта через useErpStore.ts. Реэкспорт — в useErpStore.ts.
 */

import type {
  BrandingMethod,
  BrandingOn,
  ErpItemPrint,
  ErpItemStage,
  ErpMaterial,
  ErpOrder,
  ErpOrderItem,
  ErpProcurementTask,
  ProcurementCauseType,
  ProductionType,
  SizeGridRow,
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
}

/**
 * Параметры возврата брака: пользователь выбирает этап устранения.
 * target: 'current' — переделка на месте; <stageId> — перенос на конкретный этап;
 * 'procurement' — материал испорчен, нужна закупка. needsMaterial — задача закупки.
 */
export interface ReportDefectOptions {
  qty: number;
  reason: string;
  target?: 'current' | 'procurement' | (string & {});
  needsMaterial?: boolean;
  cause?: ProcurementCauseType;
  supplier?: string | null;
  plannedDate?: string | null;
  materialName?: string | null;
  requiredQty?: string | null;
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
