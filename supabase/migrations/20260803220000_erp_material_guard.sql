-- Приёмка материала начинает требовать права `material.receive` НА СЕРВЕРЕ.
--
-- Хвост волны 2 правок менеджера. Кнопка «Материал поступил» гейтится правом
-- material.receive только в React, а политика `erp_materials_update` требует
-- лишь `erp_is_member()`. То есть любой участник ERP, умеющий позвать REST —
-- включая рабочего и кадры, — мог проставить приёмку и СНЯТЬ МАТЕРИАЛЬНЫЙ ГЕЙТ
-- цеха: закрой уходил в работу по ткани, которой склад не видел.
--
-- Триггером, а не политикой, по той же причине, что у плана и этапов: RLS
-- работает на уровне строки и не различает, какие колонки изменились. Правку
-- закупочных полей (артикул, ожидаемое количество, ответственный, срок, статус
-- заказа у поставщика) страж не трогает — это работа снабжения, и правом
-- `material.receive` она в интерфейсе не гейтится.
--
-- Границу проводим ровно там, где её проводит интерфейс (правило проекта:
-- страж разрешает то же, что кнопка). Приёмочные колонки пишут только два пути,
-- и оба уже под правом: `acceptMaterial` (карточка склада и карточка ожидания
-- в очереди цеха) и `confirmStockMaterial` («Наличие» на экране закупки).
-- Экран закупки читает qty_received, но никогда его не пишет.

create or replace function public.erp_material_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Пустой auth.uid() — это service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя. То же решение, что в erp_calendar_guard.
  if (select auth.uid()) is null then
    return new;
  end if;

  if public.erp_has_permission('material.receive') then
    return new;
  end if;

  -- Приёмка складом: снимает гейт и фиксирует, ЧТО и КЕМ принято.
  -- Факт-атрибуты (пересорт, расхождение с планом) — часть той же записи:
  -- подделать «принято другое» без права нельзя.
  if new.accept_status  is distinct from old.accept_status
     or new.accepted_at   is distinct from old.accepted_at
     or new.accepted_by   is distinct from old.accepted_by
     or new.accept_comment is distinct from old.accept_comment
     or new.qty_received  is distinct from old.qty_received
     or new.fact_name     is distinct from old.fact_name
     or new.fact_color    is distinct from old.fact_color
     or new.fact_article  is distinct from old.fact_article
  then
    raise exception 'erp_material_guard: приёмка материала требует права material.receive'
      using errcode = '42501';
  end if;

  -- «Доступен со склада» снимает гейт МИНУЯ приёмку (materialPending считает
  -- reserved годным сразу), поэтому это тоже решение склада, а не цеха.
  if new.status = 'reserved' and old.status is distinct from 'reserved' then
    raise exception 'erp_material_guard: подтверждение наличия требует права material.receive'
      using errcode = '42501';
  end if;

  return new;
end $$;

drop trigger if exists erp_materials_guard on public.erp_materials;
create trigger erp_materials_guard before update on public.erp_materials
  for each row execute function public.erp_material_guard();

comment on function public.erp_material_guard() is
  'Приёмка материала (accept_*, qty_received, fact_*, переход в reserved) требует права material.receive. Закупочные поля страж не трогает.';
