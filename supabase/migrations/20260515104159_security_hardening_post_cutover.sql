-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260515104159 `20260515_security_hardening_post_cutover`.
--
-- Исторически: хардненинг после cutover 2026-05-11 — RLS на партициях domain_events,
-- замена catch-all политик app_config/catalog_config, пин search_path у функций,
-- REVOKE EXECUTE FROM PUBLIC у SECURITY DEFINER, снятие публичного чтения sku-photos.
-- Часть объектов (партиции domain_events_*, предикаты auth_is_*, piecework_forbid_*,
-- tech_operation_*) снесена ниже по порядку миграцией 20260716120000_drop_legacy_erp_redesign_v2
-- и в baseline отсутствует — эти операции убраны под guard и на чистой базе пропускаются.
-- Всё, что касается переживших объектов (app_config, catalog_config, is_admin(),
-- log_order_changes(), storage.objects), выполняется БЕЗУСЛОВНО: ради этой части
-- security-постуры файл и сохранён.

-- Security hardening после cutover 2026-05-11.

-- =========================================================================
-- 1. RLS на существующих партициях domain_events
--    GUARD: партиции — часть легаси-схемы, в baseline их нет.
-- =========================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'domain_events_2026_04','domain_events_2026_05',
    'domain_events_2026_06','domain_events_2026_07'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    ELSE
      RAISE NOTICE 'skip %: партиции нет (легаси-схема erp_redesign_v2 не создавалась)', t;
    END IF;
  END LOOP;
END $$;

-- =========================================================================
-- 2. Replace catch-all policies on app_config / catalog_config
--    БЕЗУСЛОВНО: обе таблицы есть в baseline и легаси-снос их не трогает.
-- =========================================================================
DROP POLICY IF EXISTS app_config_all ON public.app_config;
DROP POLICY IF EXISTS catalog_config_all ON public.catalog_config;

DROP POLICY IF EXISTS app_config_read_authenticated ON public.app_config;
CREATE POLICY app_config_read_authenticated
  ON public.app_config
  FOR SELECT
  TO public
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS app_config_write_admins ON public.app_config;
CREATE POLICY app_config_write_admins
  ON public.app_config
  FOR ALL
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = ANY (ARRAY['admin'::text, 'director'::text])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = ANY (ARRAY['admin'::text, 'director'::text])
    )
  );

-- =========================================================================
-- 3. SET search_path on functions
--    log_order_changes() — из 20260320_order_audit_log.sql, легаси-снос её НЕ трогает
--    → безусловно. piecework_/tech_operation_ — легаси → guard.
-- =========================================================================
ALTER FUNCTION public.log_order_changes() SET search_path = public;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.piecework_forbid_update_if_paid()',
    'public.tech_operation_order_id_consistent()'
  ] LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip %: функции нет (легаси-схема erp_redesign_v2 не создавалась)', fn;
    END;
  END LOOP;
END $$;

-- =========================================================================
-- 4. Update domain_events_create_next_partition: search_path + RLS
--    БЕЗУСЛОВНО: CREATE OR REPLACE не зависит от наличия таблицы domain_events
--    (обращения к ней только внутри EXECUTE format и при создании не проверяются).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.domain_events_create_next_partition()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  next_month_start date := date_trunc('month', now() + interval '1 month')::date;
  next_month_end date := (next_month_start + interval '1 month')::date;
  partition_name text := 'domain_events_' || to_char(next_month_start, 'YYYY_MM');
BEGIN
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF domain_events FOR VALUES FROM (%L) TO (%L)',
    partition_name, next_month_start, next_month_end
  );
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', partition_name);
  RETURN partition_name;
END
$function$;

-- =========================================================================
-- 5. REVOKE EXECUTE FROM PUBLIC on SECURITY DEFINER functions
--    is_admin() (baseline) и log_order_changes() (20260320) переживают легаси-снос
--    → безусловно. Предикаты auth_is_* снесены drop_legacy → guard, по одному,
--    чтобы отсутствие одной функции не отменяло revoke на остальных.
-- =========================================================================
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_order_changes() FROM PUBLIC;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.auth_is_admin_or_director()',
    'public.auth_is_foreman_of(uuid)',
    'public.auth_is_hr()',
    'public.auth_is_production()',
    'public.auth_is_qc_operator()',
    'public.auth_is_senior_foreman()',
    'public.auth_is_technologist()'
  ] LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip %: функции нет (легаси-схема erp_redesign_v2 не создавалась)', fn;
    END;
  END LOOP;
END $$;

-- =========================================================================
-- 6. Tighten sku-photos bucket policy
--    БЕЗУСЛОВНО: storage.objects есть в любом проекте Supabase, а саму политику
--    создаёт 20260511170014 выше по порядку.
-- =========================================================================
DROP POLICY IF EXISTS sku_photos_public_read ON storage.objects;
