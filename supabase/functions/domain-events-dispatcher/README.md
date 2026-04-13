# domain-events-dispatcher

Edge function that drains the `domain_events` outbox table. See [ADR-0004](../../../docs/adr/0004-domain-events-outbox.md) and [ADR-0008](../../../docs/adr/0008-domain-events-dispatcher.md) for the architectural rationale.

## State (W1 Day-1)

**Stub.** The function is functionally complete but consumer logic is logging only — it doesn't yet insert into `notifications`, `order_audit`, or refresh materialized views, because those targets don't exist yet on `redesign/v2`.

As downstream tables land in later migrations, `dispatchEvent()` in `index.ts` gains real consumer branches.

## Deployment

Requires Supabase CLI with project linked (see `.vercel/project.json`-equivalent for Supabase — normally `supabase link --project-ref glhwbktsokphgksdvcxj`).

```bash
supabase functions deploy domain-events-dispatcher \
  --project-ref glhwbktsokphgksdvcxj \
  --no-verify-jwt
```

`--no-verify-jwt` because the dispatcher is called by `pg_cron` with the service_role Bearer token, not a user JWT.

## Scheduling via pg_cron

After the function is deployed, schedule it in the v2 Supabase Dashboard → SQL Editor:

```sql
-- Prerequisite: pg_cron extension enabled in Database → Extensions
-- If not enabled: search for "pg_cron" and toggle on.

-- Schedule the dispatcher to run every 10 seconds
SELECT cron.schedule(
  'dispatch-domain-events',
  '*/10 * * * * *',
  $$
    SELECT net.http_post(
      url := 'https://glhwbktsokphgksdvcxj.functions.supabase.co/domain-events-dispatcher',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
        'Content-Type', 'application/json'
      ),
      body := '{}'::jsonb
    );
  $$
);
```

To stop or inspect:

```sql
-- List active jobs
SELECT jobid, jobname, schedule, active FROM cron.job;

-- Disable
SELECT cron.unschedule('dispatch-domain-events');

-- Recent runs
SELECT * FROM cron.job_run_details
WHERE jobname = 'dispatch-domain-events'
ORDER BY start_time DESC
LIMIT 20;
```

## Secrets

These are auto-injected by Supabase Edge runtime, no manual setup needed:

- `SUPABASE_URL` — set automatically
- `SUPABASE_SERVICE_ROLE_KEY` — set automatically

Verify via Dashboard → Functions → domain-events-dispatcher → Secrets.

## Monitoring

- Function logs: Dashboard → Functions → domain-events-dispatcher → Logs
- Cron run history: `cron.job_run_details` table
- Outbox depth: `SELECT count(*) FROM domain_events WHERE processed_at IS NULL`

**Alert threshold (to configure later):** outbox depth > 1000 unprocessed events = dispatcher is falling behind.

## Testing locally

```bash
supabase functions serve domain-events-dispatcher --env-file pinhead-react/.env.local
```

Then trigger manually:

```bash
curl -X POST http://localhost:54321/functions/v1/domain-events-dispatcher \
  -H "Authorization: Bearer <your service_role key>"
```

For unit tests of `dispatchEvent()` logic, see `pinhead-react/tests/dispatcher.test.ts` (to be added in W2).

## Crash recovery

If the dispatcher edge function crashes mid-batch, unprocessed events stay with `processed_at IS NULL`. The next cron tick (10s later) picks them up. The design is at-least-once delivery — idempotency is the consumer's responsibility (use `idempotency_key` field).

If the dispatcher stops entirely (e.g. Supabase outage), events accumulate in `domain_events`. When it restarts, the next tick drains up to `BATCH_SIZE = 500` per run. At 10s intervals = 3000 events/min of recovery throughput.
