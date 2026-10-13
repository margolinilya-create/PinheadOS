-- Заметки к заказу (правка заказчика 22.08, п. 5.8).
--
-- ЗАЧЕМ. «Есть информация, которую невозможно нормально разложить
-- по структурированным полям. Например фото фурнитуры, референсы, пояснения
-- по биркам, общий внешний вид упаковки, нестандартные инструкции
-- и изображения с комментариями».
--
-- ЭТО НЕ ЗАМЕНА СТРУКТУРНЫМ ПОЛЯМ, и документ говорит это прямо: основная
-- ткань, нанесения, бирки и упаковка продолжают заполняться в своих полях.
-- Заметки нужны ровно для того, что структурировать нельзя, — иначе они
-- станут свалкой, из которой цех будет вычитывать ТЗ.
--
-- ЗАМЕТКА ПРИНАДЛЕЖИТ ЗАКАЗУ, а не позиции: «заметки должны относиться
-- ко всему заказу». Изображения — обычные вложения с `note_id`, тем же
-- приёмом, что макет нанесения: у каждого своя подпись, поэтому картинка
-- привязана к КОНКРЕТНОЙ заметке, а не к общей куче.
--
-- ПОРЯДОК ХРАНИТСЯ (`seq`): «менять порядок заметок и изображений» — прямое
-- требование, а порядок, выведенный из времени создания, переставить нельзя.

create table if not exists public.erp_order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.erp_orders(id) on delete cascade,
  seq int not null default 1,
  text text,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_order_notes_order_idx
  on public.erp_order_notes(order_id, seq);

alter table public.erp_order_notes enable row level security;

-- Читают все участники (заметки — часть ТЗ для цеха), правит тот, кто ведёт
-- заказ. Политика на КОМАНДУ, `auth.uid()` не вызывается построчно.
create policy erp_order_notes_read on public.erp_order_notes
  for select using (public.erp_is_member());
create policy erp_order_notes_insert on public.erp_order_notes
  for insert with check (public.erp_has_permission('order.manage'));
create policy erp_order_notes_update on public.erp_order_notes
  for update using (public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('order.manage'));
create policy erp_order_notes_delete on public.erp_order_notes
  for delete using (public.erp_has_permission('order.manage'));

create trigger erp_order_notes_touch
  before update on public.erp_order_notes
  for each row execute function public.erp_set_updated_at();

alter table public.erp_order_attachments
  add column if not exists note_id uuid
    references public.erp_order_notes(id) on delete cascade;

create index if not exists erp_order_attachments_note_idx
  on public.erp_order_attachments(note_id) where note_id is not null;
