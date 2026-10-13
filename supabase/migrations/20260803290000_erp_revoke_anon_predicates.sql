-- R5 из аудита 03.08.2026: предикатные функции были вызываемы ролью `anon`.
--
-- Правило CLAUDE.md гласит: `is_admin()`, `erp_is_manager()`, `erp_is_member()`
-- вызываемы через REST, и «так и оставляем» — они стоят в предикатах RLS,
-- а предикаты исполняются ОТ ЛИЦА ВЫЗЫВАЮЩЕГО, поэтому отзыв EXECUTE сломал бы
-- сами политики. Утечки нет: функции без аргументов и возвращают булево
-- о самом вызывающем.
--
-- Но `erp_has_permission(perm text)` под это обоснование НЕ подходит: у неё
-- ЕСТЬ аргумент, и неавторизованный вызывающий может перебирать имена прав.
-- Возвращает она false, так что утечки данных нет и здесь, — но открытая
-- ручка, не покрытая собственным правилом проекта, это долг, а не решение.
--
-- Отзываем ТОЛЬКО у `anon`. У `authenticated` оставляем: все политики,
-- где эти функции стоят в предикате, объявлены `to authenticated`, и отзыв
-- у этой роли сломал бы план производства, этапы и ТЗ разом.
--
-- `erp_role_of_caller()` — по той же причине: она отвечает про вызывающего,
-- но неавторизованному отвечать нечего.

-- ВАЖНО: отзыв «from anon» сам по себе бесполезен. Право приходит от PUBLIC
-- (в ACL это `=X/postgres`), а `anon` его наследует — после такого revoke
-- has_function_privilege('anon', …) по-прежнему true. Снимать надо именно
-- PUBLIC и тут же возвращать явный грант `authenticated`, иначе вместе
-- с ручкой для анонима закроются политики плана, этапов и ТЗ.
revoke execute on function public.erp_has_permission(text) from public, anon;
grant  execute on function public.erp_has_permission(text) to authenticated;

revoke execute on function public.erp_role_of_caller() from public, anon;
grant  execute on function public.erp_role_of_caller() to authenticated;
