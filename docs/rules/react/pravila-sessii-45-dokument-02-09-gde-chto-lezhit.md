# Правила сессии 45 (документ 02.09): где что лежит


- Маршрут образца — `utils/routes.ts`: `BASE_CHAIN.samples = ['supply']`
  и `brandingCodes` пустой при `productionType === 'samples'`. Сторожа —
  `routes.test.ts` («Образец: только закупка», `it.each` по обоим `brandingOn`)
  и `routeWalk.test.ts`
- Подсказка у позиции-образца — `SampleRouteNotice` в `components/RouteFields`;
  оба вызывающих (`RouteEditor`, `RouteBlock` в `create/ItemBlock`) передают
  `productionType`. Запрета добавлять цех руками НЕТ — решение владельца
- Гейт отгрузки — `utils/stageUi`: `openDevelopments` (экспортируется, зеркало
  серверной `erp_order_has_open_dev`) и `hasNoRouteByDesign` вместо
  `isExternallyProduced`. Сигнатура `isOrderReadyToShip` НЕ менялась: данные
  приезжают эмбедом
- Эмбед — `store/orderHelpers`: `developments:erp_experimental!erp_experimental_order_id_fkey`
  в ОБЕИХ выборках + дефолт в `sortOrderFull`; тип `OrderDevelopment`
  в `store/types.ts`. Сторож — `store/orderSelect.test.ts` (проверяет оба
  запроса и то, что колонки берутся поимённо)
- Свежесть эмбеда — два писателя: ветка `erp_experimental` в `realtimeSlice`
  (патчит `orders` ДО `loadExperimental`) и `experimentalSlice.updateExperimental`
  (кладёт правку и в `experimental`, и в `orders`, откатывает оба при ошибке)
- Вопрос о названии лекал — `utils/devBoardMove.devMovePrompt`: условие
  «любой ход ВПЕРЁД при пустом `pattern_tech_name`»; у промпта появился
  `confirmLabel`, его читает `Experimental.moveDevStage`. Подпись источника —
  в `screens/experimental/DevFinalPackage`
- Серверная половина — миграции `20260902084052` (гейт + маркировка образцу
  не заводится), `20260902084729` (`erp_order_has_open_dev`,
  `erp_ensure_order_finish_tasks`, триггер `erp_dev_warehouse_gate_release`),
  `20260902085643` (чистка). Сторож — `utils/warehouseGate.test.ts`, блок
  «складские задачи образца ждут закрытия разработки»
- E2E — СВОЙ файл `e2e/erp-sample-route.spec.ts` (десктопные строка очереди
  и таблица заказов), исключён из проекта `mobile` в `playwright.config.ts`.
  Доска ЭКС и переходы по ней остались в `erp-experimental.spec.ts`, который
  гоняется и на 375px

