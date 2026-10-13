# Правила сессии 52 (правки 07.09): где что лежит


- **Гант** — `screens/GanttScreen.jsx` (через `lazyScreen`, свой чанк 3,5 кБ
  gzip) + чистая утилита `utils/gantt.ts` (`ganttBars`). Вкладка — четвёртая
  в `components/ProductionTabs`, `match` пункта меню в `Sidebar` расширен
  на `/gantt`. Период в адресе (`?from=`, `?days=`), компактная раскладка —
  карточка на ЗАКАЗ с текстовыми интервалами. Строка карточки называет
  ПОЗИЦИЮ: у заказа их несколько, и «Закрой» дважды — это рубашка и фартук
- **Приёмка готового изделия** — не флаг гейта, а ЭТАП склада в маршруте
  (`utils/routes`: `WAREHOUSE_DEPT_CODE`, `VTO_DEPT_CODE`, `needsIntake`).
  Экран — `screens/warehouse/FgIntakeQueue`, смонтирован в `Warehouse` НАД
  списком задач; строки строит `buildQueueEntries`, закрытие идёт через общий
  `confirmStageDone` с материалами позиции и цехом этапа
- **«Какой участок мой»** — `utils/myDept.myDeptCode(departments, myDeptId)`:
  привязка сотрудника, иначе последний выбранный (`erp_my_dept`). Два
  потребителя — `hooks/useRoleLanding` (посадочная ведёт на `/queue/<код>`)
  и ярлык «Очередь» на обзоре. Пустая строка, а не `null`: результат уходит
  в адрес, и `null` дал бы `/queue/null`
- **Размерная сетка** — `screens/orders/create/SizeGridEditor` (таблица
  «цвет × размер» с итогами по строке и колонке, `th scope` в обе стороны;
  на планшете — карточка на цвет). Итог строки — `orderForm.rowTotal`,
  модель `size_grid` не менялась
- **Что предлагать в форме** и **что читать** — разные списки: техника
  нанесения `BRANDING_METHOD_CHOICES` против `BRANDING_METHOD_LABELS`,
  порядок типов производства `PRODUCTION_TYPE_ORDER`, «нанесение на» —
  `orderForm.brandingOnOptions`/`normalizeBrandingOn` (у готового изделия
  «на крое» запрещено, и уже выбранное нормализуется при смене типа)
- **Упаковка** — `utils/packaging`: `sizeOf` требует ОБЕ стороны, разрешение
  «своё → общее» расширено на размер, подпись собирает `packagingLabel`
- **Сторож методов нанесения** — `utils/brandingMethods.test.ts`: список
  исторических значений поимённо (`dtg`) плюс проверка «форма предлагает все
  методы, кроме исторических» МНОЖЕСТВАМИ, чтобы забытый метод попал под неё сам
- **Чьё готовое изделие** — `utils/garmentSource` (`garmentSourceOf`,
  `isCustomerGarment`, `itemNeedsPurchase`, `GARMENT_SOURCE_ORDER/LABELS/HINTS`).
  Колонка `erp_order_items.garment_source`, тип `GarmentSource` объявлен
  в `erp/types.ts` рядом с `MaterialSource`. Читатели: `buildRoute`
  (`needsIntake` — приёмка склада обязательна и без нанесений),
  `buildItemRoute` (вырезает `supply`), `orderForm.orderNeedsPurchase`
  (лист закупки), плитки в `create/ItemBlock`, показ цеху — `queue/TzBlock`
  и `orderCard/OrderItemSection`. Значение уезжает `garment_source` в payload
  ТОЛЬКО у `ready_garment`
- **Требуется ли закупка по заказу** — `orderForm.orderNeedsPurchase(form,
  items)`, одна функция на три места: подпись свёрнутой секции, объяснение
  внутри неё и проверка `validateOrderForm`. Пустые дополнительные строки
  отбрасываются тем же правилом, что и в цикле валидации (`meaningfulItems`):
  на строке по умолчанию тип «Пошив», и без фильтра она отвечала бы «закупка
  нужна» у заказа, где все позиции давальческие
- **Полоса мощности** (`components/CapacityBar`) — три состояния держат ОДНУ
  коробку: `capacityTrackGhost` повторяет высоту и поля `capacityTrack`,
  скелетон живёт ВНУТРИ неё и своих полей не имеет. Сторож —
  `e2e/erp-cls.spec.ts`, «полоса мощности держит высоту…», на отдельном
  `settingsGate` мока (мощность приезжает своим запросом `erp_settings`,
  на `deptsGate` состояние «грузится» не воспроизводится)

