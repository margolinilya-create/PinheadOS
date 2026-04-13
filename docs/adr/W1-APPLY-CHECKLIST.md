# W1 Variant A — Apply checklist

**Goal:** apply everything written in W1 Day-1..3 to the empty `pinhead-os-v2` Supabase project.

**Prereqs you control (I cannot):**
- Supabase account access to both projects
- Browser session in Supabase Dashboard

**Time budget:** ~30 min if nothing breaks.

---

## Project refs (copy-paste)

| Project | Ref | URL |
|---|---|---|
| **prod (main)** | `pulzirakjqehsulmjhdj` | https://supabase.com/dashboard/project/pulzirakjqehsulmjhdj |
| **v2 (redesign/v2)** | `glhwbktsokphgksdvcxj` | https://supabase.com/dashboard/project/glhwbktsokphgksdvcxj |

⚠️ **Never confuse these.** Every SQL you paste into the v2 Dashboard must be checked twice — wrong project = prod is the one you hit.

---

## Step 1 — Dump prod schema

You need the existing prod tables (`profiles`, `orders`, `order_comments`, `order_audit`, `app_config`, `catalog_config`) to exist in v2 before the 20260501 migration can attach FKs and columns to them.

**Option 1a — Dashboard (no CLI install)**

1. Open prod project → Database → Backups
2. Click **Generate schema dump** (schema-only, no data)
3. Download the .sql file
4. Open v2 project → SQL Editor → paste the dump → Run
5. Ignore data-related warnings — we want schema only
6. Verify: SQL Editor →
   ```sql
   SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
   ```
   Should list: `app_config`, `catalog_config`, `order_audit`, `order_comments`, `orders`, `profiles`

**Option 1b — Supabase CLI (faster, scriptable)**

```bash
brew install supabase/tap/supabase
supabase login                                    # opens browser
supabase db dump --project-ref pulzirakjqehsulmjhdj \
  --schema-only > /tmp/prod-schema.sql
# Open v2 Dashboard SQL Editor and paste /tmp/prod-schema.sql
```

I can run the `brew install` + `supabase login` part interactively if you want — just say.

---

## Step 2 — Apply W1 migrations (in order)

Paste each file into v2 Dashboard → SQL Editor → Run. **Order matters** — they have FK dependencies.

1. `supabase/migrations/20260501_production_foundation.sql`
   — adds `profiles.sub_role`, creates `sections`, `auth_is_*` predicates, `domain_events` partitioned outbox

2. `supabase/migrations/20260502_seed_sections_and_ops.sql`
   — seeds 7 sections, creates `operation_types`, seeds 30 ops

3. `supabase/migrations/20260510_db_guards.sql`
   — trigger functions (no table bindings yet). Must run BEFORE 20260503/5 because those bind triggers from this file.

4. `supabase/migrations/20260503_tech_cards.sql`
   — sku_tech_templates (+items), order_tech_cards, order_tech_operations + trigger bind

5. `supabase/migrations/20260504_workers.sql`
   — workers table

6. `supabase/migrations/20260505_piecework.sql`
   — piecework_batches, piecework_entries + trigger bind

**After each one:** look at the SQL editor result pane. A green "Success. No rows returned" is fine. Red errors → stop, paste the error to me.

---

## Step 3 — Verification queries

Paste into v2 SQL editor (one at a time) after step 2:

```sql
-- a) All new tables exist with RLS
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'sections', 'operation_types',
    'sku_tech_templates', 'sku_tech_template_items',
    'order_tech_cards', 'order_tech_operations',
    'workers', 'piecework_batches', 'piecework_entries',
    'domain_events'
  )
ORDER BY tablename;
-- Expected: 10 rows, rowsecurity = true for all

-- b) Sections seeded
SELECT code, name, sort_order FROM sections ORDER BY sort_order;
-- Expected: 7 rows (cutting, screenprint, embroidery, dtf, sewing, qc, packing)

-- c) Operation types seeded
SELECT s.code AS section, count(*) AS ops
FROM operation_types ot
JOIN sections s ON s.id = ot.section_id
GROUP BY s.code ORDER BY s.code;
-- Expected: cutting=3, dtf=3, embroidery=4, packing=4, qc=3, screenprint=6, sewing=7

-- d) Triggers bound
SELECT trigger_name, event_object_table
FROM information_schema.triggers
WHERE trigger_name IN (
  'tech_operation_order_id_consistency',
  'piecework_immutable_after_pay'
);
-- Expected: 2 rows

-- e) Role predicates exist
SELECT proname FROM pg_proc
WHERE proname LIKE 'auth_is_%'
ORDER BY proname;
-- Expected: auth_is_admin_or_director, auth_is_foreman_of, auth_is_production,
--           auth_is_qc_operator, auth_is_senior_foreman, auth_is_technologist

-- f) domain_events partitions
SELECT relname FROM pg_class
WHERE relname LIKE 'domain_events%' AND relkind IN ('r', 'p')
ORDER BY relname;
-- Expected: domain_events, domain_events_2026_04..07

-- g) RLS policy count
SELECT tablename, count(*) AS policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'sections', 'operation_types', 'sku_tech_templates',
    'sku_tech_template_items', 'order_tech_cards', 'order_tech_operations',
    'workers', 'piecework_batches', 'piecework_entries', 'domain_events'
  )
GROUP BY tablename ORDER BY tablename;
-- Expected: ≥2 policies per table
```

If any row count is off → stop, paste result to me.

---

## Step 4 — Deploy dispatcher edge function (optional, can defer)

Requires Supabase CLI:

```bash
supabase functions deploy domain-events-dispatcher \
  --project-ref glhwbktsokphgksdvcxj \
  --no-verify-jwt
```

Then in v2 Dashboard → Database → Extensions → enable **pg_cron** (toggle).

Then v2 SQL Editor:

```sql
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

Verify:
```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'dispatch-domain-events';
```

The dispatcher is a stub right now (logs only), so this step is **optional** for W1 — you can defer until W2 when real consumer logic lands.

---

## Step 5 — Smoke test from app

```bash
cd pinhead-react
npm run dev
```

Vite loads `.env.local` → hits v2 Supabase. Log in with a known admin account.

Open browser console and run:
```js
const { data, error } = await window.__supabase
  .from('sections')
  .select('*');
console.log({ data, error });
```

(If `__supabase` isn't exposed, just open Network tab and watch for `sections` queries to succeed.)

Expected: 7 section rows, no RLS error.

---

## Rollback plan

If anything goes sideways in v2, **main is untouched** — that's the whole point of this two-project setup. Options:

1. **Soft rollback:** leave migrations applied, stop using v2 in Vercel preview. No harm.
2. **Hard rollback:** v2 Dashboard → Settings → Delete project → recreate. Everything is in git, rebuild from scratch.
3. **Targeted rollback:** paste DROP statements for the specific table that broke. All new tables use `CREATE TABLE IF NOT EXISTS` so re-running is safe.

Prod main is a separate project — there is no path for v2 errors to reach prod users.
