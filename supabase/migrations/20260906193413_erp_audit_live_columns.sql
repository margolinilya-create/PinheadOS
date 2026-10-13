/**
 * ЖУРНАЛ ПИШЕТ ЖИВУЮ КОЛОНКУ И ТО, РАДИ ЧЕГО ЗАВЕДЁН.
 *
 * Найдено 05.09 на боевой базе.
 *
 * 1. ПОДРЯД ВЁЛСЯ В МЁРТВОМ СЛОВАРЕ. Триггер следил за `status` — колонкой,
 *    помеченной `@deprecated` ещё 10.08, когда работу стала вести `phase`.
 *    В истории заказа копились `received_at_pinhead`, `ready_to_ship`,
 *    `awaiting_materials` — слова, которых нет ни в интерфейсе, ни даже
 *    в перечислении `SubcontractPhase`. 37 записей.
 *    Старые записи НЕ переписываются: история не редактируется задним числом,
 *    а клиент показывает их через legacy-словарь.
 *
 * 2. ЖУРНАЛ НЕ ВИДЕЛ ВЕЛИЧИН, РАДИ КОТОРЫХ ЗАВЕДЁН.
 *    У материала не следил за `qty_ordered`, `ordered_on`, `price` —
 *    «сколько заказали, когда и почём» следа не оставляло вовсе.
 *    У подряда не следил за `qty_sent`, `qty_returned`, `qty_defect` —
 *    то есть за самой сутью подряда: сколько отдали, сколько вернулось,
 *    сколько брака. Оставался только `qty` (план).
 *
 * Список колонок — аргументы триггера, поэтому пересоздаём сами триггеры;
 * функция `erp_log_changes` не меняется.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ФАЙЛ ВОССТАНОВЛЕН 07.09 ПО ПОДЛИННОМУ ТЕКСТУ ИЗ ЖУРНАЛА ПРОДА
 * (`supabase_migrations.schema_migrations.statements`), а не написан заново
 * по смыслу. Миграцию применили к базе 06.09 через MCP и не завели файл —
 * ТРЕТИЙ такой случай в проекте (13.08, 18.08). Нашла сверка
 * `npm run migrations:verify`: снимок 212 записей против 213 в базе.
 * Ровно то, ради чего сверка и заведена; без неё репозиторий продолжал бы
 * описывать систему, которой в проде нет, и реплей на чистое окружение
 * дал бы базу без этих двух триггеров.
 */

drop trigger if exists erp_subcontracting_audit on public.erp_subcontracting;
create trigger erp_subcontracting_audit
  after update on public.erp_subcontracting
  for each row execute function public.erp_log_changes(
    'order_id', 'subcontract',
    'phase', 'contractor', 'qty', 'qty_sent', 'qty_returned', 'qty_defect',
    'planned_date', 'returned_date', 'delay_comment');

drop trigger if exists erp_materials_audit on public.erp_materials;
create trigger erp_materials_audit
  after update on public.erp_materials
  for each row execute function public.erp_log_changes(
    'order_id', 'material',
    'status', 'accept_status', 'qty_expected', 'qty_received',
    'qty_ordered', 'ordered_on', 'price',
    'eta_date', 'supplier', 'responsible', 'name', 'kind');
