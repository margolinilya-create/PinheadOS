-- Волна 3, правка 10: несколько вариантов поставщика на одну позицию закупки
-- и выбор итогового.
--
-- До сих пор поставщик был одним свободным текстовым полем erp_materials.supplier —
-- сравнить предложения было негде, история запросов терялась. Теперь варианты живут
-- отдельными строками, а выбранный дублируется в erp_materials.supplier, чтобы все
-- существующие экраны (закупка, план приёмки, карточка заказа) показывали его без правок.
--
-- Поля сравнения — базовый набор, утверждённый заказчиком: поставщик, цена, наличие,
-- срок поставки, минимальная партия. Наличие и минимальная партия — текст: поставщики
-- отвечают свободной формой («200 кг на складе», «от 50 кг»), а не перечислением.

create table if not exists public.erp_material_suppliers (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.erp_materials(id) on delete cascade,
  supplier text not null,
  /** Цена за единицу закупки (кг/м/шт — как ведётся материал) */
  price numeric,
  availability text,
  /** Срок поставки в днях */
  lead_days int,
  min_batch text,
  note text,
  is_selected boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_material_suppliers_material_idx
  on public.erp_material_suppliers (material_id);
-- Итоговый поставщик у позиции ровно один
create unique index if not exists erp_material_suppliers_selected_idx
  on public.erp_material_suppliers (material_id) where is_selected;

drop trigger if exists erp_material_suppliers_touch on public.erp_material_suppliers;
create trigger erp_material_suppliers_touch before update on public.erp_material_suppliers
  for each row execute function public.erp_set_updated_at();

alter table public.erp_material_suppliers enable row level security;

-- Читают все авторизованные (выбранный поставщик виден складу и цеху),
-- ведёт закупка — правки под теми же правилами, что и сами материалы.
drop policy if exists erp_material_suppliers_read on public.erp_material_suppliers;
create policy erp_material_suppliers_read on public.erp_material_suppliers
  for select to authenticated using (true);
drop policy if exists erp_material_suppliers_insert on public.erp_material_suppliers;
create policy erp_material_suppliers_insert on public.erp_material_suppliers
  for insert to authenticated with check (true);
drop policy if exists erp_material_suppliers_update on public.erp_material_suppliers;
create policy erp_material_suppliers_update on public.erp_material_suppliers
  for update to authenticated using (true) with check (true);
drop policy if exists erp_material_suppliers_delete on public.erp_material_suppliers;
create policy erp_material_suppliers_delete on public.erp_material_suppliers
  for delete to authenticated using (true);

do $$
begin
  alter publication supabase_realtime add table public.erp_material_suppliers;
exception
  when duplicate_object then null;
end $$;

-- Бэкфилл: уже заведённый поставщик становится первым (и выбранным) вариантом,
-- иначе история закупок выглядела бы так, будто поставщика никогда не было.
insert into public.erp_material_suppliers (material_id, supplier, is_selected)
select m.id, m.supplier, true
  from public.erp_materials m
 where coalesce(trim(m.supplier), '') <> ''
   and not exists (
     select 1 from public.erp_material_suppliers s where s.material_id = m.id
   );
