# Схема ERP подробно — таблицы, колонки, уборка Storage

Текст перенесён из корневого `CLAUDE.md` дословно (09.10), без единой правки: корневой файл читается на каждом запросе любой сессии, а здесь — справочник, который открывают по теме. В корне осталась короткая выжимка со ссылкой сюда.

⚠️ Правило, записанное позже, отменяет более раннее; сверяйте с живой базой.

---

## Таблицы ERP

**ERP (префикс `erp_*`, проект pinhead-os-v2)** — полная схема в
`pinhead-react/src/erp/types.ts` (зеркало таблиц) и в `supabase/migrations/`.
Ядро: `erp_departments` · `erp_orders` (+ `customer`) · `erp_order_items`
(+ техблок изделия: `fit`, `trim_material`, `cutting_note`, `sewing_note`,
`labels_note`, и упаковка позиции `packaging`/`packaging_note`, где `inherit` —
«как в заказе») · `erp_item_stages` (граф `depends_on`, `queue_position` —
приоритет в очереди цеха, `assignee` — исполнитель, `executor`/`contractor`/
`operation` — наш цех или подрядчик) · `erp_materials` (+ разделение полей
менеджера и закупщика: `manager_note`, `qty_ordered`, `ordered_on`). Сопровождение: `erp_item_prints`,
`erp_stage_events` (история этапов), `erp_order_audit`/`_comments`/`_attachments` (у вложений есть `item_id` и вид
`preview|attachment|packaging|tech|purchase`),
`erp_procurement_tasks`, `erp_subcontracting` (карточка подрядчика ПРИ этапе:
`stage_id`, фаза `planned…ready_at_contractor…closed`, материалы
`pinhead|contractor|mixed`, журнал `erp_subcontract_moves`), `erp_warehouse_ops`/`_tasks`,
`erp_experimental`(+`_ops`), `erp_employees`, `erp_role_permissions` (матрица прав),
`erp_dictionaries` (справочники админки: причины блокировок, типы проблем, типы изделий,
поставщики, единицы измерения, крой изделия, операции маршрута), `erp_stage_reports` (журнал результатов этапов и складских
задач), `erp_material_receipts` (частичная приёмка материалов), `erp_subcontract_moves`
(перемещения по подряду), `erp_settings` (настройки производства key/value: общая мощность
в изделиях за месяц), `erp_calendar_slots` (производственный план: этап × день,
план/факт/брак, проблема) + `erp_plan_comments` (переписка по задаче дня), `erp_material_suppliers` (варианты поставщиков на позицию закупки, ровно один
`is_selected`), `erp_client_errors` (отчёты об ошибках интерфейса от `lib/errorReport`: вставка — вошедший от своего имени, чтение — `staff.invite`, вкладка админки «Ошибки»; ни UPDATE, ни DELETE, правка 24.09), `erp_tz_documents` (ТЗ в PDF: версии внутри `group_id`, документ
принадлежит позиции — `item_id`, либо всему заказу при `item_id = null`),
`erp_experimental.branding_note` («Комментарий по проработке» — необязательный
результат этапа проработки, который читает цех нанесения в своём задании,
правка 13.09),
`erp_order_items.garment_source` третьим значением `stock` («Склад готовой
продукции», правка 14.09: закупки нет, склад ВЫДАЁТ изделие — в отличие
от `customer`, где он его ПРИНИМАЕТ), вид вложения `production` («Файлы
производства») со стражем `erp_attachment_guard` (правится только `kind`
и только между `attachment` и `production`), право `files.manage` и роль
`designer`,
`erp_chat_threads`/`erp_chat_messages`/`erp_chat_mentions`/`erp_chat_reads`
(чат внутри сделки, правка 14.09: сообщение принадлежит ТРЕДУ — тогда привязка
разработки к сделке не требует копирования переписки; единственный писатель —
`erp_chat_send`, у сообщений нет ни INSERT-, ни UPDATE-, ни DELETE-политики;
отметок прочтения две — на тред и на этап), вид вложения `chat`
с `erp_order_attachments.message_id`, `erp_notifications` (+`message_id`,
уникальность `(user_id, message_id)`),
`erp_sku_cards`/`erp_sku_card_versions`/`erp_sku_card_files` (каталог моделей
ERP, правка 14.09: карточка отвечает на «как это шьётся», прайс-каталог
визарда `app_config.sku_catalog` — на «сколько стоит», связь по `code`;
`experimental_id` уникален, `card_version` и `pattern_version` — РАЗНЫЕ
величины; историю пишет триггер, DELETE-политики нет) + `erp_order_items.sku_card_id`
(ссылка, а не замена полей),
`erp_experimental_tasks` (задачи разработки: параллельные, необязательные,
`depends_on` внутри разработки, `cycle` — круг доработки, `stage_id` — задача,
ушедшая в цех; её статус ведёт триггер).
`erp_tz_assignments` и `erp_experimental_ops` **удалены 2026-08-12** вместе
с фазовой моделью: первая была пуста с 03.08, вторая перенесена в задачи.

## Уборка Storage

Уборка ничьих объектов `erp-attachments` — edge-функция `storage-gc`
(гейт `is_admin()`, сухой прогон по умолчанию, возрастной гейт сутки) либо
`npm run storage:gc` с ключом `service_role` из окружения. Правила — раздел
«Правила уборки данных и файлов». Носителей ключа ЧЕТЫРЕ (`erp_order_attachments`,
`erp_tz_documents`, `erp_sku_card_files` — карточка модели ссылается на файл
разработки снимком пути, без копии, — и `erp_order_drafts.payload`:
`attachments[].path`/`tzDocs[].path` черновика, `JSON_REFERENCES`, правка 28.09),
и список сторожится тестом `erp/utils/storageGc.test.ts`: колонки `file_path`
он выводит из миграций (правка 24.09, сессия 67), массивы черновика — из формы
`OrderDraftEnvelope`. Уборщиков ДВА — edge-функция и `scripts/storage-gc.mjs`, — и
сторож читает ОБА: до сессии 68 он видел только функцию, и скрипт остался
с двумя носителями. Клиентские удаления объекта идут через `freeOfSkuCards`;
ошибка проверки = ничего не удалять.

