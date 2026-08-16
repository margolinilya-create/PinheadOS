-- Смешанный источник материалов принимает и ПОЗИЦИЯ, а не только карточка
-- подряда (правки заказчика 16.08, блок 2).
--
-- НАЙДЕНО ПРОВЕРКОЙ НА БОЕВОЙ БАЗЕ. Миграция 20260816130000 расширила
-- `material_source` до трёх значений у `erp_subcontracting` — и только у неё.
-- А выбирает источник менеджер В ФОРМЕ ЗАКАЗА, то есть значение пишется прежде
-- всего в `erp_order_items.material_source`, где CHECK остался на двух. Заказ
-- со смешанными материалами не создавался вовсе: 23514 на вставке позиции,
-- ещё до единого этапа.
--
-- Дефект этого рода не виден ни в типах (в клиенте перечисление ОДНО на оба
-- поля — `SubcontractMaterialSource`), ни в тестах на маршрут: `mixed` ведёт
-- себя как `pinhead`, и вся клиентская логика с ним работает правильно.
-- Расходились именно две половины схемы.
--
-- Смысл значения тот же, что у карточки подряда: часть материалов наша, часть
-- подрядчика. Для маршрута это `pinhead` — закупка нужна, раз хоть что-то наше;
-- сравнение в `buildItemRoute` идёт именно с `'contractor'`, поэтому расширение
-- перечисления маршрут не трогает.
alter table public.erp_order_items
  drop constraint if exists erp_order_items_material_source_check;

alter table public.erp_order_items
  add constraint erp_order_items_material_source_check
  check (material_source in ('pinhead', 'contractor', 'mixed'));

comment on column public.erp_order_items.material_source is
  'Кто даёт материалы: pinhead | contractor | mixed. Закупка вырезается из маршрута ТОЛЬКО при contractor — при mixed часть материалов наша.';
