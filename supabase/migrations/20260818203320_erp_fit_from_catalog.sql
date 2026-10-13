-- ВОССТАНОВЛЕНО ИЗ БАЗЫ 20.08. Миграция применена к проду 18.08.2026, но
-- в репозиторий не попала: `supabase_migrations.schema_migrations` знала о ней,
-- а `supabase/migrations/` — нет. Текст взят из журнала миграций дословно,
-- шапка добавлена при восстановлении.
--
-- Крой изделия подсказывает КАТАЛОГ, а не справочник.
-- Сверено с боевой базой до применения: справочник fit (Regular, Oversize,
-- Free Fit) полностью покрывается каталогом SKU (classic, free, oversize,
-- regular). В заказах крой хранится текстом (erp_order_items.fit), внешнего
-- ключа нет — уже заведённые позиции не задеты.
-- Вид product_type СОХРАНЁН: в нём есть Рубашка, Фартук и Кепка, которых
-- в каталоге нет ни одной.

delete from public.erp_dictionaries where kind = 'fit';

alter table public.erp_dictionaries
  drop constraint if exists erp_dictionaries_kind_check;
alter table public.erp_dictionaries
  add constraint erp_dictionaries_kind_check
  check (kind in ('block_reason', 'problem_type', 'product_type', 'supplier',
                  'unit', 'experimental_task_type', 'route_operation'));
