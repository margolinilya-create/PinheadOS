-- Выгружено дословно из истории прода (pinhead-os-v2),
-- версия 20260722215651 `security_predicate_revoke_anon`.
-- Отзывает EXECUTE у public/anon на предикатах erp_is_member()/erp_is_manager()
-- и оставляет грант только роли authenticated (её используют RLS-политики).

-- Предикаты ролей нужны только политикам (роль authenticated). anon их вызывать не должен.
revoke execute on function public.erp_is_member() from public, anon;
revoke execute on function public.erp_is_manager() from public, anon;
grant execute on function public.erp_is_member() to authenticated;
grant execute on function public.erp_is_manager() to authenticated;
