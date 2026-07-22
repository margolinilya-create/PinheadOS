-- Правка ПМ 4.1.3, склад: авто-заполнение плановых данных при приёмке материалов.
-- Плановые данные (материал/цвет/артикул/кол-во) вносит закупщик в этапе «Закупка»
-- и они read-only приходят в задачу приёмки. Кладовщик вносит только ФАКТ.
-- qty_expected (план, кг) и qty_received (факт, кг) + accept_comment уже есть
-- (20260721130000_erp_material_acceptance.sql). Добавляем недостающие графы:
--   план (закупка): color, article  (name/qty_expected уже есть);
--   факт (склад):   name_actual, color_actual, article_actual (qty_received уже есть).
alter table public.erp_materials
  add column color text,           -- плановый цвет (закупка)
  add column article text,         -- плановый артикул (закупка)
  add column name_actual text,     -- фактически поступивший материал (склад)
  add column color_actual text,    -- фактический цвет (склад)
  add column article_actual text;  -- фактический артикул (склад)

comment on column public.erp_materials.color is 'План (закупка): цвет материала';
comment on column public.erp_materials.article is 'План (закупка): артикул материала';
comment on column public.erp_materials.qty_expected is 'План (закупка): планируемое кол-во, кг — обязательно для source=purchase';
comment on column public.erp_materials.name_actual is 'Факт (склад): фактически поступивший материал';
comment on column public.erp_materials.color_actual is 'Факт (склад): фактический цвет';
comment on column public.erp_materials.article_actual is 'Факт (склад): фактический артикул';
