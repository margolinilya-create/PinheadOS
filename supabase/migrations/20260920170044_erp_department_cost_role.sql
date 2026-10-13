-- РОЛЬ УЧАСТКА В СЕБЕСТОИМОСТИ (правка заказчика 20.09, п. 9).
--
-- Экономике позиции нужно знать, ОТКУДА брать расход полотна и откуда —
-- стоимость сборки. Это свойство участка, и живёт оно В ДАННЫХ, рядом
-- с `result_fields`, `result_detail` и `gate_material_kinds`: правило раздела
-- запрещает держать в коде константы вида «закрой → ткань».
--
-- Переиспользовать `result_detail = 'sizes'` нельзя: ВТО и ОТК однажды тоже
-- станут сдавать результат по размерам, и их отчёты молча попадут в «пошив»,
-- удвоив стоимость сборки.

alter table public.erp_departments
  add column if not exists cost_role text
    check (cost_role is null or cost_role in ('fabric', 'assembly'));

comment on column public.erp_departments.cost_role is
  'Роль участка в себестоимости: fabric — его отчёты дают расход полотна, assembly — стоимость сборки. NULL — участок в расчёт не входит (правка 20.09, п. 9).';

update public.erp_departments set cost_role = 'fabric'   where code = 'cutting';
update public.erp_departments set cost_role = 'assembly' where code = 'sewing';
