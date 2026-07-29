-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260515104329 `20260515_revoke_anon_from_rls_helpers`.
-- Отзывает EXECUTE у роли anon на SECURITY DEFINER хелперы RLS,
-- чтобы убрать поверхность info-disclosure через /rest/v1/rpc/<fn>.
-- ВНИМАНИЕ: функции auth_is_* — легаси, в baseline репозитория их нет.

-- Revoke EXECUTE from anon on RLS-helper SECURITY DEFINER functions.
-- These return false for anon (auth.uid() IS NULL) so revoking has no
-- functional impact — only removes the /rest/v1/rpc/<fn> info-disclosure
-- surface. authenticated grant retained because RLS policies need it.

REVOKE EXECUTE ON FUNCTION public.auth_is_admin_or_director() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_foreman_of(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_hr() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_production() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_qc_operator() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_senior_foreman() FROM anon;
REVOKE EXECUTE ON FUNCTION public.auth_is_technologist() FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_admin() FROM anon;

-- log_order_changes is a trigger function executed by the table owner.
-- Nobody else needs EXECUTE.
REVOKE EXECUTE ON FUNCTION public.log_order_changes() FROM anon, authenticated;
