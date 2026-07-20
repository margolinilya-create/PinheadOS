-- Правки ПМ (волна 3), правка 6: экспериментальный цех — отдельная воронка разработки
-- с фазами и возвратами на «Проработку». Не моделируется через erp_item_stages
-- (UNIQUE(item_id, department_id) не допускает циклов) — отдельная сущность-стейт-машина.

create table public.erp_experimental (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  -- фаза воронки: лекала → проработка → финальная примерка → готово;
  -- returned_to_constructor — возврат конструктору при «изменение лекал»
  phase text not null default 'patterns'
    check (phase in ('patterns','development','final_fitting','returned_to_constructor','done')),
  tech_name text,               -- тех. название лекал (для запуска в Bitrix)
  measurement_table text,       -- табель мер (текст/ссылка)
  has_3d boolean not null default false,
  constructor text,             -- ответственный конструктор
  technologist text,            -- ответственный технолог
  final_outcome text
    check (final_outcome in ('approved','needs_rework','needs_rebranding','needs_pattern_change','ready_for_serial')),
  constructor_return_comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index erp_experimental_order_idx on public.erp_experimental (order_id);
create index erp_experimental_phase_idx on public.erp_experimental (phase);

create trigger erp_experimental_touch before update on public.erp_experimental
  for each row execute function public.erp_set_updated_at();

alter table public.erp_experimental enable row level security;
create policy erp_experimental_read on public.erp_experimental
  for select to authenticated using (true);
create policy erp_experimental_insert on public.erp_experimental
  for insert to authenticated with check (true);
create policy erp_experimental_update on public.erp_experimental
  for update to authenticated using (true) with check (true);
create policy erp_experimental_delete on public.erp_experimental
  for delete to authenticated using (public.is_admin());
