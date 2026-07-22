-- Предикаты ролей нужны только политикам (роль authenticated). anon их вызывать не должен.
-- Убирает advisor-warn 0028 (anon can execute) для erp_is_member/erp_is_manager,
-- сохраняя execute для authenticated (RLS-политики вызывают их при проверке доступа).
-- Применено к pinhead-os-v2 (glhwbktsokphgksdvcxj) через MCP apply_migration.

revoke execute on function public.erp_is_member() from public, anon;
revoke execute on function public.erp_is_manager() from public, anon;
grant execute on function public.erp_is_member() to authenticated;
grant execute on function public.erp_is_manager() to authenticated;
