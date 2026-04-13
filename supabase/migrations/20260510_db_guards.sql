-- =============================================
-- redesign/v2 — DB-level Invariant Guards (reusable functions)
-- Migration: 20260510_db_guards.sql
-- Branch: redesign/v2
-- ADRs: 0002 (rate snapshot immutability), 0004 (domain events)
--
-- Defines TRIGGER FUNCTIONS only. The actual triggers bind to tables
-- created in later migrations (20260504_tech_operations.sql,
-- 20260505_workers_piecework.sql) — the trigger CREATE TRIGGER statements
-- live inside those migrations so the declarations stay next to the
-- table definitions.
--
-- Functions defined here:
--   1. piecework_forbid_update_if_paid — rejects UPDATE on paid piecework
--      rows (ADR-0002, ADR-0007 payroll trust)
--   2. tech_operation_order_id_consistent — enforces that
--      order_tech_operations.order_id denorm matches parent tech_card's
--      order_id
--   3. piecework_amount_matches_rate_qty — check-constraint-style validator
--      called from trigger (deferred to migration that creates the table,
--      this is just the function declaration)
--
-- These functions are bus-factor mitigations: the invariants they enforce
-- are documented in prose throughout the codebase, but prose doesn't run.
-- DB-level enforcement means a junior dev (or myself on a tired day)
-- cannot accidentally break payroll correctness.
-- =============================================

-- ============ 1. piecework_forbid_update_if_paid ============
-- After batch closure (piecework_batches.status = 'closed'), the
-- piecework_entries.paid_at column is set. From that point on, the row
-- is LEGALLY immutable — it represents a paycheck that has been issued.
-- Corrections take the form of NEW rows with reversal_of pointing back.
--
-- Applied via BEFORE UPDATE trigger on piecework_entries (trigger created
-- in migration 20260505_workers_piecework.sql).

CREATE OR REPLACE FUNCTION piecework_forbid_update_if_paid()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.paid_at IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'piecework_entries row is immutable after paid_at is set',
      HINT = 'Create a new row with entry_type=''manual_adjustment'' and reversal_of referencing the original. See ADR-0002.';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION piecework_forbid_update_if_paid() IS
  'Trigger function: rejects UPDATE on piecework_entries rows where paid_at IS NOT NULL. Enforces payroll immutability. ADR-0002, ADR-0007.';

-- ============ 2. tech_operation_order_id_consistent ============
-- order_tech_operations.order_id is a denormalized column (duplicated
-- from order_tech_cards.order_id via the tech_card_id FK) for index
-- efficiency. Without a trigger, app-level bugs could create drift
-- between operation.order_id and operation → tech_card → order_id.
--
-- Applied via BEFORE INSERT OR UPDATE trigger on order_tech_operations
-- (trigger created in migration 20260504_tech_operations.sql).

CREATE OR REPLACE FUNCTION tech_operation_order_id_consistent()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  parent_order_id uuid;
BEGIN
  SELECT order_id INTO parent_order_id
  FROM order_tech_cards
  WHERE id = NEW.tech_card_id;

  IF parent_order_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'foreign_key_violation',
      MESSAGE = 'order_tech_operations.tech_card_id does not reference any order_tech_cards row',
      HINT = 'Ensure the tech_card exists before creating operations.';
  END IF;

  IF NEW.order_id IS DISTINCT FROM parent_order_id THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = format(
        'order_tech_operations.order_id (%s) must match parent tech_card.order_id (%s)',
        NEW.order_id, parent_order_id
      ),
      HINT = 'Do not set order_id manually — let the trigger enforce it. Consider removing the column from the INSERT/UPDATE statement.';
  END IF;

  RETURN NEW;
END
$$;

COMMENT ON FUNCTION tech_operation_order_id_consistent() IS
  'Trigger function: enforces order_tech_operations.order_id == (SELECT order_id FROM order_tech_cards WHERE id = tech_card_id). Bus-factor mitigation.';

-- ============ 3. Note on CHECK constraint for piecework_entries.amount ============
-- The amount_matches_rate_qty CHECK (dependent on entry_type) is declared
-- inline in migration 20260505_workers_piecework.sql when the table is
-- created, because PostgreSQL CHECK constraints must be defined with the
-- table. It's documented here for traceability:
--
-- CONSTRAINT amount_matches_rate_qty CHECK (
--   CASE entry_type
--     WHEN 'accrual' THEN amount = rate * qty
--     WHEN 'rework_penalty' THEN amount <= 0
--     WHEN 'defect_penalty' THEN amount <= 0
--     ELSE true  -- bonus | manual_adjustment | reversal_of are free-form
--   END
-- )
--
-- Rationale: amount is the source of truth for payroll totals (it's what
-- gets summed and paid). Forcing accrual rows to satisfy amount = rate*qty
-- catches arithmetic bugs before they reach the bookkeeper's Excel reconcile.
-- Penalty rows are forced non-positive so a typo can't pay out a penalty.
-- Bonus/manual/reversal rows are free-form because they're human-entered
-- with a mandatory reason field.

-- ============ END ============
--
-- Verification after 20260504 + 20260505 migrations apply:
--
-- -- Functions exist
-- SELECT proname FROM pg_proc WHERE proname IN (
--   'piecework_forbid_update_if_paid',
--   'tech_operation_order_id_consistent'
-- );
--
-- -- Triggers bound (after 20260504, 20260505 applied)
-- SELECT trigger_name, event_object_table
-- FROM information_schema.triggers
-- WHERE trigger_name IN (
--   'piecework_immutable_after_pay',
--   'tech_operation_order_id_consistency'
-- );
