-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260515104159 `20260515_security_hardening_post_cutover`.
-- Security hardening после cutover: RLS на партициях domain_events, замена
-- catch-all политик app_config/catalog_config, search_path у функций,
-- REVOKE EXECUTE FROM PUBLIC у SECURITY DEFINER, снятие публичного чтения sku-photos.
-- ВНИМАНИЕ: опирается на легаси-объекты (domain_events_*, auth_is_*, piecework_*,
-- tech_operation_*), которых нет в baseline репозитория — при реплее с нуля упадёт.

-- Security hardening после cutover 2026-05-11.

-- =========================================================================
-- 1. RLS на существующих партициях domain_events
-- =========================================================================
ALTER TABLE public.domain_events_2026_04 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events_2026_05 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events_2026_06 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.domain_events_2026_07 ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- 2. Replace catch-all policies on app_config / catalog_config
-- =========================================================================
DROP POLICY IF EXISTS app_config_all ON public.app_config;
DROP POLICY IF EXISTS catalog_config_all ON public.catalog_config;

CREATE POLICY app_config_read_authenticated
  ON public.app_config
  FOR SELECT
  TO public
  USING (auth.role() = 'authenticated');

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
-- =========================================================================
ALTER FUNCTION public.log_order_changes() SET search_path = public;
ALTER FUNCTION public.piecework_forbid_update_if_paid() SET search_path = public;
ALTER FUNCTION public.tech_operation_order_id_consistent() SET search_path = public;

-- =========================================================================
-- 4. Update domain_events_create_next_partition: search_path + RLS
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
-- =========================================================================
REVOKE EXECUTE ON FUNCTION public.auth_is_admin_or_director() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_is_foreman_of(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_is_hr() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_is_production() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_is_qc_operator() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_is_senior_foreman() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.auth_is_technologist() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_order_changes() FROM PUBLIC;

-- =========================================================================
-- 6. Tighten sku-photos bucket policy
-- =========================================================================
DROP POLICY IF EXISTS sku_photos_public_read ON storage.objects;
