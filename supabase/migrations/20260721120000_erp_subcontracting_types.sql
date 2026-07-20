-- Правки ПМ (волна 3), правка 1: разделить подряд на два типа операций
-- (готовое изделие / отдельная операция) и учесть источник материалов
-- (Pinhead / подрядчик). При материалах подрядчика заказ не проходит закупку Pinhead.

alter table public.erp_subcontracting
  add column op_type text not null default 'operation'
    check (op_type in ('finished_product', 'operation')),
  add column material_source text not null default 'pinhead'
    check (material_source in ('pinhead', 'contractor')),
  -- код цеха, на который заказ возвращается после «отдельной операции»
  -- (null для готового изделия — оно идёт только на внутренние этапы)
  add column return_dept text;
