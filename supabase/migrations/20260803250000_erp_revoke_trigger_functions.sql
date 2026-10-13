-- Функции-триггеры перестают быть вызываемыми через REST.
--
-- Advisor показал, что `erp_calendar_guard()`, `erp_stage_guard()`,
-- `erp_material_guard()` и `erp_log_changes()` доступны по
-- `/rest/v1/rpc/<имя>` роли `authenticated` и даже `anon`.
--
-- ЭТО НЕ ТОТ СЛУЧАЙ, что записан в CLAUDE.md как «не чинить». Там речь про
-- `is_admin()`, `erp_is_manager()`, `erp_is_member()`, `erp_has_permission()`
-- и `erp_role_of_caller()`: они стоят в предикатах RLS, а предикаты исполняются
-- ОТ ЛИЦА ВЫЗЫВАЮЩЕГО — отзыв EXECUTE сломал бы сами политики. Утечки там нет:
-- функции без аргументов и отвечают только про самого вызывающего.
--
-- Функции-триггеры — другое: их зовёт движок при DML, и проверка EXECUTE
-- при срабатывании триггера НЕ выполняется. Клиенту они не нужны никогда.
-- Прямой вызов и так упал бы («trigger functions can only be called as
-- triggers»), но держать в публичном API то, что не должно там быть, —
-- лишняя поверхность и десять предупреждений, за которыми теряются настоящие.

revoke execute on function public.erp_calendar_guard() from anon, authenticated, public;
revoke execute on function public.erp_stage_guard()    from anon, authenticated, public;
revoke execute on function public.erp_material_guard() from anon, authenticated, public;
revoke execute on function public.erp_log_changes()    from anon, authenticated, public;

-- Прежние триггерные функции, оставшиеся с ранних миграций, — по той же причине.
revoke execute on function public.erp_set_updated_at()          from anon, authenticated, public;
revoke execute on function public.erp_log_order_changes()        from anon, authenticated, public;
revoke execute on function public.erp_log_stage_plan_changes()   from anon, authenticated, public;
revoke execute on function public.erp_clamp_stage_qty()          from anon, authenticated, public;
revoke execute on function public.erp_procurement_task_derive()  from anon, authenticated, public;
revoke execute on function public.erp_warehouse_task_derive()    from anon, authenticated, public;

-- `handle_new_user` висит на auth.users и создаёт профиль при регистрации.
-- Вызов её напрямую — это создание профиля в обход регистрации.
revoke execute on function public.handle_new_user()              from anon, authenticated, public;
