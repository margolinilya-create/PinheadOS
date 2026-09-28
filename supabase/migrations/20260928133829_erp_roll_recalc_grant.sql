-- Пересчёт рулона доступен участнику: приёмка идёт от лица вызывающего
-- (правка 27.09, п. 4 — хвост, найден пробой на живой базе).
--
-- `erp_roll_recalc` в `20260928131459` отозвана и у `authenticated` —
-- «внутренняя, через REST не зовётся». Но её зовёт `erp_material_accept`,
-- а та `security invoker` (правило 21.09: «одним запросом» не значит «мимо
-- RLS»), и кладовщик получал 42501 на собственной приёмке — ровно тот отказ,
-- от которого пересчёт делали `definer`. Проба с откатом поймала это первым
-- же вызовом.
--
-- Правка: гейт членства ВНУТРИ функции и грант `authenticated`. Через REST
-- функция теперь вызываема, и это безопасно по построению: она переписывает
-- только производные колонки рулона из его же веса и параметров, ничего
-- не делает у рулона с расходом и не принимает ничего, кроме id.
create or replace function public.erp_roll_recalc(p_roll_id uuid)
returns void
language plpgsql
security definer
set search_path = public as $$
declare
  r        public.erp_material_rolls;
  v_mat    public.erp_materials;
  v_w      numeric;
  v_d      numeric;
  v_calc   numeric;
  v_len    numeric;
  v_src    text;
  v_k      numeric;
  v_ksrc   text;
  v_price  numeric;
begin
  -- Гейт членства: функция вызываема через REST, и чужому она ничего не должна
  if not public.erp_is_member() then
    raise exception 'erp_roll_recalc: только для участников производства'
      using errcode = '42501';
  end if;

  select * into r from public.erp_material_rolls where id = p_roll_id;
  if not found then
    return;
  end if;
  -- Расход уже был — производные не переписываются (см. 20260928131459)
  if exists (select 1 from public.erp_stage_report_rolls rr where rr.roll_id = p_roll_id) then
    return;
  end if;
  select * into v_mat from public.erp_materials where id = r.material_id;

  -- Параметры партии: свои у рулона, иначе снимок с материала
  v_w := coalesce(r.width_cm, v_mat.width_cm);
  v_d := coalesce(r.density_gsm, v_mat.density_gsm);

  v_calc := case when coalesce(r.qty, 0) > 0 and public.erp_fabric_kg_per_m(v_w, v_d) is not null
                 then r.qty / public.erp_fabric_kg_per_m(v_w, v_d) end;

  if r.length_source in ('supplier', 'measured') and coalesce(r.length_m, 0) > 0 then
    v_len := r.length_m;
    v_src := r.length_source;
  else
    v_len := v_calc;
    v_src := case when v_calc is not null then 'calc' end;
  end if;

  if v_src = 'calc' then
    v_k := public.erp_fabric_kg_per_m(v_w, v_d);
    v_ksrc := 'params';
  elsif v_src is not null and coalesce(r.qty, 0) > 0 then
    v_k := r.qty / v_len;
    v_ksrc := 'measured';
  else
    v_k := null;
    v_ksrc := null;
  end if;

  v_price := coalesce(r.price_per_unit, v_mat.price_per_unit);

  update public.erp_material_rolls
     set width_cm = v_w,
         density_gsm = v_d,
         length_calc_m = v_calc,
         length_m = v_len,
         length_source = v_src,
         kg_per_m = v_k,
         kg_per_m_source = v_ksrc,
         length_left_m = v_len,
         length_left_source = v_src,
         price_per_m = case when v_price is not null and v_k is not null then v_price * v_k end,
         price_per_unit = coalesce(price_per_unit, v_mat.price_per_unit)
   where id = p_roll_id;
end $$;

comment on function public.erp_roll_recalc(uuid) is
  'Пересчёт метража, коэффициента, остатка и цены за метр рулона по весу и параметрам (правка 27.09, п. 4). Только до первого расхода; гейт членства внутри';
revoke execute on function public.erp_roll_recalc(uuid) from public, anon;
grant execute on function public.erp_roll_recalc(uuid) to authenticated;
