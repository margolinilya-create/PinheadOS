-- Создание заказа: основная ткань, несколько бирок, макет у каждого нанесения
-- (правки заказчика 22.08, пункты 5.1–5.3).
--
-- 5.1 ОСНОВНАЯ ТКАНЬ. В техблоке позиции есть «Отделочный материал»
-- (`trim_material`), а поля для основного полотна нет вовсе — при том, что
-- ТЗ заказчика начинается именно с него («Шерпа 100%пэ 240гр»). Писали его
-- в свободные заметки или не писали совсем. Колонка отдельная: у изделия
-- бывает и основное полотно, и отделка, и одно поле на двоих означает, что
-- цех прочитает половину.
--
-- 5.2 МАКЕТ ПРИНАДЛЕЖИТ НАНЕСЕНИЮ. Файлы лежали общей кучей вида `tech`
-- у позиции, и при трёх-четырёх нанесениях цех сам угадывал, какой макет
-- к какому относится. Связь — `erp_order_attachments.print_id`, тем же
-- приёмом, что `material_id` у строк закупки и `stage_id` у подрядного этапа.
--
-- 5.3 БИРОК БЫВАЕТ НЕСКОЛЬКО. Хранилось одно текстовое поле `labels_note`,
-- а в заказе обычно размерник, составник, брендовая и бирка по уходу —
-- у каждой своё расположение, размер и макет. Заведена `erp_item_labels`,
-- повторяемая, как `erp_item_prints`.
--
-- `labels_note` ОСТАЁТСЯ и не переносится автоматически: в нём лежит
-- свободный текст заведённых заказов, и разложить его по полям может только
-- человек. Карточка показывает его как «Бирки (старое поле)», пока не
-- опустеет, — тем же порядком снимался реестр подряда.

alter table public.erp_order_items
  add column if not exists main_fabric text;

comment on column public.erp_order_items.main_fabric is
  'Основное полотно изделия. Отдельно от trim_material: у изделия бывает и основная ткань, и отделочная';

-- Бирки позиции. RLS и права — дословно как у `erp_item_prints`: это такой же
-- повторяемый блок ТЗ, и разные правила у соседних блоков одной карточки
-- означали бы, что половина её редактируется, а половина нет.
create table if not exists public.erp_item_labels (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.erp_order_items(id) on delete cascade,
  seq int not null default 1,
  label_type text,
  place text,
  size text,
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists erp_item_labels_item_idx on public.erp_item_labels(item_id);

alter table public.erp_item_labels enable row level security;

-- Политика пишется НА КОМАНДУ (правило проекта): `for all` рядом с отдельным
-- `select` заставляет Postgres проверять обе на каждый SELECT
create policy erp_item_labels_read on public.erp_item_labels
  for select using (public.erp_is_member());
create policy erp_item_labels_insert on public.erp_item_labels
  for insert with check (public.erp_has_permission('order.manage'));
create policy erp_item_labels_update on public.erp_item_labels
  for update using (public.erp_has_permission('order.manage'))
  with check (public.erp_has_permission('order.manage'));
create policy erp_item_labels_delete on public.erp_item_labels
  for delete using (public.erp_has_permission('order.manage'));

-- Файл принадлежит конкретному нанесению или конкретной бирке.
-- `on delete cascade`: удалили нанесение — его макет больше ни к чему
-- не относится, а вложение без владельца это платный файл, доступный
-- по ссылке и никому не принадлежащий.
alter table public.erp_order_attachments
  add column if not exists print_id uuid references public.erp_item_prints(id) on delete cascade,
  add column if not exists label_id uuid references public.erp_item_labels(id) on delete cascade;

create index if not exists erp_order_attachments_print_idx
  on public.erp_order_attachments(print_id) where print_id is not null;
create index if not exists erp_order_attachments_label_idx
  on public.erp_order_attachments(label_id) where label_id is not null;

-- Тип бирки — справочник: подсказка поверх свободного ввода, значения
-- отключаются, а не удаляются. Вид живёт в ЧЕТЫРЁХ местах (CHECK базы,
-- `DictionaryKind`, подпись, `KINDS` в админке) — пропуск последнего даёт
-- молча отсутствующую вкладку, и это уже случалось с единицами измерения.
alter table public.erp_dictionaries
  drop constraint if exists erp_dictionaries_kind_check;
alter table public.erp_dictionaries
  add constraint erp_dictionaries_kind_check
  check (kind in (
    'block_reason', 'problem_type', 'product_type', 'supplier', 'unit',
    'experimental_task_type', 'route_operation', 'label_type'
  ));

insert into public.erp_dictionaries (kind, code, name, sort_order, active)
values
  ('label_type', 'size', 'Размерник', 10, true),
  ('label_type', 'composition', 'Составник', 20, true),
  ('label_type', 'brand', 'Брендовая бирка', 30, true),
  ('label_type', 'care', 'Бирка по уходу', 40, true),
  ('label_type', 'extra', 'Дополнительная бирка', 50, true)
on conflict do nothing;
