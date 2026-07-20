# Аудит ERP-модуля PinheadOS (мульти-агентный, Ruflo)

> Дата: 2026-07-20. Метод: `ruflo analyze` (метрики) + рой из 5 агентов Ruflo
> (architecture, security, tests, production, correctness), read-only. Находки
> сведены и дедуплицированы; ⚑⚑ — подтверждено ≥2 агентами.

## Метрики сложности (`ruflo analyze complexity src/erp`)

| Файл | Цикломатика | Когнитивная | LOC | Оценка |
|---|---|---|---|---|
| `store/useErpStore.ts` | 96 | 297 | 1251 | Very Complex |
| `screens/OrdersScreen.jsx` | 38 | 118 | 1283 | Very Complex |
| `screens/DepartmentQueue.jsx` | 29 | 97 | 777 | Very Complex |
| `screens/OrderCard.jsx` | 29 | 82 | 612 | Very Complex |
| `components/ErpKanban.jsx` | 26 | 83 | 232 | Very Complex |

Циклические зависимости: 1 (high). Средняя сложность ERP: 12; 6 файлов >15.

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

**Осталось (следующий focused-PR):** распил 35 действий на 7 слайсов
(`orders/stages/materials/procurement/subcontracting/employees/realtime`) в composition-root.
Инварианты: слайсы в каталоге `store/` (относительные пути не меняются), реэкспорт
`useErpStore`/`readyCountFor`/`_pendingMutations`/`orderPreviewUrl`/`lastDefectPhotoUrl`,
единый синглтон `_pendingMutations` в `shared.ts`. Порядок — «от листьев к корню»
(subcontracting→procurement→materials→employees→stages→realtime→orders), атомарные коммиты,
тесты после каждого. Это чисто организационный шаг (сложность функций не падает) —
делать отдельно, не в спешке. Отдельно — разбить крупные экраны (`OrdersScreen`, `DepartmentQueue`).
