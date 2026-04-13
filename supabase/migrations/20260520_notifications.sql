-- =============================================
-- redesign/v2 — Notifications (dispatcher consumer target)
-- Migration: 20260520_notifications.sql
-- Branch: redesign/v2
-- ADRs: 0001 (bounded contexts), 0004 (outbox), 0008 (dispatcher)
--
-- Depends on:
--   20260501_production_foundation.sql — auth_is_* predicates
--
-- Closes the dispatcher consumer TODO from W1: events drained from
-- domain_events outbox land here as user-facing rows with title/body.
-- The bell (NotificationsBell.jsx) reads from this table instead of
-- raw domain_events, giving us:
--   - human-readable title + body (no event_type leakage)
--   - per-user targeting via user_id (NULL = broadcast)
--   - read_at state for unread badge
--   - dedupe via (event_id, user_id) unique
--
-- HOW TO APPLY: Management API or Dashboard SQL editor.
-- =============================================

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  -- NULL = broadcast (visible to all authenticated)
  user_id uuid REFERENCES profiles(id),
  -- Source event in domain_events. NULL allowed for app-emitted notifications
  -- that don't trace back to an outbox row.
  event_id uuid,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notifications_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT notifications_kind_check CHECK (kind IN (
    'tech_card_approved',
    'piecework_entry_created',
    'payroll_batch_closed',
    'manual'
  ))
);

COMMENT ON TABLE notifications IS
  'Per-user notification feed. Populated by domain-events-dispatcher edge function. Bell subscribes via realtime. ADR-0004, ADR-0008.';

-- Dedupe: dispatcher might re-pick a stale event before processed_at is set
-- (at-least-once delivery). The (event_id, user_id) tuple is the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_event_user_uniq
  ON notifications (event_id, user_id)
  WHERE event_id IS NOT NULL;

-- Lookups
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_recent_idx
  ON notifications (created_at DESC);

-- ============ RLS ============
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Read: own targeted notifications + all broadcasts. Authenticated only.
CREATE POLICY notifications_read_own ON notifications
  FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- Insert: only via service_role (dispatcher). App-side users can't directly
-- create notifications — they go through emitDomainEvent → dispatcher.
-- Manual notifications by admin are inserted via service_role too.
CREATE POLICY notifications_no_insert ON notifications
  FOR INSERT
  WITH CHECK (false);

-- Update: only mark-as-read on own rows.
CREATE POLICY notifications_mark_read ON notifications
  FOR UPDATE
  USING (
    auth.uid() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (user_id IS NULL OR user_id = auth.uid())
  );

-- Delete: forbidden. Old notifications drained by retention cron later.
CREATE POLICY notifications_no_delete ON notifications
  FOR DELETE
  USING (false);

-- ============ Verification ============
--
-- SELECT tablename, rowsecurity FROM pg_tables
-- WHERE schemaname = 'public' AND tablename = 'notifications';
--
-- SELECT policyname, cmd FROM pg_policies
-- WHERE schemaname = 'public' AND tablename = 'notifications';
-- -- Expected: 4 policies (read_own, no_insert, mark_read, no_delete)
