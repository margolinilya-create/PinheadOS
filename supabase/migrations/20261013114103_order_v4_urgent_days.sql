-- Order v4: срочный пошив по дням сокращения срока (правка CRM 13.10, п. 6).
-- Столбец; функция order_v4_save — следующей миграцией order_v4_save_urgent_days.
alter table public.orders
  add column if not exists urgent_days smallint not null default 0;
alter table public.orders
  drop constraint if exists orders_urgent_days_check;
alter table public.orders
  add constraint orders_urgent_days_check check (urgent_days in (0, 5, 10, 15));
-- Заказы, отмеченные срочными до правки, — 5 дней (так их считает клиент)
update public.orders set urgent_days = 5
 where schema_version = 4 and urgent and urgent_days = 0;
