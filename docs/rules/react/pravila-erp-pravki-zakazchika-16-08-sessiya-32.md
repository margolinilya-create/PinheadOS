# Правила ERP (правки заказчика 16.08, сессия 32)


- Карточка заказа — только страница `/orders/:orderId`. Боковая панель
  (`OrderDrawer`, `OrderDrawerHost`, стор `useOrderDrawer`) удалена. Открытие —
  `components/OrderLink`, для мест без ссылки — `utils/orderLink.orderLinkTarget`
- Упаковка позиции: `utils/packaging.itemPackaging` — единственное место, где
  «своё → общее по заказу» разрешается. `inherit` ≠ `none`
- Лист закупки: `screens/orders/create/PurchaseListSection` → секция `materials`
  payload; печатная форма — `screens/purchasing/PurchaseListPrint` (`window.print()`).
  Строки листа проверяет `validateOrderForm` (четвёртый, необязательный
  аргумент): начатая строка обязана нести название и количество, совсем пустая
  ошибкой не считается. Без этого заказ уезжал со строкой без `qty_expected`,
  а закупка по такой строке не закрывается автоматически никогда
- Подряд: `utils/outsourcing.ts` (модуль-лист) — что такое подрядный этап,
  где заказ сейчас, следующий этап маршрута, подпись этапа. Отсев подряда
  из очереди/счётчиков/загрузки есть в трёх файлах, сторожит
  `contractorStageNotInQueue.test.ts`
- Конструктор маршрута: `utils/routeDraft.ts` — группы вместо линейного списка,
  инвариант тождества с `buildItemRoute`, замок на этапе с фактом.
  Сохранение — RPC `erp_route_apply` (одна транзакция, `depends_on` индексами)
- Разметка конструктора ОДНА на два места — `components/RouteFields`:
  `components/RouteEditor` (карточка заказа, сохранение через RPC) и
  `RouteBlock` в `screens/orders/create/ItemBlock` (форма создания, маршрут
  уезжает в payload). Правило «правка или расчёт» — `formItemRoute`, и оно же
  собирает аргументы `buildItemRoute`: читателей трое
- Конструктор в карточке монтируется только открытым — черновик посеян
  из `item.stages` и после сохранения устаревает
- Раздел «Подряд» (`screens/Subcontracting`) строит строки ИЗ ЭТАПОВ; журнал
  перемещений — `screens/subcontracting/MoveJournal`, и он же механизм закрытия
  подрядного этапа (приёмка приращает `qty_done` триггером). Бейдж меню —
  `ordersWithOutsourcing(orders)` из ядра, а не из лениво загружаемого реестра
- Новые справочники: `fit` (крой изделия), `route_operation` (операции маршрута).
  Вид справочника по-прежнему живёт в ЧЕТЫРЁХ местах

