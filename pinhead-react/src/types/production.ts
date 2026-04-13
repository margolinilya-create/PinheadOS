// redesign/v2 — TechDesign + Production types
// Mirrors the schema from supabase/migrations/20260501..20260503.
// ADR-0001, ADR-0002.

export type OperationUnit = 'piece' | 'meter' | 'minute';

export type TechCardStatus = 'draft' | 'approved' | 'locked';

export type ProductionSubRole =
  | 'foreman'
  | 'senior_foreman'
  | 'technologist'
  | 'procurement'
  | 'qc_operator';

export interface Section {
  id: string;
  code: string;
  name: string;
  icon: string | null;
  color: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
}

export interface OperationType {
  id: string;
  section_id: string;
  code: string;
  name: string;
  unit: OperationUnit;
  base_rate: number;
  base_minutes: number;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
}

export interface SkuTechTemplate {
  id: string;
  sku_code: string;
  name: string;
  is_default: boolean;
  deleted_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface SkuTechTemplateItem {
  id: string;
  template_id: string;
  operation_type_id: string;
  default_qty: number;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
}

export interface OrderTechCard {
  id: string;
  order_id: string;
  template_id: string | null;
  status: TechCardStatus;
  approved_at: string | null;
  approved_by: string | null;
  deleted_at: string | null;
  created_at: string;
  created_by: string | null;
}

// rate_snapshot / minutes_snapshot / name_snapshot / unit_snapshot
// are FROZEN at tech card approve. Never mutate them after status !== 'draft'.
export interface OrderTechOperation {
  id: string;
  tech_card_id: string;
  order_id: string;
  operation_type_id: string;
  section_id: string;
  qty: number;
  rate_snapshot: number;
  minutes_snapshot: number;
  name_snapshot: string;
  unit_snapshot: OperationUnit;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
}
