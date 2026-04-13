-- =============================================
-- redesign/v2 — Workers (production employees)
-- Migration: 20260504_workers.sql
-- Branch: redesign/v2
-- ADRs: 0001 (bounded contexts), 0005 (soft-delete convention)
--
-- Depends on:
--   20260501_production_foundation.sql — sections, profiles.sub_role,
--                                        auth_is_* predicates
--
-- Separate table from profiles because:
--   1. Some piecework workers (сезонные) don't have auth accounts — they
--      appear in the production schedule but never log in.
--   2. profile_id is the OPTIONAL link: when a worker also has a login
--      (foreman, technologist), profile_id references their auth row.
--   3. Payroll needs to survive profile soft-deletion: if a foreman is
--      disabled in auth, their historical piecework records must still
--      point at a concrete worker row.
--
-- HOW TO APPLY: Dashboard SQL editor or supabase db push.
-- =============================================

CREATE TABLE IF NOT EXISTS workers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  profile_id uuid REFERENCES profiles(id),
  full_name text NOT NULL,
  section_id uuid REFERENCES sections(id),
  hourly_rate numeric(10, 2) NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workers_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT workers_hourly_rate_nonneg CHECK (hourly_rate >= 0)
);

COMMENT ON TABLE workers IS
  'Production employees (with or without auth). profile_id is optional — seasonal piecework workers have no login. ADR-0001.';

COMMENT ON COLUMN workers.profile_id IS
  'Optional link to auth profile. NULL for workers without login. NOT unique because a profile historically may be linked to one active worker.';

COMMENT ON COLUMN workers.hourly_rate IS
  'Hourly rate for non-piecework time (standby, training, etc). Piecework uses rate_snapshot from order_tech_operations.';

-- Only one active (non-deleted) worker per profile_id, if linked.
-- Allows re-hire flow: old worker row soft-deleted, new row created.
CREATE UNIQUE INDEX IF NOT EXISTS workers_profile_active_uniq
  ON workers (profile_id)
  WHERE profile_id IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS workers_section_idx
  ON workers (section_id)
  WHERE deleted_at IS NULL;

ALTER TABLE workers ENABLE ROW LEVEL SECURITY;

-- Read: authenticated. Foreman needs to see workers in their section
-- (app-filtered), payroll audit needs the full list.
CREATE POLICY workers_read_authenticated ON workers
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

-- Write: admin/director or senior_foreman. Regular foreman cannot
-- create/edit worker records (HR responsibility).
CREATE POLICY workers_write_admin_senior_foreman ON workers
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_senior_foreman())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_senior_foreman());

-- ============ Verification (manual) ============
--
-- \d workers
-- -- Expected: profile_id, section_id, hourly_rate, deleted_at columns
--
-- SELECT tablename FROM pg_tables
-- WHERE schemaname = 'public' AND tablename = 'workers';
-- -- Expected: 1 row
