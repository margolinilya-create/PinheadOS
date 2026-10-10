# Журнал правок схемы Supabase по датам (24.08–05.10)

Текст перенесён из корневого `CLAUDE.md` дословно (09.10), без единой правки: корневой файл читается на каждом запросе любой сессии, а здесь — справочник, который открывают по теме. В корне осталась короткая выжимка со ссылкой сюда.

⚠️ Правило, записанное позже, отменяет более раннее; сверяйте с живой базой.

---

Записи идут от новой к старой, как стояли в разделе «Supabase — схема».

Правки 05.10 (сессия 78) — **передаётся факт, а не план**: выход этапа —
`qty_done`; прозрачный этап (`erp_item_stages.qty_passthrough`: пропущенный,
непроизводственный, файловый, старый закрытый с нулём; ведёт триггер
`erp_stage_passthrough`) передаёт свой вход. `erp_stage_input_qty` →
`erp_stage_input_qty_d` (рекурсия), `erp_stage_output_qty`,
`erp_item_produced_qty` (выпущено по позиции — предел склада ГП и отгрузки),
`erp_item_production_closed`; потолок `erp_clamp_stage_qty` — вход этапа
(кроме закроя, прозрачных и меток `erp.moving`/`erp.subcontract_rollup`);
`erp_stage_unaccounted` — от принятого, когда предшественники закрыты;
`erp_ship_order` не отгружает больше выпущенного. Правила —
`docs/rules/pravila-pravok-05-10-sessiya-78.md`.

Правки 01.10 (сессия 77, PR #195): ткань без единицы учитывается рулонами
(`erp_material_tracks_rolls(kind, unit)` — зеркало `materialTracksRolls`);
`erp_material_rolls_add` (`security definer`, `material.receive`) заводит рулоны
к ПРИНЯТОЙ ткани без новой строки журнала приходов, ключ попытки —
`erp_material_rolls.add_key`. DELETE-политика `erp_order_attachments` открыта
`order.manage` для файлов формы заказа (зеркало — `utils/attachmentRights.ts`),
`erp_tz_document_remove` снимает ТЗ (`is_current = false` у группы).
Чат: `erp_chat_messages.author_id` допускает NULL — системное сообщение «ERP»
(его правку и удаление держит страж `erp_chat_system_guard` на таблице — десятый страж, BEFORE UPDATE); `erp_chat_mark_seen` гасит
и личные уведомления о показанных сообщениях; упоминание и ответ не глушатся
режимом `none`; `erp_user_settings` (звук/окно браузера, RLS на себя);
`erp_overdue_requests` + `erp_overdue_requests_run()` (`pg_cron` 06:00 UTC) —
запрос причины просрочки один раз на срок.

Правки 27.09 (сессия 72, PR 2) перевели **учёт полотна на погонные метры**
(отменяет правило 20.09 «пересчёта единиц система не делает»): закупка
по-прежнему вводит кг и цену за кг (`erp_materials.price_per_unit` — цена
по единице материала, плюс `width_cm`/`density_gsm` как умолчания для
рулонов), метры — свойство РУЛОНА: `erp_material_rolls.length_m` +
`length_source` (`calc`/`supplier`/`measured`), `length_calc_m`, `kg_per_m`
(+`_source`), `length_left_m` (+`_source`), `price_per_m` — считает
`erp_roll_recalc` по `erp_fabric_kg_per_m` (кг × 1000 / (ширина_м ×
плотность); зеркало — `utils/fabricMetres.ts`), пересчёт полной точности,
округление только в показе. `erp_material_accept(…, p_roll_weights,
p_roll_params jsonb)` принимает на рулон вес + ширину/плотность/метраж
поставщика; `erp_material_roll_set_params` (`security definer`,
`material.receive` ЛИБО `stage.progress`) дозаполняет и уточняет: до
первого расхода — пересчёт, после — корректировка `length_refine` и новые
коэффициенты для остатка (списанное не трогается). Журнал
`erp_material_roll_adjustments` (`length_refine`/`leftover_measure`/
`scrap_writeoff`, причина, автор, `item_id` у списания) — корректировки
К РАСХОДУ НЕ ПРИБАВЛЯЮТСЯ. `erp_stage_report_rolls.length_used_m` +
снимки `kg_per_m`/`price_per_m`/`cost` (правка справочника закрытые строки
не меняет); `qty_used` (кг) остался для прежнего пути (`qty_source =
entered`). `erp_stage_submit_report(…, p_client_key)` — ключ попытки
(`erp_stage_reports.client_key`, уникальный частичный индекс): повтор
не списывает дважды; отказы «Не заполнены данные для учёта в метрах…»,
«доступно N м, а списывается M м…», «остался N м — выберите …» — тексты
общие с формой закроя. Экономика и аналитика: `erp_fabric_usage`
(метры, `calc_metres` — кг-строки, пересчитанные по коэффициенту рулона,
`incomplete_kg` — непересчитанные), `erp_analytics_overview`/`_series`
в метрах (`fabric_per_item` по отчётам закроя, `fabric_incomplete`),
`erp_analytics_fabric_by_sku` (модель × материал × ширина),
`erp_item_economics` → `fabric{…}`, `losses{leftovers_usable, leftovers_scrap,
adjustments, extras, defects, wip}` («в работе» — только начатые этапы),
`production_done`, `preliminary`, `costs{fabric, scrap, assembly, total,
missing}`, `unit_cost_good` (затраты / годные + годные плюсы),
`unit_cost_plan` (затраты / клиентский тираж). Пригодный остаток в затраты
не входит. Проба на бою и четыре правки по её итогам (grant `erp_roll_recalc`,
INSERT-политика журнала, `array_append`, WIP) — `SESSION-STATE.md`.

Сверка документа 27.09 по подпунктам (28.09) добавила: `erp_material_rolls.location`
(место хранения, пишет `erp_material_roll_set_location`), `erp_material_roll_adjustments.qty_kg/
confirmed_at/confirmed_by`; у журнала корректировок **один писатель** — `erp_roll_adjustment_add`
под меткой транзакции `erp.roll_adjust` (INSERT-политика снята); `erp_roll_set_leftover`
(судьба остатка рулона «в работе» — малый остаток списанием на позицию),
`erp_roll_adjustment_confirm` (остаточная стоимость → затраты позиции, `economics.view`),
`erp_material_roll_set_params(…, p_weight_kg)` (чистый вес обязателен при метраже; расход в кг
учитывается при уточнении), `erp_stage_submit_report` проверяет, ЧЕЙ рулон (свой, пригодный
остаток или уже взятый) и снова открывает взятый остаток; `erp_fabric_leftovers()` (остатки
по всем заказам), `erp_order_foreign_rolls(order)` (чужие рулоны, взятые заказом),
`erp_stage_unaccounted_by_size` (разбивка — только если сходится с итогом),
`erp_stage_after_role` (этап после сборки — для брака и незавершёнки). Программа вышивки
держит только `p_final` (закрытие), не сдачу части.

Правки 27.09 (сессия 72, PR 1) добавили **серверные гейты закрытия**:
`erp_supply_autoclose` (триггер на `erp_materials`: закупка закрывается САМА,
когда все материалы заказа `erp_material_fully_received` — `accepted_full`
и `qty_received ≥ qty_expected`; идёт под меткой `erp.supply_autoclose`,
которую `erp_stage_guard` пропускает только для перехода этапа `supply`
в `done`), `erp_stage_unaccounted` (не учтено = greatest(тираж, принято) −
сдано − брак; обе RPC сдачи закрывают этап по нему, а не по тиражу),
`erp_stage_size_output`/`erp_stage_size_input` (размеры сквозь нанесение —
зеркало `sizeInputFor`), `erp_stage_rolls_fate_block` (судьба остатков
рулонов при закрытии последнего этапа участка), `erp_stage_program_block`
(вышивка ждёт «Разработку программы» той же позиции),
`erp_stage_completion_block(uuid, int, p_final)` с четырьмя ветками
и триггер `erp_stage_done_gate` на прямом переходе в `done` (пропуск
service role и меток `erp.force_complete`/`erp.moving`/
`erp.subcontract_rollup`/`erp.supply_autoclose`). Это ГЕЙТЫ «можно ли
закрыть», а не стражи колонок — стражей по-прежнему девять.

Правки 21.09 (сессия 65) добавили **вес рулона, остаток полотна и плюс
закроя**: `erp_material_rolls.qty` теперь заполняется приёмкой (`erp_material_accept`
принимает `p_roll_weights` — пары «рулон → вес», сумма сверяется с приходом),
плюс `qty_left` (остаток, ведёт сервер), `leftover_kind` (`usable`/`scrap`;
NULL — рулон ещё в работе) и `price_per_unit` (снимок цены материала
на момент приёмки: поздняя правка цены иначе перепишет себестоимость уже
закрытых заказов). Рулонам, принятым ДО правки, вес дозаполняет склад —
`erp_material_rolls_set_weights` (`security definer`, право `material.receive`).
`erp_stage_submit_report` при сдаче закроя проверяет расход НАКОПИТЕЛЬНО
(`qty_used ≤ qty − уже израсходованное`; fail-open у рулона без веса),
пересчитывает `qty_left` и ставит `leftover_kind`; `erp_stage_report_sizes.qty_extra`
и `erp_stage_reports.qty_extra` несут производственный «плюс» (превышение
тиража), который раскладывается по рулонам в порядке `erp_material_rolls.seq`,
а не по uuid. Экономика (`erp_item_economics`/`erp_order_economics`) отдаёт
`leftover` и `qty_extra`, стоимость остатка считается по цене КОНКРЕТНОГО
рулона. Цена у `erp_materials` обязательна для `kind = 'fabric'` — триггер
`erp_material_price_required` **только на INSERT**: десять тканей
из семнадцати на бою заведены без цены, и страж на UPDATE запер бы их правку.
Плюс `erp_size_grid_merge` (разовая склейка дублей `(color, size)` в четырёх
колонках сеток) и `erp_size_grid_cells`.

Правки 20.09 (сессия 64) добавили **идемпотентную отгрузку, экономику
и поштучное прочтение чата**: уникальность `erp_order_shipments` переехала
на `(client_key, item_id)` (одна попытка = одна строка НА ПОЗИЦИЮ; прежний
ключ без `item_id` ронял `23505` на любом заказе из ≥2 позиций),
`erp_materials.size_grid_ordered` (факт «сколько заказано у поставщика
по размерам» — отдельно от `size_grid`, где лежит потребность из заказа),
`erp_stage_reports.assembly_cost_per_unit` (цена ЭТОЙ сдачи; колонка позиции
остаётся итоговой, иначе средневзвешенную не посчитать),
`erp_departments.cost_role` (`fabric`/`assembly` — роль участка
в себестоимости, свойство В ДАННЫХ рядом с `result_detail`),
права `stage.force_complete` (админ и директор; RPC `erp_stage_force_complete`
с обязательной причиной + ветка в `erp_stage_guard`) и `economics.view`
(вкладка «Экономика позиции», функции `erp_item_economics`/
`erp_order_economics`; отбор «основное полотно» fail-open — `role = 'main'`
ЛИБО `role is null и kind = 'fabric'`, потому что `role` заполнена
у одной строки из двадцати пяти).
Чат: `erp_chat_message_reads` (прочтение ПОШТУЧНО: `(message_id, user_id)`;
watermark `erp_chat_reads` остаётся — по ней считаются текущие счётчики),
`erp_chat_subscriptions` (режим на заказ: `all`/`mentions`/`none`, отсутствие
строки = `mentions`, то есть сегодняшнее поведение), вид уведомления
`chat_message`, `erp_chat_unread` переписана на формулу «позже водяной
отметки И без строки receipts» (одна проверка «нет receipt» в утро выката
вывалила бы всю историю как непрочитанную) и отдаёт `mentions`
и `first_unread_id`; плюс `erp_chat_unread_many` (счётчики списка заказов
одним запросом), `erp_chat_mark_seen`, `erp_chat_read_receipts`
(`security definer`: «Прочитали N» иначе не собрать — свои строки видит
только автор).

Вторая очередь чата (та же сессия 64) добавила **правку, удаление, реакции
и поиск**: `erp_chat_messages.edited_at`/`deleted_at` (удаление ЗАТИРАЕТ `body`
и уносит упоминания, файлы и уведомления сообщения, но НЕ строку — на неё
ссылаются цитаты), RPC `erp_chat_edit`/`erp_chat_delete` (`security definer`,
гейт «только автор»: политик у сообщений по-прежнему нет),
`erp_chat_reactions` (ключ — тройка `(message_id, user_id, emoji)`; здесь
политики уместны, подделать можно ровно «Иван поставил палец») + `erp_chat_react`
(переключает по `row_count` самого `delete`) и `erp_chat_reaction_people`,
`erp_chat_search` (`pg_trgm` + GIN по `body`: в цеху ищут по обрывку, а
`to_tsvector` по части слова не находит; удалённые не ищутся), плюс
`erp_chat_reactions` в `supabase_realtime` — это единственное в переписке,
что меняется чужими руками без нового сообщения.

Правки 16.09 (сессия 63) добавили **размерный факт и рулоны**:
`erp_stage_report_sizes` (результат этапа по размерам: отчёт × ЦВЕТ × размер —
одна таблица на приёмку склада, раскрой и пошив, потому что по ней считается
аналитика и проверка «сшито+брак+переделка ≤ принято по размеру»),
`erp_material_rolls` (рулоны принятой партии: склад заводит приёмкой, номер
сквозной внутри материала, число рулонов НЕ хранится — это `count(*)`),
`erp_stage_report_rolls` (расход ткани с рулона; отдельно от размеров, потому
что расход у рулона ОДИН, а размеров несколько),
`erp_materials.kind = 'finished_good'` + `size_grid` (закупка готового изделия
одной строкой с разбивкой; `qty_expected` при сетке считает триггер),
`erp_material_receipts.size_grid` (факт прихода по размерам — складывается,
а не перезаписывается), `erp_departments.result_detail` (`rolls`/`sizes` —
детализация результата участка, свойство В ДАННЫХ рядом с `result_fields`),
`erp_order_items.assembly_cost_per_unit` (фактическая стоимость сборки,
единственный писатель — `erp_stage_submit_report` через узкую ветку стража),
право `analytics.view` и функции раздела «Аналитика» (`erp_analytics_released`
определяет выпуск ОДИН раз для всех сводок). Признак «единица учитывается
рулонами» — в `erp_dictionaries.meta.rolls`, а не списком в коде: в `unit`
на бою лежат и код («кг»), и имя («Килограммы») одного значения.

Правки 12.09 (вторая порция, сессия 57) добавили: `erp_warehouse_tasks.material_id`
(приёмка материалов принадлежит ПОЗИЦИИ закупки и заводится её переходом
в `in_transit`), `erp_item_stages.result_kind` (`embroidery_program` — результат
этапа файл, а не штуки), `erp_departments.allows_over_plan` (участок может сдать
больше тиража — включён у закроя), вид вложения `stage_result` (файл, который цех
СДАЁТ, в отличие от `subcontract` — тех, что подрядчику отдают) и функцию
`erp_stage_input_qty` (серверное зеркало клиентского `stageInputQty`; с 27.09 рядом
`erp_stage_size_input` — по размерам, и `erp_stage_unaccounted` — «не учтено»).

Правки 07.09 (сессия 52) добавили: размер упаковки в мм у заказа и позиции
(`packaging_width_mm`/`packaging_height_mm`), `erp_item_prints.garment_kind`
(тип изделия у вышивки: на крое и полотне / на готовых / шевроны; эффект
шелкографии живёт в существующей `special`) и вид справочника `print_effect`.
Участок `dtg` ДЕАКТИВИРОВАН (`active = false`), роль `dtg` убрана из CHECK
`erp_employees.role` и `erp_invites.employee_role`; значение метода
`erp_item_prints.method = 'dtg'` осталось читаемым. Кладовщик получил
`stage.take` и `stage.complete` — у склада появился этап маршрута (приёмка
готового изделия перед нанесением). Плюс `erp_order_items.garment_source`
(п. 4: `customer` — давальческое, изделие клиента; `purchased` — закупаем мы;
NULL читается как `purchased`) — у давальческого из маршрута уходит `supply`,
а приёмка склада обязательна даже без нанесений. Не путать
с `material_source`: та про материал ПОДРЯДЧИКА.

Правки 24.08 (сессия 41) добавили: `erp_experimental.board_stage` (колонка
канбана ЭКС, поставленная технологом вручную; NULL — считается из задач),
`erp_order_attachments.task_id` + вид вложения `dev_task` (файл задачи
разработки), тип складской задачи `subcontract_send` («Передача подрядчику» —
зеркало приёмки, п. 3) и ключ `final_package.add_to_sku` (переключатель
карточки SKU, от него зависит обязательность её полей).
