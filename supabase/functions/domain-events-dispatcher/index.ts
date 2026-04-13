// =============================================
// redesign/v2 — Domain Events Dispatcher
// File: supabase/functions/domain-events-dispatcher/index.ts
// Branch: redesign/v2
// ADRs: 0004 (outbox pattern), 0008 (pg_cron polling)
//
// STUB IMPLEMENTATION — W1 Day-1
//
// This edge function drains the domain_events outbox. Called by pg_cron
// every 10 seconds:
//
//   SELECT cron.schedule(
//     'dispatch-domain-events',
//     '*/10 * * * * *',
//     $$ SELECT net.http_post(
//          url := 'https://<project-ref>.functions.supabase.co/domain-events-dispatcher',
//          headers := jsonb_build_object(
//            'Authorization', 'Bearer ' || current_setting('app.service_role_key')
//          )
//        ) $$
//   );
//
// CURRENT STATE (W1 Day-1):
//   - Connects to Supabase using service_role key (bypasses RLS for UPDATE)
//   - Reads unprocessed events in batches of 500, ordered by created_at
//   - LOGS consumer dispatch (notifications/audit tables don't exist yet)
//   - Marks processed_at so the row isn't picked up again
//   - Retries crashed events (unprocessed > 5 minutes) on next tick
//
// LATER MILESTONES:
//   W6: Add notification_from_event() when notifications table exists
//   W8: Add bell realtime fan-out via notifications insert
//   W9: Add audit projection into order_audit
//   W11: Add materialized view refresh for TV Dashboard (phase 2)
//
// DEPLOYMENT:
//   supabase functions deploy domain-events-dispatcher \
//     --project-ref glhwbktsokphgksdvcxj \
//     --no-verify-jwt
//   # --no-verify-jwt because cron sends service_role Bearer, not user JWT
//
// SECRETS (set via Supabase Dashboard → Functions → Secrets):
//   SUPABASE_URL         (auto-injected)
//   SUPABASE_SERVICE_ROLE_KEY (auto-injected — DO NOT commit)
// =============================================

// @ts-ignore — Deno runtime types, resolved at deploy time
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// Deno global — provided by Supabase Edge Functions runtime
// @ts-ignore
declare const Deno: {
  env: { get: (key: string) => string | undefined };
  serve: (handler: (req: Request) => Response | Promise<Response>) => void;
};

// ============ config ============

const BATCH_SIZE = 500;
const RETRY_STALE_MINUTES = 5;

// ============ types ============

interface DomainEvent {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  processed_at: string | null;
  created_at: string;
}

interface DispatchResult {
  total: number;
  processed: number;
  failed: number;
  errors: Array<{ event_id: string; message: string }>;
}

// ============ consumers ============
//
// W4+: notifications table is live (migration 20260520). Each event maps
// to a notifications row with title/body. Dispatcher inserts via
// service_role — bypasses RLS no_insert policy.
//
// Targeting: NULL user_id = broadcast to all authenticated. Per-user
// targeting will land when worker → profile linking is filled in.
//
// Idempotent: notifications has UNIQUE (event_id, user_id) so a re-pick
// of an unprocessed event won't double-insert.

interface NotificationRow {
  user_id: string | null;
  event_id: string;
  kind: string;
  title: string;
  body: string | null;
}

function notificationFromEvent(event: DomainEvent): NotificationRow | null {
  switch (event.event_type) {
    case 'tech_card.approved':
    case 'tech_card_approved': {
      const orderId = event.payload?.order_id ?? event.aggregate_id;
      const opCount = event.payload?.operation_count ?? '?';
      return {
        user_id: null, // broadcast
        event_id: event.id,
        kind: 'tech_card_approved',
        title: 'Tech card утверждена',
        body: `Заказ ${String(orderId).slice(0, 8)}, ${opCount} операций. Снапшоты заморожены.`,
      };
    }
    case 'piecework.entry_created':
    case 'piecework_accrued': {
      const amount = event.payload?.amount ?? 0;
      const entryType = event.payload?.entry_type ?? 'accrual';
      return {
        user_id: null,
        event_id: event.id,
        kind: 'piecework_entry_created',
        title: 'Сделка записана',
        body: `${entryType}: ${amount}₽`,
      };
    }
    case 'payroll.batch_closed': {
      return {
        user_id: null,
        event_id: event.id,
        kind: 'payroll_batch_closed',
        title: 'Период закрыт',
        body: 'Записи заморожены, корректировки только через сторно (reversal_of).',
      };
    }
    case 'test.smoke': {
      return {
        user_id: null,
        event_id: event.id,
        kind: 'manual',
        title: 'Smoke event',
        body: 'Test event from dispatcher pipeline.',
      };
    }
    // Legacy names (W1 placeholder vocabulary) — log only, no notification
    case 'task_started':
    case 'task_completed':
    case 'qc_passed':
    case 'qc_rejected':
    case 'rework_created':
    case 'order_cancelled':
      return null;
    default:
      return null;
  }
}

async function dispatchEvent(
  event: DomainEvent,
  // @ts-ignore — supabase client type lives at runtime
  sb: any
): Promise<void> {
  const notif = notificationFromEvent(event);

  if (!notif) {
    console.log(JSON.stringify({
      level: 'info',
      dispatcher: 'domain-events-dispatcher',
      action: 'skip_no_consumer',
      event_type: event.event_type,
      event_id: event.id,
    }));
    return;
  }

  const { error } = await sb.from('notifications').insert(notif);

  if (error) {
    // Unique-constraint violation = already inserted (idempotent retry). OK.
    if (error.code === '23505') {
      console.log(JSON.stringify({
        level: 'info',
        dispatcher: 'domain-events-dispatcher',
        action: 'dedupe_skip',
        event_id: event.id,
      }));
      return;
    }
    throw new Error(`notifications insert failed: ${error.message}`);
  }

  console.log(JSON.stringify({
    level: 'info',
    dispatcher: 'domain-events-dispatcher',
    action: 'notification_inserted',
    event_type: event.event_type,
    event_id: event.id,
    kind: notif.kind,
  }));
}

// ============ main handler ============

async function dispatch(): Promise<DispatchResult> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY secrets');
  }

  const sb = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result: DispatchResult = { total: 0, processed: 0, failed: 0, errors: [] };

  // Fetch unprocessed events (including stale crashed ones).
  // `or` filter: processed_at is null AND (created within last 5 min OR older than 5 min = retry crashed)
  // Simpler equivalent: just processed_at is null — stale events are automatically re-picked.
  const staleBoundary = new Date(Date.now() - RETRY_STALE_MINUTES * 60 * 1000).toISOString();

  const { data: events, error: fetchError } = await sb
    .from('domain_events')
    .select('*')
    .is('processed_at', null)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);

  if (fetchError) {
    throw new Error(`Failed to fetch events: ${fetchError.message}`);
  }

  if (!events || events.length === 0) {
    return result;
  }

  result.total = events.length;

  // Dispatch each event; collect IDs of successfully processed ones.
  const processedIds: string[] = [];
  const processedCreatedAts: string[] = [];

  for (const event of events as DomainEvent[]) {
    try {
      await dispatchEvent(event, sb);
      processedIds.push(event.id);
      processedCreatedAts.push(event.created_at);
      result.processed++;
    } catch (err) {
      result.failed++;
      result.errors.push({
        event_id: event.id,
        message: err instanceof Error ? err.message : String(err),
      });
      console.error(JSON.stringify({
        level: 'error',
        dispatcher: 'domain-events-dispatcher',
        action: 'dispatch_failed',
        event_id: event.id,
        event_type: event.event_type,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }

  // Batch-mark processed.
  // Note: UPDATE on partitioned table bypasses RLS only because we use
  // service_role key. App-level users are blocked by domain_events_no_update
  // policy (ADR-0004).
  if (processedIds.length > 0) {
    // In a partitioned table we update by (id, created_at) — partition pruning
    // requires the partition key in WHERE. Do it per-row to be safe.
    const now = new Date().toISOString();
    for (let i = 0; i < processedIds.length; i++) {
      const { error: updateError } = await sb
        .from('domain_events')
        .update({ processed_at: now })
        .eq('id', processedIds[i])
        .eq('created_at', processedCreatedAts[i]);

      if (updateError) {
        // Can't mark processed — event will be retried next tick.
        // That's the designed behavior (at-least-once delivery).
        result.failed++;
        result.processed--;
        result.errors.push({
          event_id: processedIds[i],
          message: `mark_processed failed: ${updateError.message}`,
        });
      }
    }
  }

  return result;
}

// ============ HTTP entrypoint ============

// @ts-ignore — Deno.serve provided at runtime
Deno.serve(async (req: Request) => {
  // Only accept POST (pg_cron sends POST with empty body)
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const result = await dispatch();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({
      level: 'fatal',
      dispatcher: 'domain-events-dispatcher',
      action: 'dispatch_crashed',
      error: message,
    }));
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
