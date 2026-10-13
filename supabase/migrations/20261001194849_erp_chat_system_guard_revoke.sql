-- Триггерная функция `erp_chat_system_guard` (20261001194514) закрыта для REST:
-- `create function` даёт EXECUTE роли PUBLIC, а через PostgREST страж вызывать
-- незачем (сторож triggerFunctionsRevoked.test.ts). Отдельной миграцией —
-- исходная уже применена, а применённую правят новой.
revoke execute on function public.erp_chat_system_guard() from public, anon, authenticated;
