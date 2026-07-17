# Разбор kontora24 — фишки для переноса в PinheadOS ERP

> Источник: /workspace/kontora24 (MES для стикерного производства, prod с 2026-05,
> 507 тестов). Стек идентичен нашему: React 19 + Zustand + Supabase + Vercel.
> Разбор по 4 зонам заказчика: создание заказа · карточка · движение · канбан.

## 1. Создание заказа (CreateOrderPage, 1096 строк)

React Hook Form + Zod, форма в 3 секции (Сделка / Заказ / Отгрузка), двухколоночный grid.

**Переносим:**
- [S] Свободный ввод имени клиента → `findOrCreateClientByName` за кулисами (клиент создаётся сам, связь для аналитики остаётся)
- [S] Пресеты размеров чипами + сброс пресета при ручном вводе
- [S] Тип продукции — плитки-кнопки (тач 48px+), не select
- [S] Error-summary баннер сверху + scrollToFirstError по aria-invalid
- [M] Drop-zone превью: drag-and-drop + **Ctrl+V из буфера**, загрузка в Storage откладывается до создания заказа
- [M] Двухступенчатый сабмит: Zod (формат) → preSubmit (бизнес-инварианты) → ConfirmDialog для мягких предупреждений
- [L] Прогноз расхода материалов в форме + warning о нехватке на складе

## 2. Карточка заказа (OrderDetailPage + Stepper + 5 табов)

Header с инлайн-правками → StatusOverride/StatusSwitcher → кнопки печати →
Stepper-лента → табы (Обзор / Прогресс / Расход / История / Финансы) → комментарии-чат.

**Переносим:**
- [M] **EditableField-паттерн**: клик → input → Enter/Escape → updateOrder → toast → optimistic. Самый ценный UX карточки (у них: номер, клиент, дедлайн, ссылки)
- [S] Оптимистичный `setOrder(prev => ({...prev, ...patch}))` вместо refetch после правок
- [M] Stepper-лента этапов с tooltip «когда + кто» из истории (без 3D-развилок нам хватит простого режима)
- [S] Off-route баннер «заказ вне маршрута» + кнопка «Вернуть на этап»
- [M] Единая History-лента: статусы + audit изменений полей + производственные логи в одном таймлайне
- [M] AdminOrderEditor: 7 инлайн-секций, sticky-footer, финансовые поля только при праве view:finance
- [M] Комментарии-чат заказа с realtime
- [M] PDF-экспорт (ленивый jspdf; обязательно встроить кириллический шрифт)
- [S] Табы на desktop / dropdown на мобиле

## 3. Движение заказов (constants.js + useOrders.js + production-logs.js)

19 статусов, маршруты по типу продукции, skip-логика, RBAC, completion-check.

**Переносим:**
- [M] `getOrderRoute(order)` со skip-логикой по флагам заказа (у нас уже есть аналог buildRoute — доработать)
- [S] `isStageAllowed(order, stage)` — единый guard для DnD и смены статуса
- [M] `updateOrderStatus(from, to, {isRollback, force})`: маршрут-guard + RBAC-guard + **мягкий** completion-check (не блокирует, а предупреждает toast'ом)
- [M] Multi-step прогон при drag через несколько колонок + автооткат при ошибке на шаге N
- [M] `check_stage_completion` RPC → `{is_complete, next_status}` → ConfirmDialog, без авто-перехода
- [L] **`STAGE_FIELDS`-конфиг + `computeIncoming`**: «нельзя передать дальше больше, чем годных пришло с прошлого этапа» — с severity warning (не блок). Прямо ложится на раскрой→швейку→ВТО
- [M] Динамический RBAC: k24_role_permissions в БД перекрывает статический fallback

## 4. Канбан (OrdersKanban + useProductionBoard + DraggableCard)

@dnd-kit, оптимистичные перемещения, три вида страницы заказов.

**Переносим:**
- [M] Блокировка запрещённых колонок: `useDroppable({disabled: !isStageAllowed(...)})` + grayscale
- [M] Три сенсора: Pointer(distance 5) + Touch(delay 150 — тап-скролл не превращается в drag) + Keyboard; оптимистичный pendingMove
- [M] Карточка: цветная точка дедлайна, **время-в-статусе** (мин/ч/дн), thumbnail из Storage, stopPropagation на ссылке
- [S] SavedFilters: JSONB config в таблице с RLS «только свои», чипы
- [S] DateRangeFilter с пресетами (Сегодня/7д/30д/месяц/свой) + detectPreset
- [S] Переключатель видов: список / канбан / календарь / плоский
- [S] Группировка списка по отделам с коллапсом; fade-индикаторы горизонтального скролла

## Инфраструктура (бонус)

- [S] Уникальные realtime-каналы (`crypto.randomUUID()` в имени) + debounce 500ms refetch — иначе ломается на StrictMode/HMR
- [M] Audit-триггер полей заказа (field, old, new, кто, когда) → лента истории
- [M] Role-based уведомления: INSERT в status_history → NOTIFY_ROLES → звук + toast нужным ролям
- [M] Маскирующее view для финансов (воркеры не видят цены) — вместо дублирования таблицы
- [M] SECURITY DEFINER RPC для точечного обхода RLS (имя клиента без телефона)

## Предлагаемые волны переноса

1. **Волна 1 — Канбан ERP + движение** (ядро «движение заказов»):
   DnD-канбан позиций по цехам с блокировкой колонок, время-в-статусе,
   isStageAllowed, multi-step с автооткатом. Канбан-движок можно взять
   и из Order Studio (KanbanBoard), механику — из kontora24.
2. **Волна 2 — Карточка**: EditableField-паттерн, Stepper с tooltip,
   единая History-лента (audit-триггер), комментарии с realtime.
3. **Волна 3 — Создание заказа**: клиенты (erp_clients + findOrCreate),
   плитки типов, пресеты, drop-zone с Ctrl+V, двухступенчатый сабмит.
4. **Волна 4 — Инфра**: realtime-подписки, уведомления ролям, computeIncoming.
