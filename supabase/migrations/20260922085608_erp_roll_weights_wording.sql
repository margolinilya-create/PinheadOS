/**
 * СКЛОНЕНИЕ В ТЕКСТЕ ОТКАЗА (находка прогона 22.09).
 *
 * Функция отвечала «1 рулонов не принадлежат этому материалу». Это тот же
 * текст, который кладовщик видит в тосте: сообщение сервера доходит до
 * человека дословно, и «1 рулонов» читается как сбой программы, а не как
 * объяснение, что он выбрал не тот рулон.
 *
 * Pluralize у проекта есть, но он КЛИЕНТСКИЙ (`utils/i18n`), а эта строка
 * рождается в базе. Заводить вторую реализацию склонения в SQL ради одного
 * места не стоит — поэтому число и предмет разведены: «не принадлежат этому
 * материалу: рулонов — 1». Форма верна при любом числе и не требует таблицы
 * окончаний.
 *
 * Применённую миграцию (20260921213035) не правим — правило проекта: тело
 * переопределяется НОВОЙ. Сигнатура та же, поэтому перегрузки не возникает
 * и гранты сохраняются; `security definer` выписан явно — этого требует
 * сторож, читающий последнюю определяющую миграцию.
 */
create or replace function public.erp_material_rolls_set_weights(
  p_material_id uuid,
  p_weights jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_qty      numeric;
  v_sum      numeric;
  v_touched  int;
  v_bad      int;
  v_unknown  int;
begin
  if not public.erp_has_permission('material.receive') then
    raise exception 'erp_material_rolls_set_weights: нужно право material.receive'
      using errcode = '42501';
  end if;

  if p_weights is null or jsonb_typeof(p_weights) <> 'array'
     or jsonb_array_length(p_weights) = 0 then
    raise exception 'erp_material_rolls_set_weights: не переданы веса рулонов'
      using errcode = '22023';
  end if;

  select coalesce(qty_received, 0) into v_qty
    from public.erp_materials where id = p_material_id;
  if not found then
    raise exception 'erp_material_rolls_set_weights: материал не найден' using errcode = 'P0002';
  end if;

  -- Веса приходят парами «рулон → вес»: сопоставлять их порядком в массиве
  -- значило бы зависеть от сортировки на клиенте
  select count(*) into v_bad
    from jsonb_array_elements(p_weights) w
   where nullif(w->>'roll_id', '') is null
      or nullif(w->>'qty', '') is null
      or (w->>'qty')::numeric <= 0;
  if v_bad > 0 then
    raise exception 'erp_material_rolls_set_weights: вес рулона должен быть больше нуля'
      using errcode = '22023';
  end if;

  select count(*) into v_unknown
    from jsonb_array_elements(p_weights) w
   where not exists (
     select 1 from public.erp_material_rolls r
      where r.id = (w->>'roll_id')::uuid and r.material_id = p_material_id);
  if v_unknown > 0 then
    raise exception 'erp_material_rolls_set_weights: не принадлежат этому материалу: рулонов — %', v_unknown
      using errcode = '22023';
  end if;

  -- Сумма сверяется со ВСЕМИ рулонами материала: те, у кого вес уже есть,
  -- входят в неё наравне с проставляемыми — иначе частичное дозаполнение
  -- проходило бы с любой цифрой
  select coalesce(sum(coalesce(t.qty, r.qty)), 0) into v_sum
    from public.erp_material_rolls r
    left join lateral (
      select (w->>'qty')::numeric as qty
        from jsonb_array_elements(p_weights) w
       where (w->>'roll_id')::uuid = r.id
       limit 1
    ) t on true
   where r.material_id = p_material_id;

  if abs(v_sum - v_qty) > 0.01 then
    raise exception 'erp_material_rolls_set_weights: сумма весов % не сходится с принятым количеством %',
      v_sum, v_qty using errcode = '22023';
  end if;

  with weights as (
    select (w->>'roll_id')::uuid as roll_id, (w->>'qty')::numeric as qty
      from jsonb_array_elements(p_weights) w
  )
  update public.erp_material_rolls r
     set qty = t.qty,
         -- Остаток проставляется только у нетронутого рулона: у того, с кого
         -- уже кроили, он посчитан по расходу и перезаписывать его нельзя
         qty_left = case when r.status = 'in_stock' and r.qty_left is null
                         then t.qty else r.qty_left end,
         price_per_unit = coalesce(r.price_per_unit, m.price_per_unit)
    from weights t
    join public.erp_materials m on m.id = p_material_id
   where r.id = t.roll_id and r.material_id = p_material_id;
  get diagnostics v_touched = row_count;

  return jsonb_build_object('material_id', p_material_id, 'updated', v_touched, 'total', v_sum);
end $function$;

revoke execute on function public.erp_material_rolls_set_weights(uuid, jsonb) from public, anon;
grant execute on function public.erp_material_rolls_set_weights(uuid, jsonb) to authenticated;
