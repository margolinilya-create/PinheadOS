-- Несколько независимых черновиков заказа (правка заказчика 22.08, п. 5.5).
--
-- ЧТО БЫЛО НЕ ТАК. Черновик формы жил в ОДНОМ ключе localStorage
-- (`erp_order_draft`), поэтому «Новый заказ» при наличии незапущенного заказа
-- восстанавливал предыдущий: «в итоге пользователь не может параллельно
-- подготовить два разных заказа». Плюс черновик был привязан к браузеру —
-- начал на планшете, продолжить с ноутбука нельзя.
--
-- ПОЧЕМУ НЕ «ЗАКАЗ СО СТАТУСОМ DRAFT». Заказчик просил хранить черновики
-- в базе, и они здесь. Но `erp_orders.status` знает только
-- `active/done_*/cancelled`, и новый статус означал бы фильтр в полутора
-- десятках поверхностей — канбан, очередь цеха, план, загрузка, дашборд,
-- бейджи меню, realtime, гейты отгрузки. Один забытый фильтр — и черновик,
-- у которого нет ни маршрута, ни ТЗ, уезжает в производство. Документ той же
-- итерации требует прямо: «не менять существующую бизнес-логику и механику
-- ERP, если это прямо не указано».
--
-- Поэтому черновик — СВОЯ таблица с JSON-снимком формы. Заказом он
-- не является и ни в одну производственную выборку не попадает
-- по построению, а не по внимательности.
--
-- ФАЙЛОВ В ЧЕРНОВИКЕ НЕТ, как и раньше: File-объекты не сериализуются,
-- а загруженные в бакет вложения принадлежат заказу, которого ещё нет.
-- Форма говорит об этом прямым текстом при закрытии.

create table if not exists public.erp_order_drafts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid(),
  -- Заголовок для списка: название заказа или № сделки, что заполнено
  title text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists erp_order_drafts_author_idx
  on public.erp_order_drafts(author_id, updated_at desc);

alter table public.erp_order_drafts enable row level security;

-- Черновик — личная работа менеджера: чужие незаконченные заказы в списке
-- только мешают. Админ видит всё — он же и разбирает завалы.
create policy erp_order_drafts_read on public.erp_order_drafts
  for select using (author_id = (select auth.uid()) or public.is_admin());
create policy erp_order_drafts_insert on public.erp_order_drafts
  for insert with check (
    author_id = (select auth.uid()) and public.erp_has_permission('order.manage')
  );
create policy erp_order_drafts_update on public.erp_order_drafts
  for update using (author_id = (select auth.uid()))
  with check (author_id = (select auth.uid()));
create policy erp_order_drafts_delete on public.erp_order_drafts
  for delete using (author_id = (select auth.uid()) or public.is_admin());

create trigger erp_order_drafts_touch
  before update on public.erp_order_drafts
  for each row execute function public.erp_set_updated_at();
