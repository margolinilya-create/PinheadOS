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

export interface Worker {
  id: string;
  profile_id: string | null;
  full_name: string;
  section_id: string | null;
  hourly_rate: number;
  deleted_at: string | null;
  created_at: string;
}

export type PieceworkBatchStatus = 'open' | 'closed';

export interface PieceworkBatch {
  id: string;
  period_start: string;
  period_end: string;
  status: PieceworkBatchStatus;
  closed_at: string | null;
  closed_by: string | null;
  notes: string | null;
  created_at: string;
  created_by: string | null;
}

export type PieceworkEntryType =
  | 'accrual'
  | 'rework_penalty'
  | 'defect_penalty'
  | 'bonus'
  | 'manual_adjustment'
  | 'reversal_of';

// Outbox row from domain_events (ADR-0004). Read-only from the client —
// inserts happen transactionally with business rows, updates are forbidden
// by RLS (only dispatcher edge function can mark processed_at).
export interface DomainEvent {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  processed_at: string | null;
  created_at: string;
}

export interface PieceworkEntry {
  id: string;
  batch_id: string;
  worker_id: string;
  tech_operation_id: string | null;
  entry_type: PieceworkEntryType;
  qty: number;
  rate: number;
  amount: number;
  reason: string | null;
  reversal_of: string | null;
  paid_at: string | null;
  created_at: string;
  created_by: string | null;
}
