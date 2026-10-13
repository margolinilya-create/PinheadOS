-- Цена ткани обязательна при заведении закупки (правка заказчика 21.09, п. 1).
--
-- Документ: «поле „Цена за кг, ₽" сделать обязательным для сохранения закупки
-- ткани». По этой цене считается себестоимость полотна (`erp_item_economics`)
-- и стоимость возвратного остатка заказа — без неё обе выходят прочерком,
-- а прочерк в экономике читается как «бесплатно».
--
-- ТОЛЬКО НА INSERT, и это не смягчение. На бою 21.09 десять тканей из
-- семнадцати заведены без цены: требование при каждом UPDATE заперло бы их
-- целиком — нельзя было бы даже поменять поставщика или отметить приход.
-- Правило проекта «страж разрешает ровно то, что разрешает интерфейс»
-- выполняется: гейт формы стоит тоже на заведении строки.
--
-- Пустой `auth.uid()` пропускается: это service_role, он и так минует RLS,
-- и запирать через него починку данных нельзя (правило раздела).

create or replace function public.erp_material_price_required()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;
  if new.kind = 'fabric'
     and new.source = 'purchase'
     and coalesce(new.price_per_unit, 0) <= 0 then
    raise exception 'Укажите цену ткани: по ней считается себестоимость полотна и остаток'
      using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists erp_materials_price_required on public.erp_materials;
create trigger erp_materials_price_required
  before insert on public.erp_materials
  for each row execute function public.erp_material_price_required();

revoke execute on function public.erp_material_price_required() from public, anon, authenticated;
