-- =============================================
-- redesign/v2 — Piecework ledger (batches + entries)
-- Migration: 20260505_piecework.sql
-- Branch: redesign/v2
-- ADRs: 0002 (rate/minutes snapshot immutability),
--       0007 (piecework parallel-run policy)
--
-- Depends on:
--   20260501_production_foundation.sql — tenant pattern, auth_is_*
--   20260503_tech_cards.sql             — order_tech_operations
--   20260504_workers.sql                — workers
--   20260510_db_guards.sql              — piecework_forbid_update_if_paid()
--
-- Creates the payroll ledger. Two tables:
--   1. piecework_batches — period buckets, open → closed. Closing the
--      batch sets paid_at on every entry inside it, freezing them.
--   2. piecework_entries — line items. After paid_at set, row is
--      immutable at DB level (trigger from 20260510).
--
-- CRITICAL: paid_at immutability is the payroll trust anchor (ADR-0002,
-- ADR-0007). Corrections take the form of NEW rows with reversal_of
-- pointing at the original, NEVER UPDATE of the paid row.
--
-- HOW TO APPLY: Dashboard SQL editor or supabase db push.
-- =============================================

-- ============ 1. piecework_batches ============
-- Period bucket (usually bi-weekly). Open while workers accumulate work,
-- closed when payroll runs. Closing a batch triggers paid_at on all
-- entries → entries become immutable.
--
-- One open batch per period is enforced by partial unique index.

CREATE TABLE IF NOT EXISTS piecework_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'open',
  closed_at timestamptz,
  closed_by uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  CONSTRAINT piecework_batches_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT piecework_batches_status_check CHECK (status IN ('open', 'closed')),
  CONSTRAINT piecework_batches_period_order CHECK (period_end >= period_start),
  CONSTRAINT piecework_batches_close_consistency CHECK (
    (status = 'open' AND closed_at IS NULL AND closed_by IS NULL)
    OR (status = 'closed' AND closed_at IS NOT NULL AND closed_by IS NOT NULL)
  )
);

COMMENT ON TABLE piecework_batches IS
  'Payroll period buckets. Closing the batch sets paid_at on every entry and freezes them permanently. ADR-0002, ADR-0007.';

-- At most one OPEN batch per period.
CREATE UNIQUE INDEX IF NOT EXISTS piecework_batches_open_period_uniq
  ON piecework_batches (period_start, period_end)
  WHERE status = 'open';

ALTER TABLE piecework_batches ENABLE ROW LEVEL SECURITY;

-- Read: authenticated. Workers need to see their own entries, payroll
-- audit needs the full list — RLS on entries (below) does fine-grained
-- filtering; batches stay permissive.
CREATE POLICY piecework_batches_read_authenticated ON piecework_batches
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Write: admin/director only. Senior foreman can propose via app-layer
-- but the actual INSERT/UPDATE is gated to finance roles.
CREATE POLICY piecework_batches_write_admin ON piecework_batches
  FOR ALL
  USING (auth_is_admin_or_director())
  WITH CHECK (auth_is_admin_or_director());

-- ============ 2. piecework_entries ============
-- The actual payroll ledger. Each row = one worker earning/losing money
-- for one specific tech operation (or bonus/penalty/adjustment).
--
-- entry_type vocabulary:
--   accrual          : positive earning tied to a tech_operation (qty × rate)
--   rework_penalty   : negative, for redoing defective work
--   defect_penalty   : negative, for damage/waste
--   bonus            : positive, free-form (reason required)
--   manual_adjustment: free-form (sign either way), requires reason
--   reversal_of      : references another entry's id; used for corrections
--                      after a batch is closed (the original row is
--                      immutable, so corrections are new rows)
--
-- amount CHECK enforces:
--   accrual → amount = rate * qty   (catches arithmetic bugs)
--   *_penalty → amount <= 0         (catches "I typed a positive penalty" typos)
--   bonus/manual/reversal → free-form (human-verified with reason)

CREATE TABLE IF NOT EXISTS piecework_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  batch_id uuid NOT NULL REFERENCES piecework_batches(id),
  worker_id uuid NOT NULL REFERENCES workers(id),
  tech_operation_id uuid REFERENCES order_tech_operations(id),
  entry_type text NOT NULL,
  qty numeric(10, 2) NOT NULL DEFAULT 0,
  rate numeric(10, 2) NOT NULL DEFAULT 0,
  amount numeric(12, 2) NOT NULL,
  reason text,
  reversal_of uuid REFERENCES piecework_entries(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES profiles(id),
  CONSTRAINT piecework_entries_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT piecework_entries_entry_type_check CHECK (entry_type IN (
    'accrual', 'rework_penalty', 'defect_penalty',
    'bonus', 'manual_adjustment', 'reversal_of'
  )),
  CONSTRAINT piecework_entries_qty_nonneg CHECK (qty >= 0),
  CONSTRAINT piecework_entries_rate_nonneg CHECK (rate >= 0),
  -- ADR-0002: accrual rows MUST satisfy amount = rate * qty. Penalty rows
  -- MUST be non-positive. Others free-form with reason.
  CONSTRAINT piecework_entries_amount_matches_rate_qty CHECK (
    CASE entry_type
      WHEN 'accrual' THEN amount = rate * qty
      WHEN 'rework_penalty' THEN amount <= 0
      WHEN 'defect_penalty' THEN amount <= 0
      ELSE true
    END
  ),
  -- Accruals must reference a tech_operation. Others may not.
  CONSTRAINT piecework_entries_accrual_has_op CHECK (
    CASE entry_type
      WHEN 'accrual' THEN tech_operation_id IS NOT NULL
      ELSE true
    END
  ),
  -- reversal_of entries must have reversal_of set; others must not.
  CONSTRAINT piecework_entries_reversal_consistency CHECK (
    (entry_type = 'reversal_of' AND reversal_of IS NOT NULL)
    OR (entry_type <> 'reversal_of' AND reversal_of IS NULL)
  ),
  -- Bonus / manual_adjustment / reversal_of / penalty rows require reason
  -- for audit trail.
  CONSTRAINT piecework_entries_reason_required CHECK (
    CASE entry_type
      WHEN 'accrual' THEN true
      ELSE reason IS NOT NULL AND length(trim(reason)) > 0
    END
  )
);

COMMENT ON TABLE piecework_entries IS
  'Payroll ledger line items. Immutable after paid_at set (trigger). Corrections = new rows with reversal_of. ADR-0002, ADR-0007.';

COMMENT ON COLUMN piecework_entries.paid_at IS
  'Set when batch closes. After this, BEFORE UPDATE trigger rejects any modification. See piecework_forbid_update_if_paid in 20260510.';

-- Bind the immutability trigger from 20260510_db_guards.sql.
CREATE TRIGGER piecework_immutable_after_pay
  BEFORE UPDATE ON piecework_entries
  FOR EACH ROW
  EXECUTE FUNCTION piecework_forbid_update_if_paid();

-- Indexes
CREATE INDEX IF NOT EXISTS piecework_entries_batch_idx
  ON piecework_entries (batch_id);

CREATE INDEX IF NOT EXISTS piecework_entries_worker_idx
  ON piecework_entries (worker_id, created_at DESC);

CREATE INDEX IF NOT EXISTS piecework_entries_tech_op_idx
  ON piecework_entries (tech_operation_id)
  WHERE tech_operation_id IS NOT NULL;

-- Unpaid entries: for reconcile against Excel during parallel-run.
CREATE INDEX IF NOT EXISTS piecework_entries_unpaid_idx
  ON piecework_entries (batch_id, worker_id)
  WHERE paid_at IS NULL;

ALTER TABLE piecework_entries ENABLE ROW LEVEL SECURITY;

-- Read: authenticated. App-layer filters by worker for the worker's own
-- view; admin/rop see everything. RLS here is permissive to avoid
-- recursive joins on payroll pages.
CREATE POLICY piecework_entries_read_authenticated ON piecework_entries
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Insert: admin/director, senior_foreman, or foreman (their own section's
-- work). App-layer enforces section scoping — DB trusts the write path
-- through approved flows.
CREATE POLICY piecework_entries_insert_production ON piecework_entries
  FOR INSERT
  WITH CHECK (
    auth_is_admin_or_director()
    OR auth_is_senior_foreman()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'production'
        AND sub_role = 'foreman'
        AND COALESCE(active, true) = true
    )
  );

-- Update: admin/director only, AND only for unpaid rows (trigger enforces
-- the paid_at check). This policy is a belt to the trigger's suspenders.
CREATE POLICY piecework_entries_update_admin_unpaid ON piecework_entries
  FOR UPDATE
  USING (auth_is_admin_or_director() AND paid_at IS NULL)
  WITH CHECK (auth_is_admin_or_director() AND paid_at IS NULL);

-- Delete: forbidden. Use reversal_of entries to correct.
CREATE POLICY piecework_entries_no_delete ON piecework_entries
  FOR DELETE
  USING (false);

-- ============ Verification (manual) ============
--
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'piecework_entries';
-- -- Expected: piecework_immutable_after_pay
--
-- -- CHECK constraints
-- SELECT conname FROM pg_constraint
-- WHERE conrelid = 'piecework_entries'::regclass AND contype = 'c';
-- -- Expected: 6+ check constraints
