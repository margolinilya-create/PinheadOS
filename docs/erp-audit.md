# Аудит ERP-модуля PinheadOS (мульти-агентный, Ruflo)

> Дата: 2026-07-20. Метод: `ruflo analyze` (метрики) + рой из 5 агентов Ruflo
> (architecture, security, tests, production, correctness), read-only. Находки
> сведены и дедуплицированы; ⚑⚑ — подтверждено ≥2 агентами.

## Метрики сложности (`ruflo analyze complexity src/erp`)

| Файл | LOC (до) | LOC (после) | Статус |
|---|---|---|---|
| `store/useErpStore.ts` | 1251 | **59** | ✅ распил на 7 слайсов (`store/slices/`) |
| `screens/OrdersScreen.jsx` | 1283 | **322** | ✅ декомпозиция (`screens/orders/`) |
| `screens/DepartmentQueue.jsx` | 777 | **292** | ✅ декомпозиция (`screens/queue/`) |
| `screens/OrderCard.jsx` | 612 | **293** | ✅ декомпозиция (`screens/orderCard/`) |
| `components/ErpKanban.jsx` | 232 | **130** | ✅ декомпозиция (`kanban/` + `utils/kanbanColumns`) |

**Все 5 «Very Complex» файлов разъяты** (организационно, поведение идентично). Бонус:
логика группировки канбана вынесена в чистую `utils/kanbanColumns.js` и покрыта тестами.

## Статус находок

### ✅ Исправлено (PR #103)
- **⚑⚑ Гейт «на закупку».** Открытая задача закупки (`source_stage_id`) блокирует
  связанный этап (`isStageAwaitingProcurement`); закрытие/отмена — разблокирует.
  Цикл производство↔закупка замкнут. `routes.ts` + `DepartmentQueue`/`OrderCard`/`readyCountFor`.
- **⚑⚑ Проглоченный сбой заявки.** `reportDefect` проверяет результат `createProcurementTask`.
- **⚑⚑ Realtime.** Подписка на `erp_materials`/`erp_procurement_tasks`/`erp_subcontracting`.
- **🛡 Целостность учёта.** `kind`/`counts_as_purchase` форсятся из `cause_type`
  (server-триггер `erp_procurement_task_derive` + порядок spread).
- **«Invalid Date»** защищён `formatDateShort` во всех ERP-экранах.
- **`maybeCloseSupply`** не закрывает закупку у заказа без материалов.
- Тесты: rollback `reportDefect`, `updateProcurementTask`, error-пути CRUD, ветки `waitingReason`.

### 🟡 Открыто (NEXT — бэклог)
- **qty брака** не валидируется против `stage.qty_done`; `qty_rework` без кумулятивной границы.
- **Возврат на ранний этап** не переоткрывает промежуточные этапы (перекроенные единицы их не проходят).
- **Материалы `packaging`/`other` и «сиротские»** (цех вне маршрута) не гейтят → заказ
  может дойти до «готов к отгрузке» с неполученным материалом.
- **Нет inline-состояния ошибки загрузки** (пустой экран без «Повторить»).
- **Задачу закупки нельзя назначить исполнителю** из UI; закрытие задачи не переоткрывает этап-источник.

### 🔒 Требует продуктового решения
- **RLS admin-разделов (A4).** «Закупка»/«Подряд» admin-only только в UI; RLS —
  `authenticated`. Жёсткий admin-only на `insert` **сломает** создание задач рабочими
  цеха (`reportDefect`). Нужно решить модель доступа по ролям (кто создаёт/читает/меняет).

## Рефакторинг `useErpStore.ts` (план architecture-агента)

**Сделано:**
- `store/shared.ts` — инфраструктура (аудит/pending/тайминги).
- `store/types.ts` — DTO стора (`ErpOrderFull`, `ReportDefectOptions`, `NewOrderInput`, …),
  реэкспорт из `useErpStore.ts`. Разрывает циклы для будущих слайсов.
- `useErpStore.ts`: 1376 → 1280 строк, чистое разделение типы/плумбинг/действия.

**Сделано (распил завершён):** 35 действий разнесены на 7 слайсов в `store/slices/`
(`orders/stages/materials/procurement/subcontracting/employees/realtime`);
`useErpStore.ts` — composition-root на 59 строк (было 1280). Общие чистые хелперы
(`findStage`/`patchStageIn`/`sortOrderFull`/`ORDER_SELECT`/`readyCountFor`/`withNewWorkToast`/
`orderPreviewUrl`/`lastDefectPhotoUrl`) — в `store/orderHelpers.ts`. Контракт `ErpStore`
разбит на 7 под-интерфейсов в `store/types.ts` (пересечение = `ErpStore`; слайсы
типизированы `StateCreator<ErpStore,[],[],XxxSlice>`, `get()` видит весь стор). Реэкспорты
`useErpStore`/`readyCountFor`/`_pendingMutations`/`orderPreviewUrl`/`lastDefectPhotoUrl` и DTO
сохранены — пути импорта у 11 экранов и тестов не менялись. Чисто организационный шаг:
публичный API идентичен, 953 теста зелёные **без правок тестов**. Единый синглтон
`_pendingMutations` — по-прежнему в `shared.ts`.

**Сделано (декомпозиция экранов, завершено):**
- `OrdersScreen` 1283 → 322 (`screens/orders/`: DueCell/OrderRow/OrderCardMobile/CreateOrderModal).
- `DepartmentQueue` 777 → 292 (`screens/queue/`: Lightbox/PhotoAttach/TzBlock/QueueCard).
- `OrderCard` 612 → 293 (`screens/orderCard/`: format/PlanCell/StageStepper/OrderItemSection/
  CommentsSection/HistorySection).
- `ErpKanban` 232 → 130 (`components/kanban/`: KanbanCard/useTouchDndPolyfill;
  `utils/kanbanColumns.js` — чистая группировка + 5 тестов).

JSX-вывод идентичен, 958 тестов зелёные. **Бэклог рефакторинга закрыт** — все находки
аудита обработаны.
