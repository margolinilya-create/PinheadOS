-- =============================================
-- redesign/v2 — Tech Cards schema (templates + instances + operations)
-- Migration: 20260503_tech_cards.sql
-- Branch: redesign/v2
-- ADRs: 0001 (bounded contexts), 0002 (rate/minutes snapshot),
--       0005 (soft-delete convention)
--
-- Depends on:
--   20260501_production_foundation.sql — sections, auth_is_* predicates
--   20260502_seed_sections_and_ops.sql — operation_types
--   20260510_db_guards.sql               — tech_operation_order_id_consistent()
--
-- Creates the TechDesign bounded context tables (ADR-0001):
--   1. sku_tech_templates       — reusable per-SKU templates (technologist lib)
--   2. sku_tech_template_items  — template line items
--   3. order_tech_cards         — per-order instance, status machine
--   4. order_tech_operations    — line items with rate/minutes SNAPSHOT
--
-- Notes on FK boundaries:
--   * SKUs live in app_config.sku_catalog JSONB (no sku_catalog table), so
--     sku_tech_templates uses `sku_code text` not an FK. Validation happens
--     at app-layer via catalog load.
--   * orders table already exists from prod schema dump. We FK to it.
--
-- HOW TO APPLY: Dashboard SQL editor or supabase db push.
-- =============================================

-- ============ 1. sku_tech_templates ============
-- The technologist's reusable library: "every Classic T-Shirt goes through
-- these 6 operations by default." When a new order comes in with a Classic
-- T-Shirt, the wizard can clone the default template into order_tech_cards.
--
-- Multiple templates per SKU allowed (standard / express / premium), but
-- only one can be is_default=true per sku_code.

CREATE TABLE IF NOT EXISTS sku_tech_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  sku_code text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  CONSTRAINT sku_tech_templates_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT sku_tech_templates_sku_name_uniq UNIQUE (sku_code, name)
);

COMMENT ON TABLE sku_tech_templates IS
  'Reusable per-SKU tech templates. Cloned into order_tech_cards at wizard-save time. Technologist-owned. ADR-0001.';

-- Only one default template per sku_code (partial unique index so other
-- templates can coexist as non-default variants).
CREATE UNIQUE INDEX IF NOT EXISTS sku_tech_templates_default_uniq
  ON sku_tech_templates (sku_code)
  WHERE is_default = true AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS sku_tech_templates_sku_idx
  ON sku_tech_templates (sku_code)
  WHERE deleted_at IS NULL;

ALTER TABLE sku_tech_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY sku_tech_templates_read_authenticated ON sku_tech_templates
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

CREATE POLICY sku_tech_templates_write_admin_tech ON sku_tech_templates
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_technologist())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_technologist());

-- ============ 2. sku_tech_template_items ============
-- Line items of a template. Each row = "this operation, at this default
-- qty/unit, in this order." On clone, these become order_tech_operations
-- with rate/minutes SNAPSHOTTED from the current operation_types row.

CREATE TABLE IF NOT EXISTS sku_tech_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  template_id uuid NOT NULL REFERENCES sku_tech_templates(id) ON DELETE CASCADE,
  operation_type_id uuid NOT NULL REFERENCES operation_types(id),
  default_qty numeric(10, 2) NOT NULL DEFAULT 1,
  sort_order int NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sku_tech_template_items_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT sku_tech_template_items_qty_positive CHECK (default_qty > 0),
  CONSTRAINT sku_tech_template_items_template_op_uniq UNIQUE (template_id, operation_type_id)
);

COMMENT ON TABLE sku_tech_template_items IS
  'Template line items. Cloned into order_tech_operations with snapshot columns at wizard-save. ADR-0002.';

CREATE INDEX IF NOT EXISTS sku_tech_template_items_template_idx
  ON sku_tech_template_items (template_id, sort_order)
  WHERE deleted_at IS NULL;

ALTER TABLE sku_tech_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY sku_tech_template_items_read_authenticated ON sku_tech_template_items
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

CREATE POLICY sku_tech_template_items_write_admin_tech ON sku_tech_template_items
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_technologist())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_technologist());

-- ============ 3. order_tech_cards ============
-- Per-order tech card instance. State machine: draft → approved → locked.
--   - draft    : technologist editing, no snapshots, no payroll impact
--   - approved : snapshots frozen, can still edit qty (with caveat), foreman sees it
--   - locked   : first piecework entry exists → no more structural edits
--
-- status transitions enforced in app-layer (ADR-0008 domain events). DB
-- enforces the terminal property via the piecework triggers in 20260510.
--
-- One active tech card per order (partial unique): if a card gets deleted
-- (soft), a replacement can be created.

CREATE TABLE IF NOT EXISTS order_tech_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  template_id uuid REFERENCES sku_tech_templates(id),
  status text NOT NULL DEFAULT 'draft',
  approved_at timestamptz,
  approved_by uuid REFERENCES profiles(id),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  CONSTRAINT order_tech_cards_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT order_tech_cards_status_check CHECK (status IN ('draft', 'approved', 'locked')),
  CONSTRAINT order_tech_cards_approved_consistency CHECK (
    (status = 'draft' AND approved_at IS NULL AND approved_by IS NULL)
    OR (status IN ('approved', 'locked') AND approved_at IS NOT NULL AND approved_by IS NOT NULL)
  )
);

COMMENT ON TABLE order_tech_cards IS
  'Per-order tech card instance. status draft→approved→locked. Locked = first piecework entry exists. ADR-0001.';

-- One active (non-deleted) tech card per order.
CREATE UNIQUE INDEX IF NOT EXISTS order_tech_cards_order_active_uniq
  ON order_tech_cards (order_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS order_tech_cards_status_idx
  ON order_tech_cards (status)
  WHERE deleted_at IS NULL;

ALTER TABLE order_tech_cards ENABLE ROW LEVEL SECURITY;

-- Read: authenticated. Foreman/QC need read access to view routed work.
CREATE POLICY order_tech_cards_read_authenticated ON order_tech_cards
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

-- Write: admin/director or technologist. Foreman cannot create/edit cards.
CREATE POLICY order_tech_cards_write_admin_tech ON order_tech_cards
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_technologist())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_technologist());

-- ============ 4. order_tech_operations ============
-- THE ledger for production work. Each row = "this operation on this
-- order, at this snapshotted rate/minutes." Piecework entries (created
-- later in 20260505) reference this row via tech_operation_id, and
-- piecework.amount CHECK uses rate_snapshot × qty.
--
-- rate_snapshot / minutes_snapshot / name_snapshot are FROZEN at approve-
-- time. Edits to operation_types or template do not touch these rows.
-- This is the single most important invariant in v2 (ADR-0002, ADR-0007).

CREATE TABLE IF NOT EXISTS order_tech_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  tech_card_id uuid NOT NULL REFERENCES order_tech_cards(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  operation_type_id uuid NOT NULL REFERENCES operation_types(id),
  section_id uuid NOT NULL REFERENCES sections(id),
  qty numeric(10, 2) NOT NULL,
  rate_snapshot numeric(10, 2) NOT NULL,
  minutes_snapshot int NOT NULL,
  name_snapshot text NOT NULL,
  unit_snapshot text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_tech_operations_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT order_tech_operations_qty_positive CHECK (qty > 0),
  CONSTRAINT order_tech_operations_rate_nonneg CHECK (rate_snapshot >= 0),
  CONSTRAINT order_tech_operations_minutes_nonneg CHECK (minutes_snapshot >= 0),
  CONSTRAINT order_tech_operations_unit_check CHECK (unit_snapshot IN ('piece', 'meter', 'minute'))
);

COMMENT ON TABLE order_tech_operations IS
  'Per-order operation rows with FROZEN rate/minutes/name snapshots. Source of truth for piecework. ADR-0002.';

COMMENT ON COLUMN order_tech_operations.rate_snapshot IS
  'Frozen at tech-card approve time. NEVER updated. Payroll reads from here, not operation_types.';

COMMENT ON COLUMN order_tech_operations.order_id IS
  'Denormalized for index efficiency. Enforced == tech_card.order_id by trigger (20260510).';

-- Denorm consistency trigger from 20260510_db_guards.sql.
CREATE TRIGGER tech_operation_order_id_consistency
  BEFORE INSERT OR UPDATE OF order_id, tech_card_id ON order_tech_operations
  FOR EACH ROW
  EXECUTE FUNCTION tech_operation_order_id_consistent();

-- Common lookups.
CREATE INDEX IF NOT EXISTS order_tech_operations_tech_card_idx
  ON order_tech_operations (tech_card_id, sort_order)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS order_tech_operations_order_idx
  ON order_tech_operations (order_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS order_tech_operations_section_idx
  ON order_tech_operations (section_id)
  WHERE deleted_at IS NULL;

ALTER TABLE order_tech_operations ENABLE ROW LEVEL SECURITY;

-- Read: authenticated. Foreman sees ops for their section (filtered in
-- app-layer by section_id — RLS stays permissive to avoid per-op joins
-- on every page load).
CREATE POLICY order_tech_operations_read_authenticated ON order_tech_operations
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

-- Write: admin/director or technologist. Once locked (parent tech card
-- has status='locked'), app-layer blocks edits. DB-level lock happens
-- via piecework_forbid_update_if_paid on piecework_entries (20260510).
CREATE POLICY order_tech_operations_write_admin_tech ON order_tech_operations
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_technologist())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_technologist());

-- ============ 5. Verification (manual) ============
--
-- \d order_tech_operations
-- -- Expected columns: rate_snapshot, minutes_snapshot, name_snapshot, unit_snapshot
--
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'order_tech_operations';
-- -- Expected: tech_operation_order_id_consistency
--
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public' AND tablename IN (
--   'sku_tech_templates', 'sku_tech_template_items',
--   'order_tech_cards', 'order_tech_operations'
-- );
-- -- Expected: 4 rows
