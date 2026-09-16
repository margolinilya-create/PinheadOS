# Правила сессии 42 (документ 30.08): где что лежит


- Гейт завершения этапа по закупке — `utils/supply.materialsBlockingCompletion`
  + `stageCompletionBlock` в `utils/stageDone`; зовётся внутри
  `confirmStageDone`, то есть во всех трёх точках закрытия (очередь цеха,
  дорожка канбана, чип доски). Сторож `stageDone.test.ts` читает исходники
  вызывающих: они на JS, и аргументы там тайпчеком не проверяются
- Остатки отгрузки — `utils/shipment` (`shipmentTotals`, `orderQty`).
  `orderQty` заменил `items.reduce(...)` в семи файлах; форма частичной
  отгрузки — `screens/warehouse/PackShipCard`, запись —
  `orderWriteSlice.shipOrder(orderId, lines, { clientKey })` → RPC
  `erp_ship_order`. Количества ведёт триггер, клиент их только читает
- `advanceWarehouseTask` больше НЕ отгружает: у перехода `pack_ship → shipped`
  один писатель — `erp_ship_order`, и он закрывает задачу сам, только при
  полной передаче
- Подпись частичной отгрузки берётся у ЗАКАЗА (`order.shipped_status`), а не
  у задачи: задача остаётся `ready_to_ship`, и `taskStatusLabel(task, order)`
  принимает заказ ВТОРЫМ аргументом во всех четырёх точках экрана склада —
  строка списка, карточка планшета, таблица и шапка шторки
- ЭКС: перенос по канбану — `utils/devBoardMove` (`devMoveIntent` — можно ли,
  `devMovePrompt` — что спросить), единственная точка вызова
  `Experimental.moveDevStage`. Нанесения образца —
  `experimentalBoard.devBrandingFromPrints` поверх экспортированной
  `routes.BRANDING_DEPT`; `DevBrandingPicker` удалён
- ЭКС: состояние `handed` в `DEV_STATE_LABELS`, доска исключает разработки
  с `handed_to_warehouse_at`; техническое название лекал видно на чтение
  в `DevAside`. Новое состояние заводится в ЧЕТЫРЁХ местах разом —
  `DevState`, `filterExperimental.STATE_VALUES`, плитки экрана (`counts`)
  и `STATE_VARIANT`; пропуск ничего не роняет, он молча врёт
- ЭКС: шаг, пройденный человеком вручную (`board_stage` правее шага),
  читается ЗАВЕРШЁННЫМ — `passedByHand` в `devStageStates`. Обязательных
  задач этапов больше нет, и без этого признака «Построение лекал» числилось
  бы незакрытым вечно, а гейт кроя отвечал бы «Ожидает лекала»
- Блок «Задачи этапов» в `DevCard` показывает ТОЛЬКО `extraTasks`: работа
  самих этапов видна в «Основном маршруте разработки», второй список тех же
  строк был бы третьим местом для одного и того же
- Дата запуска заказа участвует в РАСЧЁТЕ: `utils/stagePlan.defaultPlannedEnd`
  принимает `launchDate` и не планирует этап раньше запуска (все три точки
  входа в работу передают её), `validateOrderForm` ловит «срок раньше
  запуска». В производственном плане видна на `plan/PlanTaskCard`
  и в `plan/PlanAddModal`. Каскада плана по нормативам НЕТ — `norm_days`
  пуст у всех участков, механизм не дал бы ни одной даты
- Гейт завершения разработки требует ДВУХ условий (`utils/finalPackage`):
  отшитый и проверенный образец (`sample_approved_at`) и техдокументация.
  Серверное зеркало — `erp_dev_package_guard`, слова те же
- Факт отгрузки виден в «Истории операций» карточки склада: `erp_ship_order`
  пишет `erp_warehouse_ops` вида `shipment` внутри ветки идемпотентности
- Очередь цеха: `COLLAPSIBLE` (что можно свернуть) и `COLLAPSED_BY_DEFAULT`
  (что свёрнуто сначала) — разные списки; состояние экрана хранит СВЁРНУТЫЕ
  группы. Счётчик будущей работы — `orderHelpers.waitingCountFor`, рядом
  с `readyOnlyCountFor` и отдельным числом на вкладке
- Канбан: дорожка `waiting` есть и в `utils/kanbanColumns`, и в `LANES`
  компонента `ErpKanban`. Бросков она не принимает — готовность считается,
  а не выставляется

