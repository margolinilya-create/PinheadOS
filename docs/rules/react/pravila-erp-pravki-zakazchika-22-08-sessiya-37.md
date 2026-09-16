# Правила ERP (правки заказчика 22.08, сессия 37)


- Подряд: `utils/outsourcing.stageLocation` — «где заказ сейчас» по ФАЗЕ,
  а не по маршруту; `subcontractShortfall` отдаёт три величины
  (`lost` · `awaitingAccept` · `defect`), брак берётся из хранимого
  `qty_defect`. Раскрытая карточка — `screens/subcontracting/StageDetails`
  (шапка + одно главное действие + свёрнутые блоки), служебные блоки живут
  в `MoveJournal` как отдельные экспортируемые компоненты
- Приёмка подряда складом — `receiveSubcontract` → RPC
  `erp_subcontract_receive`: принято и брак ОДНОЙ транзакцией
- ЭКС: карточка разработки — СТРАНИЦА `screens/DevPage.jsx`
  (`/experimental/:devId`, через `lazyScreen`), шторки нет; `?dev=<id>`
  переадресует. Основной маршрут — `screens/experimental/DevStageRoute`,
  задачи разделены на этапные и дополнительные (`extraTasks`)
- ЭКС: завершение задачи `patterns` требует технического названия лекал
  (`DevCard.updateTask` → `pattern_tech_name`); новая задача получает
  ответственного разработки по умолчанию
- Форма заказа: `emptyPrint()`/`emptyLabel()` вместо константы — у каждой
  строки СВОЙ ключ, по нему привязывается макет (`print_key`/`label_key`
  → `print_index`/`label_index` в payload). Бирки — `LabelsBlock`,
  заметки заказа — `screens/orders/create/NotesSection`
- Черновики формы — `store/slices/orderDraftsSlice` + таблица
  `erp_order_drafts`; `normalizeDraft` чинит снимок и из localStorage,
  и из базы. Список черновиков — на странице заказов
- `utils/progress.stageCountProgress` — «завершено N из M этапов»
  (сумма по штукам осталась в подсказке)

