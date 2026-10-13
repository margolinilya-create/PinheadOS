/**
 * АУДИТ МАТЕРИАЛА ЧИТАЛ КОЛОНКУ, КОТОРОЙ НЕТ.
 *
 * Найдено 10.09 по жалобе из раздела «Закупка»: при сохранении материала
 * приходило `column "price" not found in data type erp_materials`, и правка
 * не сохранялась.
 *
 * `20260906193413_erp_audit_live_columns` расширила список отслеживаемых
 * величин материала и назвала цену `price`. Такой колонки в `erp_materials`
 * нет и не было: цена за единицу — `price_per_unit` (заведена
 * `20260810200000`), а `price` живёт в СОСЕДНЕЙ `erp_material_suppliers`.
 * Миграция заводилась ради того, чтобы журнал писал ЖИВУЮ колонку, —
 * подрядную половину она сделала верно, а материальную сломала.
 *
 * Цена дефекта не косметическая. `erp_log_changes` читает поле динамически
 * (`execute format('select ($1).%I…')`) и делает это ДО сравнения old/new,
 * поэтому цикл доходил до несуществующего имени при ЛЮБОЙ правке. Триггер
 * `after update`, исключение откатывает транзакцию целиком — то есть падал
 * КАЖДЫЙ UPDATE строки `erp_materials` с непустым `order_id`, включая
 * приёмку складом (`erp_material_accept`) и роллап журнала приёмок
 * (`erp_material_receipts_rollup`), а с ним и вставку в сам журнал.
 * В `erp_order_audit` за всё время не появилось ни одной записи `material.%`.
 *
 * Поле не убираем, а называем верно: журнал 06.09 расширяли именно ради
 * «сколько заказали, когда и почём».
 *
 * Список остальных колонок перенесён ДОСЛОВНО из действующего определения
 * в базе (`pg_get_triggerdef`), а не написан по памяти. Сама функция
 * `erp_log_changes` не меняется — дефект был в аргументах триггера.
 *
 * Сторож — `pinhead-react/src/erp/utils/auditCoverage.test.ts`: он сверяет
 * КАЖДОЕ имя поля обоих аудит-механизмов с колонками `database.generated.ts`.
 * До 10.09 он читал одну захардкоженную миграцию и существование колонок
 * не проверял вовсе — поэтому и молчал.
 */

drop trigger if exists erp_materials_audit on public.erp_materials;
create trigger erp_materials_audit
  after update on public.erp_materials
  for each row execute function public.erp_log_changes(
    'order_id', 'material',
    'status', 'accept_status', 'qty_expected', 'qty_received',
    'qty_ordered', 'ordered_on', 'price_per_unit',
    'eta_date', 'supplier', 'responsible', 'name', 'kind');
