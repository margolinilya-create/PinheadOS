-- Аудит (security, A5): kind/counts_as_purchase — производные от cause_type и не
-- должны задаваться клиентом произвольно (иначе можно исказить учёт закупок:
-- пометить реальную закупку как «не закупка компании»). Форсим на сервере триггером.
-- supplier_defect → replacement / counts_as_purchase=false; прочее → restock / true.

create or replace function public.erp_procurement_task_derive()
returns trigger
language plpgsql
as $$
begin
  if new.cause_type = 'supplier_defect' then
    new.kind := 'replacement';
    new.counts_as_purchase := false;
  else
    new.kind := 'restock';
    new.counts_as_purchase := true;
  end if;
  return new;
end;
$$;

create trigger erp_procurement_task_derive_biu
  before insert or update on public.erp_procurement_tasks
  for each row execute function public.erp_procurement_task_derive();
