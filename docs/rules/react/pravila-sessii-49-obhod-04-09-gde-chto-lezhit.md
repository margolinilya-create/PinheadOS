# Правила сессии 49 (обход 04.09): где что лежит


- Словарь состояний — `erp/utils/statusUi.ts`
  (`STATUS_VARIANT[сущность][статус] → вариант`, 16 сущностей) + `statusUi`
  и `statusChipClass`. `Badge` принимает `entity`/`status`; локальные карты
  классов ВЫВОДЯТСЯ из словаря, своих таблиц цветов рядом быть не должно
- Посадочная по роли — `erp/utils/landing.ts` + `erp/hooks/useRoleLanding.js`.
  Решение один раз за загрузку и только при роли С СЕРВЕРА (`myRole`):
  до бутстрапа `resolveErpRole` отдаёт `worker`
- «Где заказ сейчас и почему стоит» — `erp/utils/orderNow.ts` (`buildOrderNow`
  поверх `buildQueueEntries`). Один источник на колонку списка, фильтр «Стоит»
  и блок в шапке карточки заказа. Конец маршрута даёт ТРИ ответа, не два:
  «готов к отгрузке», «маршрута нет» и «производство закончено» с причиной
- «Что требует внимания» — `erp/utils/notifications.orderNotices`: одна функция
  на колокол оболочки и виджет обзора. Виджет стоит ПОД плитками показателей
- Годность материала — `erp/utils/routes.isMaterialPending` и ТОЛЬКО она:
  `supply.isMaterialSettled` выводится из неё (`!isMaterialPending`), серверное
  зеркало — `erp_stage_completion_block` (`20260904180307`). Вердикт склада
  для закупки — `supply.materialAcceptanceIssue` + `ACCEPTANCE_ISSUE_LABELS`,
  показывает общий `purchasing/PurchaseFields.StatusCell`. Сторож —
  `erp/utils/materialSettled.test.ts`
- Складская задача приёмки заводится при `supply → in_progress|done`
  (`20260904181542`): материалы приходят по частям. `MaterialReceiptCard`
  умеет пустой список — до правки такого состояния не бывало
- Исполнителя этапа пишет ТОЛЬКО `useStageActions.onTake`; `setStageStatus`
  ставит `planned_end`, но не `assignee` (сторож `store/stageAssignee.test.ts`)
- «В начало очереди» — `moveToTop` в `DepartmentQueue`, проп `onMoveTop`
  у `QueueRow` и `QueueCard`, иконка `arrowUpToLine`
- Срок задачи склада — `taskDeadline`/`deadlineLabel` в `screens/Warehouse.jsx`:
  свой `deadline` либо срок заказа с подписью. Статус приёмки материала
  выводится из чисел, пока человек не тронул селект (`MaterialReceiptCard`)

