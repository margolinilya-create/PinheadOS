# Правила сессии 61 (правки 14.09, PR 1): где что лежит


- **Чьё готовое изделие** — `erp/utils/garmentSource.ts`, теперь ТРИ значения.
  Новое — `stock` («Склад готовой продукции»): закупки нет, этап склада есть,
  и склад его ВЫДАЁТ. Разбор перечислением (`garmentSourceOf`), следствия
  разведены по вопросам: `itemNeedsPurchase` (`=== 'purchased'`, не отрицание
  давальческого), `needsGarmentIntake` (нужен ли этап склада сам по себе),
  `garmentIntakeAction` + `GARMENT_INTAKE_LABELS` (принять или выдать).
  Читают: `utils/routes` (`skipSupply`, `needsIntake`), `orderForm`,
  `screens/warehouse/FgIntakeQueue` (подпись кнопки и заголовок секции),
  `orderCard/OrderItemSection` и `queue/TzBlock` (бейдж печатается любому
  незакупаемому сценарию; `purchased` молчит — это умолчание)
- **Подписи количеств закупки** — `screens/purchasing/purchaseLabels.js`:
  `qtyExpected` → «Количество к заказу» (потребность), `qtyOrdered` →
  «Фактическое количество» (по счёту). Сторож `purchaseLabels.test.ts`
  проверяет ОБЕ поимённо и читает исходник модалки «Новая закупка»:
  полей два, обязательна потребность, факт едет подстановкой до первой
  правки (`factTouched`)
- **Папки файлов заказа** — `erp/utils/orderFolders.ts` (`ORDER_FOLDERS`,
  `folderOf`, `filesInFolder`, `canMoveBetweenFolders`, `kindForFolder`,
  `moveTargetOf`). Раскладка fail-open: незнакомый вид остаётся видимым.
  Ходят между папками ТОЛЬКО `attachment` и `production` — у макета есть
  адресат (`print_id`). Разметка — `screens/orderCard/FilesSection.jsx`
  (загрузка при выборе файла, удаление через `confirm`, перемещение),
  действия стора — `orderWriteSlice`: `uploadOrderAttachment(…, kind)`,
  `deleteOrderAttachment`, `moveOrderAttachment`
- **Право `files.manage`** (`permissionKeys.ts`, `DEFAULT_PERMISSIONS`, seed
  миграции `20260914211947`) и **роль `designer`** — в `DEPT_BOUND_ROLES`
  она НЕ входит, посадочная у неё `/orders` (`utils/landing`). Серверная
  половина: политика UPDATE + страж `erp_attachment_guard`; сторож паритета —
  `utils/orderFolders.test.ts`, блок «серверный страж вложений»
- **Уникальность складских задач** — сторож `utils/warehouseTaskUniqueness.test.ts`:
  предикат `erp_warehouse_tasks_order_type_idx` обязан нести
  `material_id is null`, у позиционной приёмки своя уникальность,
  а писатель не полагается на `on conflict (order_id, task_type)`

