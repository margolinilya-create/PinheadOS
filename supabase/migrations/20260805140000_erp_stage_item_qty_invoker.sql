-- `erp_stage_item_qty` переводится в SECURITY INVOKER (правка по советнику, 05.08).
--
-- Миграцией 20260805120000 хелпер был заведён как `security definer` — по инерции
-- от соседних предикатных функций. Для НИХ это обязательно: `erp_is_member`,
-- `erp_has_permission`, `erp_can_act_in_dept` стоят в выражениях RLS и обязаны
-- видеть `profiles`/`erp_employees` мимо политик, иначе предикат проверял бы сам
-- себя. Этот хелпер в политиках не стоит: он читает тираж позиции для четырёх
-- RPC, а те и так исполняются от лица вызывающего.
--
-- Цена ошибки: `definer` обходит RLS, поэтому тираж любой позиции отдавался по id
-- этапа любому вошедшему — включая неодобренный профиль, которому таблицы закрыты
-- (`erp_is_member()` = false). Утечка маленькая (одно число, id этапа не угадать),
-- но она ничем не оправдана: своим членам ERP `erp_order_items` открыт политикой,
-- и invoker отдаёт им ровно то же самое.
--
-- Для вызывающих RPC ничего не меняется: у члена ERP есть SELECT на обе таблицы,
-- join отработает как прежде. У постороннего функция вернёт NULL, и RPC ответит
-- «этап не найден» — что и требуется.

create or replace function public.erp_stage_item_qty(p_stage_id uuid)
returns int language sql stable security invoker set search_path = public as $$
  select i.qty
    from public.erp_item_stages s
    join public.erp_order_items i on i.id = s.item_id
   where s.id = p_stage_id;
$$;
revoke execute on function public.erp_stage_item_qty(uuid) from public, anon;
grant execute on function public.erp_stage_item_qty(uuid) to authenticated;

comment on function public.erp_stage_item_qty(uuid) is
  'Тираж позиции по id этапа для RPC этапов. SECURITY INVOKER: в выражениях RLS не стоит, а definer отдавал бы тираж мимо политик.';
