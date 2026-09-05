-- Своя миграция отзыва для функции, заведённой ПОСЛЕ обхода
-- `20260812160000_erp_revoke_trigger_functions_sweep`.
--
-- Обход закрывает то, что есть НА МОМЕНТ его применения; у функции, заведённой
-- позже, обязан быть собственный `revoke` — это записанное правило проекта,
-- и его сторожат `triggerFunctionsRevoked.test.ts` и `permissionsCoverage.test.ts`.
-- Оба покраснели ровно на этой функции, и это ровно тот случай, ради которого
-- сторож писался: `erp_role_permission_touch` — `security definer` без
-- внутренней проверки, вызываемая любым вошедшим через `/rest/v1/rpc/`.
--
-- Отзыв полный (`from public, anon, authenticated`), потому что право приходит
-- от PUBLIC (`=X/postgres` в ACL), и `anon` его наследует: `from anon`
-- в одиночку не работает. Триггеру грант не нужен — он исполняется от лица
-- владельца функции.

revoke execute on function public.erp_role_permission_touch()
  from public, anon, authenticated;

-- Проверка на месте: миграция без самопроверки выглядит выполненной,
-- даже если ничего не отозвала
do $$
begin
  if has_function_privilege('authenticated', 'public.erp_role_permission_touch()', 'execute') then
    raise exception 'erp_role_permission_touch остался вызываемым через REST';
  end if;
end $$;
