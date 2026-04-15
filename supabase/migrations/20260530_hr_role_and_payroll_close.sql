-- =============================================
-- redesign/v2 — HR role + expand payroll-close policy
-- Migration: 20260530_hr_role_and_payroll_close.sql
-- Branch: redesign/v2
-- Session: 13 (director Q&A block)
--
-- Depends on:
--   20260501_production_foundation.sql — auth_is_admin_or_director,
--                                        auth_is_senior_foreman
--   20260504_workers.sql                — workers + RLS
--   20260505_piecework.sql              — piecework_batches, _entries + RLS
--   20260525_piecework_update_policy_fix.sql — last touched the entries
--                                               update policy
--
-- Rationale (director session 13 answers):
--   Q8:  HR role manages /workers   → new `hr` role owns workers write
--   Q11: Payroll close              → director + senior_foreman + hr
--
-- profiles.role is plain text (no CHECK enum), so introducing 'hr' is
-- additive — no schema-level constraint to alter. This migration only
-- adds/rotates RLS policies + one predicate function.
--
-- HOW TO APPLY: Dashboard SQL editor or supabase db push.
-- =============================================

-- ============ 1. auth_is_hr() predicate ============
-- Same shape as the other auth_is_* functions from 20260501:
-- STABLE SECURITY DEFINER, locked search_path, honors `active` flag.

CREATE OR REPLACE FUNCTION auth_is_hr() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'hr'
        AND COALESCE(active, true) = true
    );
  $$;

COMMENT ON FUNCTION auth_is_hr() IS
  'RLS predicate: is current user in the hr role (manages workers + payroll close).';

-- ============ 2. workers — HR can write ============
-- Rotate workers_write_admin_senior_foreman → include hr.

DROP POLICY IF EXISTS workers_write_admin_senior_foreman ON workers;

CREATE POLICY workers_write_admin_senior_foreman_hr ON workers
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr());

-- ============ 3. piecework_batches — senior_foreman + hr can close ============
-- Previously only admin/director could UPDATE batches (the INSERT policy
-- is the same FOR ALL). Director wants close delegated to senior_foreman
-- (мастера цехов) and hr.
--
-- Note: INSERT of a new batch is NOT something senior_foreman typically
-- does, but since we're using FOR ALL on the current policy we'd widen
-- insert at the same time. That's acceptable — app-layer invokes
-- ensureOpenBatch which creates at most one open batch per period, and
-- the partial unique index enforces the invariant at DB level.

DROP POLICY IF EXISTS piecework_batches_write_admin ON piecework_batches;

CREATE POLICY piecework_batches_write_admin_senior_hr ON piecework_batches
  FOR ALL
  USING (
    auth_is_admin_or_director()
    OR auth_is_senior_foreman()
    OR auth_is_hr()
  )
  WITH CHECK (
    auth_is_admin_or_director()
    OR auth_is_senior_foreman()
    OR auth_is_hr()
  );

-- ============ 4. piecework_entries — paid_at write access ============
-- Close flow is two-step in usePayrollStore.closeBatch():
--   (a) UPDATE piecework_entries SET paid_at = now() WHERE batch_id AND paid_at IS NULL
--   (b) UPDATE piecework_batches  SET status='closed' ...
-- Both need to accept the calling role. Step (a) is gated by this policy.
--
-- The trigger piecework_forbid_update_if_paid from 20260510 still blocks
-- any UPDATE where OLD.paid_at is not null — that's the immutability
-- suspenders. This policy is the belt: gate the NULL→timestamp transition
-- to finance/management roles only.
--
-- Previous policy: piecework_entries_update_admin_unpaid (from 20260525
-- fix) — admin/director only. Rotate to include senior_foreman + hr.

DROP POLICY IF EXISTS piecework_entries_update_admin_unpaid ON piecework_entries;

CREATE POLICY piecework_entries_update_admin_senior_hr_unpaid ON piecework_entries
  FOR UPDATE
  USING (
    (auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr())
    AND paid_at IS NULL
  )
  WITH CHECK (
    auth_is_admin_or_director() OR auth_is_senior_foreman() OR auth_is_hr()
  );

-- ============ 5. Verification (manual) ============
--
-- -- Predicate exists
-- SELECT proname FROM pg_proc WHERE proname = 'auth_is_hr';
--
-- -- Policies rotated
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname='public'
--   AND tablename IN ('workers','piecework_batches','piecework_entries')
-- ORDER BY tablename, policyname;
-- -- Expected names (among others):
-- --   workers_write_admin_senior_foreman_hr
-- --   piecework_batches_write_admin_senior_hr
-- --   piecework_entries_update_admin_senior_hr_unpaid
--
-- -- Simulate as an hr user (replace :uid with a real profile id first):
-- -- SET LOCAL role TO authenticated;
-- -- SET LOCAL request.jwt.claim.sub TO ':uid';
-- -- UPDATE piecework_entries SET paid_at = now()
-- --   WHERE batch_id = ':batch' AND paid_at IS NULL;
