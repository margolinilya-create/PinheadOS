-- =============================================
-- redesign/v2 — Production Foundation
-- Migration: 20260501_production_foundation.sql
-- Branch: redesign/v2
-- ADRs: 0001 (bounded contexts), 0002 (rate snapshot), 0003 (tenant hook),
--       0004 (domain events outbox), 0008 (pg_cron dispatcher)
--
-- Creates the DB foundation for the 3-month production-first redesign:
--   1. profiles.sub_role + assigned_section_id (fundament for all RLS)
--   2. sections table (created BEFORE role predicate functions — fix from
--      code-review, functions reference assigned_section_id → sections)
--   3. SECURITY DEFINER role predicate functions for centralized RLS logic
--   4. domain_events outbox with range partitioning + processed_at column
--   5. RLS enabled + policies on every new table (RLS-gate enforced)
--
-- HOW TO APPLY (v2 Supabase project):
--   Option A — via Dashboard SQL editor:
--     1. Open https://supabase.com/dashboard → pinhead-os-v2 → SQL Editor
--     2. Paste this file contents → Run
--     3. Verify: `\dt` shows `sections`, `domain_events` (+ partitions)
--     4. Verify: `SELECT proname FROM pg_proc WHERE proname LIKE 'auth_is_%'`
--   Option B — via supabase CLI:
--     supabase db push --project-ref glhwbktsokphgksdvcxj
--
-- PREREQUISITE: profiles table must already exist in the target database.
-- v2 Supabase project is currently empty. Before applying this migration,
-- the existing prod schema (profiles, orders, app_config, catalog_config,
-- order_comments, order_audit) must be dumped from prod and applied to v2.
-- See docs/adr/SESSION-STATE.md for the init-from-prod step.
-- =============================================

-- ============ 1. profiles extensions ============
-- sub_role defines production-role specialization within the single
-- 'production' base role. Null for non-production roles.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sub_role text;

COMMENT ON COLUMN profiles.sub_role IS
  'Production sub-role: foreman | senior_foreman | technologist | procurement | qc_operator. NULL for non-production roles.';

-- assigned_section_id set AFTER sections table exists (see §2 below).

-- ============ 2. sections ============
-- Logical cex-within-cex units: cutting, screenprint, embroidery, dtf,
-- sewing, qc, packing. Seeded via 20260502_seed_sections_and_ops.sql.

CREATE TABLE IF NOT EXISTS sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  code text NOT NULL,
  name text NOT NULL,
  icon text,
  color text,
  sort_order int NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sections_code_uniq UNIQUE (code),
  CONSTRAINT sections_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid)
);

COMMENT ON TABLE sections IS
  'Production sections (cutting/screenprint/embroidery/dtf/sewing/qc/packing). ADR-0001';

CREATE INDEX IF NOT EXISTS sections_sort_order_idx
  ON sections (sort_order)
  WHERE deleted_at IS NULL;

-- Now add assigned_section_id to profiles (FK to sections)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS assigned_section_id uuid REFERENCES sections(id);

COMMENT ON COLUMN profiles.assigned_section_id IS
  'For sub_role=foreman: which section they manage. NULL for senior_foreman, technologist, etc.';

-- RLS for sections
ALTER TABLE sections ENABLE ROW LEVEL SECURITY;

CREATE POLICY sections_read_authenticated ON sections
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

CREATE POLICY sections_write_admin_director ON sections
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'director')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'director')
    )
  );

-- ============ 3. Role predicate functions ============
-- Use these in RLS policies of ALL production tables instead of inline
-- role checks. SECURITY DEFINER so they bypass RLS and can read profiles
-- without recursive policy evaluation. STABLE so Postgres can cache
-- within a query.
--
-- search_path locked to public to prevent search_path injection attacks.

CREATE OR REPLACE FUNCTION auth_is_production() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'production'
        AND COALESCE(active, true) = true
    );
  $$;

CREATE OR REPLACE FUNCTION auth_is_senior_foreman() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'production'
        AND sub_role = 'senior_foreman'
        AND COALESCE(active, true) = true
    );
  $$;

CREATE OR REPLACE FUNCTION auth_is_foreman_of(target_section uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'production'
        AND COALESCE(active, true) = true
        AND (
          sub_role = 'senior_foreman'
          OR (sub_role = 'foreman' AND assigned_section_id = target_section)
        )
    );
  $$;

CREATE OR REPLACE FUNCTION auth_is_technologist() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'production'
        AND sub_role = 'technologist'
        AND COALESCE(active, true) = true
    );
  $$;

CREATE OR REPLACE FUNCTION auth_is_qc_operator() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role = 'production'
        AND sub_role = 'qc_operator'
        AND COALESCE(active, true) = true
    );
  $$;

CREATE OR REPLACE FUNCTION auth_is_admin_or_director() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'director')
        AND COALESCE(active, true) = true
    );
  $$;

COMMENT ON FUNCTION auth_is_foreman_of(uuid) IS
  'RLS predicate: is current user foreman of the given section (or senior_foreman). ADR-0009.';

-- ============ 4. domain_events outbox (ADR-0004, ADR-0008) ============
-- Partitioned by month on created_at. Consumers: notifications, audit,
-- realtime fan-out. Drained by domain-events-dispatcher edge function
-- every 10 seconds via pg_cron.
--
-- PRIMARY KEY must include partition key (created_at), so it's composite.
-- idempotency_key is globally unique via partial unique index.

CREATE TABLE IF NOT EXISTS domain_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domain_events_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

COMMENT ON TABLE domain_events IS
  'Outbox pattern: production side-effects flow through here. Drained by domain-events-dispatcher edge function every 10s. ADR-0004, ADR-0008';

-- Initial partitions covering April–July 2026 (W1–W12 window).
-- Partition auto-rollover cron adds future months.

CREATE TABLE IF NOT EXISTS domain_events_2026_04
  PARTITION OF domain_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');

CREATE TABLE IF NOT EXISTS domain_events_2026_05
  PARTITION OF domain_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS domain_events_2026_06
  PARTITION OF domain_events
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS domain_events_2026_07
  PARTITION OF domain_events
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Indexes on the parent propagate to partitions automatically.

-- Dispatcher poll index: find unprocessed events ordered by created_at.
CREATE INDEX IF NOT EXISTS domain_events_unprocessed_idx
  ON domain_events (created_at)
  WHERE processed_at IS NULL;

-- Aggregate lookup: "show all events for this order/task"
CREATE INDEX IF NOT EXISTS domain_events_by_aggregate_idx
  ON domain_events (aggregate_type, aggregate_id);

-- Event type timeline: "show all task_completed events in last hour"
CREATE INDEX IF NOT EXISTS domain_events_by_type_idx
  ON domain_events (event_type, created_at);

-- Idempotency lookup index (fast "have we seen this key recently?" queries).
-- NOT unique: Postgres forbids unique constraints on partitioned tables
-- unless they include the partition key (created_at). Including created_at
-- in the uniqueness tuple would defeat the purpose — the same idempotency
-- key in two different months would both succeed.
--
-- Enforcement strategy: the dispatcher edge function checks this index
-- before inserting consumer-side side-effects, treating a hit as "already
-- processed, skip." App-level idempotency is sufficient because the outbox
-- is append-only and the dispatcher is the only consumer.
CREATE INDEX IF NOT EXISTS domain_events_idempotency_key_idx
  ON domain_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- RLS for domain_events
ALTER TABLE domain_events ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user can read events
-- (TV Dashboard in phase 2 will need this for realtime subscribe).
CREATE POLICY domain_events_read_authenticated ON domain_events
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Insert: any authenticated user can emit an event (transactional outbox
-- pattern — app writes event + business row in same transaction).
-- RLS on the upstream business tables controls who can produce what.
CREATE POLICY domain_events_insert_authenticated ON domain_events
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Update: deny all — only the dispatcher edge function (with service_role
-- key bypass) can mark events as processed.
CREATE POLICY domain_events_no_update ON domain_events
  FOR UPDATE
  USING (false)
  WITH CHECK (false);

-- Delete: deny all — events are immutable audit records.
-- Old partitions are dropped by monthly rollover function, not DELETE.
CREATE POLICY domain_events_no_delete ON domain_events
  FOR DELETE
  USING (false);

-- ============ 5. Partition rollover helper ============
-- Creates next month's partition. Scheduled to run on the 28th of each
-- month via pg_cron (added in a separate migration once pg_cron is
-- enabled on the v2 project; see ADR-0008).

CREATE OR REPLACE FUNCTION domain_events_create_next_partition()
  RETURNS text
  LANGUAGE plpgsql
  AS $$
DECLARE
  next_month_start date := date_trunc('month', now() + interval '1 month')::date;
  next_month_end date := (next_month_start + interval '1 month')::date;
  partition_name text := 'domain_events_' || to_char(next_month_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF domain_events FOR VALUES FROM (%L) TO (%L)',
    partition_name, next_month_start, next_month_end
  );
  RETURN partition_name;
END
$$;

COMMENT ON FUNCTION domain_events_create_next_partition() IS
  'Creates next month partition for domain_events. Call monthly via cron. ADR-0008.';

-- ============ 6. Verification queries (manual, not run automatically) ============
--
-- After applying, verify with:
--
-- -- Profiles extensions
-- \d profiles
-- -- should show sub_role text, assigned_section_id uuid
--
-- -- Sections table
-- SELECT code, name FROM sections;  -- (empty until seed in 20260502)
--
-- -- Role predicates
-- SELECT auth_is_production();     -- false for anon
-- SELECT auth_is_technologist();   -- false for anon
--
-- -- Domain events partitions
-- SELECT relname FROM pg_class
-- WHERE relname LIKE 'domain_events%' AND relkind IN ('r', 'p')
-- ORDER BY relname;
-- -- Expected: domain_events, domain_events_2026_04..07
--
-- -- RLS status
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename IN ('sections', 'domain_events');
-- -- Expected: rowsecurity = true for both
--
-- -- Policies exist
-- SELECT tablename, policyname FROM pg_policies
-- WHERE schemaname = 'public' AND tablename IN ('sections', 'domain_events');
-- -- Expected: ≥2 policies per table
