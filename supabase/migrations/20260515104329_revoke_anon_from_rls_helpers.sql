-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260515104329 `20260515_revoke_anon_from_rls_helpers`.
--
-- Исторически: отзывает EXECUTE у роли anon на SECURITY DEFINER хелперах RLS,
-- убирая поверхность info-disclosure через /rest/v1/rpc/<fn>.
-- Предикаты auth_is_* снесены ниже по порядку миграцией
-- 20260716120000_drop_legacy_erp_redesign_v2 и в baseline отсутствуют — revoke на
-- них идёт под guard, по одной функции, чтобы отсутствие любой из них не отменяло
-- остальные. is_admin() и log_order_changes() легаси-снос переживают, поэтому
-- revoke на них — безусловный: это и есть та часть постуры, ради которой файл жив.

-- Revoke EXECUTE from anon on RLS-helper SECURITY DEFINER functions.
-- These return false for anon (auth.uid() IS NULL) so revoking has no
-- functional impact — only removes the /rest/v1/rpc/<fn> info-disclosure
-- surface. authenticated grant retained because RLS policies need it.

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;

-- log_order_changes is a trigger function executed by the table owner.
-- Nobody else needs EXECUTE.
REVOKE EXECUTE ON FUNCTION public.log_order_changes() FROM anon, authenticated;

-- ── Легаси-предикаты: только там, где они ещё существуют ───────────────────
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
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', fn);
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'skip %: функции нет (легаси-схема erp_redesign_v2 не создавалась)', fn;
    END;
  END LOOP;
END $$;
