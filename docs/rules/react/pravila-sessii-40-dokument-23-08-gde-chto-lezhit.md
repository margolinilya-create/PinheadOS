# Правила сессии 40 (документ 23.08): где что лежит


- Граница двух ожиданий очереди — `utils/supply.isSupplyWait` (снабжение
  против производства). Ею пользуется `buildQueueEntries`, то есть и очередь,
  и канбан, и фильтры. Порядок блоков очереди задаёт `GROUP_TITLES`
  в `DepartmentQueue`, свёрнутые по умолчанию — `COLLAPSED_BY_DEFAULT`;
  раскрытие держится за сеанс экрана и НЕ пишется в localStorage
- `MaterialWait` свёрнут внутри себя (`<details>`), а не у потребителей:
  их два (строка и карточка планшета), и две обёртки разошлись бы молча.
  Причина ожидания — компактный маркер у ОБЕИХ групп
- Закупка — мастер-деталь: `purchasing/SupplyQueue` (только навигация,
  «Открыть») + `purchasing/PurchaseCard` (действия, сводка, таблица
  материалов заказа). Выбранный заказ в адресе `?supply=`. Сводку считает
  `supplyMaterialSummary` (там же `notOrdered` и `problems`), а не экран
- Склад: `PACK_SHIP_STATUS_LABELS` — ровно три статуса. Писателей задачи
  три, сторож на всех — в `warehouseGate.test.ts`
- Легаси подряда — `admin/LegacySubcontractTab`, предикат
  `hasLegacySubcontracts` в `utils/outsourcing` (не рядом с компонентом:
  `react-refresh/only-export-components`)
- ЭКС: `devRouteSteps` строит узлы stepper-а, `DEV_STAGE_COMPLETE_LABELS` —
  подписи действий по этапу. Результат этапа пишется в `result` задач
  тем же действием, что закрывает этап
- `withoutJsComments` — в `utils/migrations.testutil`, рядом с `withoutComments`

