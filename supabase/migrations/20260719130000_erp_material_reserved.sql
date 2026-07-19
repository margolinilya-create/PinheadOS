-- Правки ПМ (волна 2), правка 4: материал «Со склада» после подтверждения наличия
-- переходит в статус «Доступен со склада» (reserved) и открывает закрой.
-- Расширяем CHECK статусов erp_materials новым значением 'reserved'.

alter table public.erp_materials drop constraint erp_materials_status_check;
alter table public.erp_materials add constraint erp_materials_status_check
  check (status in ('pending','ordered','in_transit','received','partial','not_needed','reserved'));
