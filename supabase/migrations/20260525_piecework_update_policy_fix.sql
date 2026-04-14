-- =============================================
-- redesign/v2 — Fix piecework_entries UPDATE policy WITH CHECK
-- Migration: 20260525_piecework_update_policy_fix.sql
-- Branch: redesign/v2
--
-- Bug: policy piecework_entries_update_admin_unpaid had
--   WITH CHECK (auth_is_admin_or_director() AND paid_at IS NULL)
-- This blocks the very transition it exists to allow: batch close sets
-- paid_at = NOW() on all entries, so the NEW row has paid_at NOT NULL
-- and WITH CHECK returns 403. USING correctly sees OLD.paid_at IS NULL.
--
-- Fix: WITH CHECK must NOT require paid_at IS NULL on NEW row. The
-- trigger piecework_forbid_update_if_paid (see 20260510_db_guards.sql)
-- already enforces immutability — it checks OLD.paid_at, so NULL→ts
-- transition is allowed, any subsequent UPDATE on a paid row is rejected.
-- The policy USING clause is the belt; trigger is the suspenders.
--
-- HOW TO APPLY: Dashboard SQL editor or supabase db push.
-- =============================================

DROP POLICY IF EXISTS piecework_entries_update_admin_unpaid ON piecework_entries;

CREATE POLICY piecework_entries_update_admin_unpaid ON piecework_entries
  FOR UPDATE
  USING (auth_is_admin_or_director() AND paid_at IS NULL)
  WITH CHECK (auth_is_admin_or_director());
