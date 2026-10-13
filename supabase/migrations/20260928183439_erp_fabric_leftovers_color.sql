-- Доработки 28.09, третья порция: цвет материала в `erp_fabric_leftovers`.
--
-- Экран «Остатки ткани» переведён на серверный список остатков (остатки
-- закрытых заказов пропадали), и колонка цвета исчезла: функция цвет
-- не отдавала. Возвращаемый тип меняется — функция пересоздаётся.

drop function if exists public.erp_fabric_leftovers();
create or replace function public.erp_fabric_leftovers()
returns table (
  roll_id uuid, label text, seq int, material_id uuid, material text, kind text, unit text,
  order_id uuid, order_title text, order_status text,
  width_cm numeric, density_gsm numeric,
  length_m numeric, length_left_m numeric, length_source text,
  qty numeric, qty_left numeric, kg_per_m numeric,
  price_per_unit numeric, price_per_m numeric,
  location text, status text, created_at timestamptz,
  -- Цвет материала (правка 28.09, вторая порция): экран остатков показывал его до перевода на сервер
  color text
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select r.id, r.label, r.seq, m.id, coalesce(m.fact_name, m.name), m.kind, coalesce(r.unit, m.unit),
         o.id, o.title, o.status,
         coalesce(r.width_cm, m.width_cm), coalesce(r.density_gsm, m.density_gsm),
         r.length_m, r.length_left_m, coalesce(r.length_left_source, r.length_source),
         r.qty, r.qty_left, r.kg_per_m,
         coalesce(r.price_per_unit, m.price_per_unit), r.price_per_m,
         r.location, r.status, r.created_at,
         coalesce(m.fact_color, m.color)
    from public.erp_material_rolls r
    join public.erp_materials m on m.id = r.material_id
    join public.erp_orders o on o.id = m.order_id
   where r.leftover_kind = 'usable'
     and r.status = 'used'
     and coalesce(r.length_left_m, r.qty_left, 0) > 0
     and (select public.erp_is_member())
   order by coalesce(m.fact_name, m.name), r.created_at;
$$;
comment on function public.erp_fabric_leftovers() is
  'Пригодные остатки ткани по всем заказам, включая закрытые (правка 28.09) — для экрана «Остатки ткани» и выбора остатка закроем';
revoke execute on function public.erp_fabric_leftovers() from public, anon;
grant execute on function public.erp_fabric_leftovers() to authenticated;
