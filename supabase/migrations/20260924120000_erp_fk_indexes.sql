-- Индексы под внешние ключи `erp_*` (код-ревью 23.09, находка 10).
--
-- Двадцать внешних ключей не имели покрывающего индекса. Сверка сделана
-- не по адвизору, а по каталогу: для каждого `contype = 'f'` искался индекс,
-- чьи ведущие колонки совпадают с колонками ключа.
--
-- ЗАЧЕМ ЭТО НУЖНО, ЕСЛИ ВЫБОРОК ПО КОЛОНКЕ НЕТ. Индекс под внешним ключом
-- работает не только на чтение. Postgres проверяет ссылки при удалении
-- и изменении РОДИТЕЛЬСКОЙ строки, и без индекса каждая такая проверка —
-- полный скан дочерней таблицы под блокировкой. В этом проекте родителей
-- удаляют по-настоящему: edge-функция `admin-users` сносит строку `profiles`
-- (на неё смотрят `created_by`, `author_id`, `user_id` в семи таблицах),
-- `erp_chat_delete` убирает вложения и уведомления сообщения, склад удаляет
-- приёмки. Поэтому индексы заводятся и там, где колонка не участвует
-- ни в одном списочном запросе.
--
-- ПРО «НЕИСПОЛЬЗУЕМЫЕ ИНДЕКСЫ». Адвизор производительности показывает
-- шестнадцать индексов с нулевым счётчиком обращений, и часть новых, скорее
-- всего, встанет рядом. Это ожидаемо и не делает их лишними: счётчик
-- `pg_stat_user_indexes` считает обращения планировщика, а проверки
-- ссылочной целостности в него не попадают. Снимать индекс под внешним
-- ключом по этому счётчику нельзя.
--
-- Все индексы `if not exists` и с обычным `create` (не `concurrently`):
-- миграция применяется в транзакции, а таблицы на бою малы — счёт строк
-- идёт на сотни, а не на миллионы.

-- ── Чат: растёт быстрее всех в разделе ──
create index if not exists erp_chat_mentions_user_idx
  on public.erp_chat_mentions (user_id);
create index if not exists erp_chat_messages_item_idx
  on public.erp_chat_messages (item_id);
create index if not exists erp_chat_messages_experimental_idx
  on public.erp_chat_messages (experimental_id);
create index if not exists erp_chat_reactions_user_idx
  on public.erp_chat_reactions (user_id);
create index if not exists erp_chat_reads_user_idx
  on public.erp_chat_reads (user_id);
create index if not exists erp_chat_reads_stage_idx
  on public.erp_chat_reads (stage_id);
create index if not exists erp_chat_subscriptions_user_idx
  on public.erp_chat_subscriptions (user_id);

-- ── Уведомления: строка на каждое сообщение и событие ──
create index if not exists erp_notifications_order_idx
  on public.erp_notifications (order_id);
create index if not exists erp_notifications_message_idx
  on public.erp_notifications (message_id);

-- ── Рулоны и размерный факт: заведены 16.09 и 21.09, растут с каждой сдачей ──
create index if not exists erp_material_rolls_receipt_idx
  on public.erp_material_rolls (receipt_id);
create index if not exists erp_stage_report_rolls_material_idx
  on public.erp_stage_report_rolls (material_id);
create index if not exists erp_stage_report_sizes_report_roll_idx
  on public.erp_stage_report_sizes (report_roll_id);

-- ── Каталог моделей: строк немного, но `profiles` удаляют, и ссылки на автора
--    проверяются при каждом таком удалении ──
create index if not exists erp_sku_cards_created_by_idx
  on public.erp_sku_cards (created_by);
create index if not exists erp_sku_cards_source_item_idx
  on public.erp_sku_cards (source_item_id);
create index if not exists erp_sku_card_versions_author_idx
  on public.erp_sku_card_versions (author_id);
create index if not exists erp_sku_card_files_created_by_idx
  on public.erp_sku_card_files (created_by);
create index if not exists erp_sku_card_files_attachment_idx
  on public.erp_sku_card_files (attachment_id);

-- ── Остальные: заказ и цех как родители ──
create index if not exists erp_bypasses_order_idx
  on public.erp_bypasses (order_id);
create index if not exists erp_invites_department_idx
  on public.erp_invites (department_id);
create index if not exists erp_experimental_tasks_department_idx
  on public.erp_experimental_tasks (department_id);
