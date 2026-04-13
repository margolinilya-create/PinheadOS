# ADR-0001 — Seven bounded contexts как отдельные root stores

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2

## Контекст

Существующий `useStore.ts` собирает 7 sales-слайсов (wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice) и покрыт 796 unit-тестами. Production-слой требует ещё 5 слайсов (techCard, workshop, foreman, qc, payroll + cross-context notifications). Добавление их в существующий `useStore` создало бы:

- Re-render fan-out на 12+ слайсов через `useShallow` при любом изменении
- Риск регрессии 796 тестов при рефакторинге
- Смешение bounded contexts (Sales/Catalog и Production) в одном aggregate

## Решение

Production-контексты живут в **отдельных root stores**, не в существующем `useStore`:

- `useTechCardStore.ts`
- `useWorkshopStore.ts`
- `useForemanStore.ts`
- `usePayrollStore.ts`
- `useNotificationsStore.ts`
- `useWorkersStore.ts`

Existing `useStore` (Sales + Catalog) не трогаем. Cross-store coordination — через domain events (ADR-0004), не через прямые импорты.

## Последствия

**Плюсы:**
- Изоляция bounded contexts по DDD
- Нулевой риск регрессии 796 тестов
- Каждый контекст тестируется независимо
- Lazy import через React.lazy на уровне роута → меньший initial bundle
- Multi-tenant refactor (месяц 9) проще — store-per-context = tenant-per-cache

**Минусы:**
- 6 разных hook'ов вместо одного — больше imports на экране
- Возможность дублирования utility функций
- Сложнее shared state (например, `current_order_id` — кто владеет?)

**Правила:**
- `useShallow` обязателен для объектных селекторов в каждом store
- Cross-store чтение только через параметр (передаём `orderId`), не через импорт другого store
- Запись через domain events, не через прямой вызов

## Альтернативы

- **Слайсы в existing useStore** — отвергнуто: риск регрессии + re-render fan-out
- **Один большой production-store** — отвергнуто: смешивает 5 bounded contexts
- **Redux Toolkit slices** — отвергнуто: проект уже на Zustand, миграция не оправдана
