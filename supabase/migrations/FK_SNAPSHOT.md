# Эталон внешних ключей `erp_*` на боевой базе

**Снято:** 2026-09-24 с `pinhead-os-v2` (`pg_constraint`, `contype = 'f'`).
**Записей:** 100.

## Зачем этот файл

Миграция `20260825192641 baseline_fk_matches_prod` помечена в `APPLIED.json`
как `fileLost`: она применена к проду 25.08, файла в репозитории нет, и текст
невосстановим — в отличие от соседних, это не определение функции, а
выравнивание внешних ключей, и `pg_get_functiondef` тут не поможет. Писать
файл «по смыслу» нельзя: он выполнялся бы при реплее на чистое окружение,
а содержимое было бы догадкой.

Из этого следует, что **реплей миграций на чистую базу воспроизводит прод
не полностью**, и величина расхождения до сих пор была неизвестной.

Текст потерянной миграции этот файл не возвращает. Он возвращает её
**эффект**: теперь известно, как выглядит прод, и расхождение можно
не предполагать, а измерить.

## Как сверить

1. Прогнать миграции на чистой базе (локальный `supabase start` либо ветка).
2. Снять тем же запросом список ключей:

```sql
select c.relname as t, con.conname as c, pg_get_constraintdef(con.oid) as def
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and con.contype = 'f' and c.relname like 'erp\_%'
 order by 1, 2;
```

3. Сравнить с разделом ниже. Расхождение — это и есть то, что потеряно
   вместе с миграцией; закрывать его надо НОВОЙ выравнивающей миграцией,
   а не правкой этого файла.

Обновлять файл — после каждой миграции, меняющей внешние ключи, тем же
порядком, что и `APPLIED.json` (см. `supabase/migrations/README.md`).

## Эталон

Формат: `таблица · ограничение · определение`.

```
erp_bypasses · erp_bypasses_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_calendar_slots · erp_calendar_slots_department_id_fkey · FOREIGN KEY (department_id) REFERENCES erp_departments(id)
erp_calendar_slots · erp_calendar_slots_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE CASCADE
erp_chat_mentions · erp_chat_mentions_message_id_fkey · FOREIGN KEY (message_id) REFERENCES erp_chat_messages(id) ON DELETE CASCADE
erp_chat_mentions · erp_chat_mentions_user_id_fkey · FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
erp_chat_message_reads · erp_chat_message_reads_message_id_fkey · FOREIGN KEY (message_id) REFERENCES erp_chat_messages(id) ON DELETE CASCADE
erp_chat_message_reads · erp_chat_message_reads_user_id_fkey · FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
erp_chat_messages · erp_chat_messages_author_id_fkey · FOREIGN KEY (author_id) REFERENCES profiles(id)
erp_chat_messages · erp_chat_messages_experimental_id_fkey · FOREIGN KEY (experimental_id) REFERENCES erp_experimental(id) ON DELETE SET NULL
erp_chat_messages · erp_chat_messages_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE SET NULL
erp_chat_messages · erp_chat_messages_reply_to_fkey · FOREIGN KEY (reply_to) REFERENCES erp_chat_messages(id) ON DELETE SET NULL
erp_chat_messages · erp_chat_messages_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE SET NULL
erp_chat_messages · erp_chat_messages_thread_id_fkey · FOREIGN KEY (thread_id) REFERENCES erp_chat_threads(id) ON DELETE CASCADE
erp_chat_reactions · erp_chat_reactions_message_id_fkey · FOREIGN KEY (message_id) REFERENCES erp_chat_messages(id) ON DELETE CASCADE
erp_chat_reactions · erp_chat_reactions_user_id_fkey · FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
erp_chat_reads · erp_chat_reads_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE CASCADE
erp_chat_reads · erp_chat_reads_thread_id_fkey · FOREIGN KEY (thread_id) REFERENCES erp_chat_threads(id) ON DELETE CASCADE
erp_chat_reads · erp_chat_reads_user_id_fkey · FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
erp_chat_subscriptions · erp_chat_subscriptions_thread_id_fkey · FOREIGN KEY (thread_id) REFERENCES erp_chat_threads(id) ON DELETE CASCADE
erp_chat_subscriptions · erp_chat_subscriptions_user_id_fkey · FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
erp_chat_threads · erp_chat_threads_experimental_id_fkey · FOREIGN KEY (experimental_id) REFERENCES erp_experimental(id) ON DELETE CASCADE
erp_chat_threads · erp_chat_threads_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_departments · erp_departments_head_employee_id_fkey · FOREIGN KEY (head_employee_id) REFERENCES erp_employees(id) ON DELETE SET NULL
erp_employees · erp_employees_department_id_fkey · FOREIGN KEY (department_id) REFERENCES erp_departments(id)
erp_employees · erp_employees_profile_id_fkey · FOREIGN KEY (profile_id) REFERENCES profiles(id)
erp_experimental · erp_experimental_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_experimental · erp_experimental_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_experimental_tasks · erp_experimental_tasks_department_id_fkey · FOREIGN KEY (department_id) REFERENCES erp_departments(id)
erp_experimental_tasks · erp_experimental_tasks_experimental_id_fkey · FOREIGN KEY (experimental_id) REFERENCES erp_experimental(id) ON DELETE CASCADE
erp_experimental_tasks · erp_experimental_tasks_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE SET NULL
erp_invites · erp_invites_department_id_fkey · FOREIGN KEY (department_id) REFERENCES erp_departments(id) ON DELETE SET NULL
erp_item_labels · erp_item_labels_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_item_prints · erp_item_prints_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_item_stages · erp_item_stages_department_id_fkey · FOREIGN KEY (department_id) REFERENCES erp_departments(id)
erp_item_stages · erp_item_stages_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_material_receipts · erp_material_receipts_material_id_fkey · FOREIGN KEY (material_id) REFERENCES erp_materials(id) ON DELETE CASCADE
erp_material_rolls · erp_material_rolls_material_id_fkey · FOREIGN KEY (material_id) REFERENCES erp_materials(id) ON DELETE CASCADE
erp_material_rolls · erp_material_rolls_receipt_id_fkey · FOREIGN KEY (receipt_id) REFERENCES erp_material_receipts(id) ON DELETE SET NULL
erp_material_suppliers · erp_material_suppliers_material_id_fkey · FOREIGN KEY (material_id) REFERENCES erp_materials(id) ON DELETE CASCADE
erp_materials · erp_materials_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_materials · erp_materials_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_notifications · erp_notifications_message_id_fkey · FOREIGN KEY (message_id) REFERENCES erp_chat_messages(id) ON DELETE CASCADE
erp_notifications · erp_notifications_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_notifications · erp_notifications_user_id_fkey · FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_experimental_id_fkey · FOREIGN KEY (experimental_id) REFERENCES erp_experimental(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_label_id_fkey · FOREIGN KEY (label_id) REFERENCES erp_item_labels(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_material_id_fkey · FOREIGN KEY (material_id) REFERENCES erp_materials(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_message_id_fkey · FOREIGN KEY (message_id) REFERENCES erp_chat_messages(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_note_id_fkey · FOREIGN KEY (note_id) REFERENCES erp_order_notes(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_print_id_fkey · FOREIGN KEY (print_id) REFERENCES erp_item_prints(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE CASCADE
erp_order_attachments · erp_order_attachments_task_id_fkey · FOREIGN KEY (task_id) REFERENCES erp_experimental_tasks(id) ON DELETE CASCADE
erp_order_audit · erp_order_audit_changed_by_id_fkey · FOREIGN KEY (changed_by_id) REFERENCES profiles(id) ON DELETE SET NULL
erp_order_audit · erp_order_audit_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_order_comments · erp_order_comments_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_order_items · erp_order_items_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_order_items · erp_order_items_sku_card_id_fkey · FOREIGN KEY (sku_card_id) REFERENCES erp_sku_cards(id)
erp_order_notes · erp_order_notes_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_order_shipments · erp_order_shipments_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_order_shipments · erp_order_shipments_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_orders · erp_orders_created_by_fkey · FOREIGN KEY (created_by) REFERENCES profiles(id)
erp_orders · erp_orders_tz_order_id_fkey · FOREIGN KEY (tz_order_id) REFERENCES orders(id) ON DELETE SET NULL
erp_plan_comments · erp_plan_comments_slot_id_fkey · FOREIGN KEY (slot_id) REFERENCES erp_calendar_slots(id) ON DELETE CASCADE
erp_procurement_tasks · erp_procurement_tasks_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE SET NULL
erp_procurement_tasks · erp_procurement_tasks_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_procurement_tasks · erp_procurement_tasks_source_stage_id_fkey · FOREIGN KEY (source_stage_id) REFERENCES erp_item_stages(id) ON DELETE SET NULL
erp_sku_card_files · erp_sku_card_files_attachment_id_fkey · FOREIGN KEY (attachment_id) REFERENCES erp_order_attachments(id) ON DELETE SET NULL
erp_sku_card_files · erp_sku_card_files_card_id_fkey · FOREIGN KEY (card_id) REFERENCES erp_sku_cards(id) ON DELETE CASCADE
erp_sku_card_files · erp_sku_card_files_created_by_fkey · FOREIGN KEY (created_by) REFERENCES profiles(id)
erp_sku_card_versions · erp_sku_card_versions_author_id_fkey · FOREIGN KEY (author_id) REFERENCES profiles(id)
erp_sku_card_versions · erp_sku_card_versions_card_id_fkey · FOREIGN KEY (card_id) REFERENCES erp_sku_cards(id) ON DELETE CASCADE
erp_sku_cards · erp_sku_cards_created_by_fkey · FOREIGN KEY (created_by) REFERENCES profiles(id)
erp_sku_cards · erp_sku_cards_experimental_id_fkey · FOREIGN KEY (experimental_id) REFERENCES erp_experimental(id) ON DELETE SET NULL
erp_sku_cards · erp_sku_cards_source_item_id_fkey · FOREIGN KEY (source_item_id) REFERENCES erp_order_items(id) ON DELETE SET NULL
erp_stage_events · erp_stage_events_actor_id_fkey · FOREIGN KEY (actor_id) REFERENCES profiles(id) ON DELETE SET NULL
erp_stage_events · erp_stage_events_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_stage_events · erp_stage_events_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE CASCADE
erp_stage_report_rolls · erp_stage_report_rolls_material_id_fkey · FOREIGN KEY (material_id) REFERENCES erp_materials(id) ON DELETE SET NULL
erp_stage_report_rolls · erp_stage_report_rolls_report_id_fkey · FOREIGN KEY (report_id) REFERENCES erp_stage_reports(id) ON DELETE CASCADE
erp_stage_report_rolls · erp_stage_report_rolls_roll_id_fkey · FOREIGN KEY (roll_id) REFERENCES erp_material_rolls(id) ON DELETE SET NULL
erp_stage_report_sizes · erp_stage_report_sizes_report_id_fkey · FOREIGN KEY (report_id) REFERENCES erp_stage_reports(id) ON DELETE CASCADE
erp_stage_report_sizes · erp_stage_report_sizes_report_roll_id_fkey · FOREIGN KEY (report_roll_id) REFERENCES erp_stage_report_rolls(id) ON DELETE CASCADE
erp_stage_reports · erp_stage_reports_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE CASCADE
erp_stage_reports · erp_stage_reports_warehouse_task_id_fkey · FOREIGN KEY (warehouse_task_id) REFERENCES erp_warehouse_tasks(id) ON DELETE CASCADE
erp_subcontract_moves · erp_subcontract_moves_subcontract_id_fkey · FOREIGN KEY (subcontract_id) REFERENCES erp_subcontracting(id) ON DELETE CASCADE
erp_subcontracting · erp_subcontracting_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE SET NULL
erp_subcontracting · erp_subcontracting_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_subcontracting · erp_subcontracting_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE SET NULL
erp_tz_documents · erp_tz_documents_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE CASCADE
erp_tz_documents · erp_tz_documents_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_tz_documents · erp_tz_documents_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE CASCADE
erp_warehouse_ops · erp_warehouse_ops_material_id_fkey · FOREIGN KEY (material_id) REFERENCES erp_materials(id) ON DELETE SET NULL
erp_warehouse_ops · erp_warehouse_ops_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_warehouse_tasks · erp_warehouse_tasks_item_id_fkey · FOREIGN KEY (item_id) REFERENCES erp_order_items(id) ON DELETE SET NULL
erp_warehouse_tasks · erp_warehouse_tasks_material_id_fkey · FOREIGN KEY (material_id) REFERENCES erp_materials(id) ON DELETE CASCADE
erp_warehouse_tasks · erp_warehouse_tasks_order_id_fkey · FOREIGN KEY (order_id) REFERENCES erp_orders(id) ON DELETE CASCADE
erp_warehouse_tasks · erp_warehouse_tasks_stage_id_fkey · FOREIGN KEY (stage_id) REFERENCES erp_item_stages(id) ON DELETE CASCADE
```
