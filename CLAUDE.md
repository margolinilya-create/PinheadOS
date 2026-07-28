# CLAUDE.md — Pinhead Order Studio

## Проект

Pinhead — внутренняя ERP/CRM-система для типографии (печать на одежде).
Пользователи: менеджеры, дизайнеры, производство, директор.
Цель: оформление заказов через визард, управление на Kanban-доске, аналитика, интеграция с Bitrix24 и 1С.

## Логика продукта (решение заказчика, 2026-07-17)

Два раздела с переключением в шапке (единая админка):
1. **✏️ ТЗ (Order Studio)** — создание технического задания к заказу.
   Формат ТЗ: docs/erp/tz-format-analysis.md. Генерация ТЗ-PDF — здесь (позже).
2. **🏭 Производство (ERP)** — заказ попадает сюда ПОСЛЕ создания ТЗ
   и движется по цехам до сдачи.

Поток: **ТЗ → Производство**. Текущий приоритет — производство (ERP):
поля ТЗ (размерная сетка, нанесения, упаковка/бирки) живут в производственном
заказе, цеха видят полное ТЗ в карточке. Этап-мост «ТЗ → авто-создание
производственного заказа» и генерация PDF — следующая очередь.

## Приложения

| Приложение | Путь | Назначение |
|---|---|---|
| **pinhead-react** | `pinhead-react/` | SPA — основной фронтенд |
| **Supabase** | `supabase/` | БД, auth, edge functions, миграции |
| **Vercel** | `vercel.json` | Хостинг и деплой фронтенда |

## Стек

- **Язык:** TypeScript (store, utils, lib) + JSX (компоненты)
- **Фреймворк:** React 19 + Vite 7
- **Стейт:** Zustand 5 (слайсы), useShallow для селекторов
- **Роутинг:** react-router-dom 7 (Routes/Route в App.jsx)
- **БД/Auth:** Supabase (supabase-js)
- **Графики:** Recharts
- **Тесты:** Vitest + Testing Library (unit), Playwright (e2e)
- **Линтинг:** ESLint 9, Husky + lint-staged
- **CSS:** Vanilla CSS + CSS Modules (*.module.css), CSS-токены

## Структура файлов

```
pinhead-react/src/
├── App.jsx                  # Роутинг, guards, layout
├── main.jsx                 # Entry point
├── components/
│   ├── auth/                # AuthScreen, AdminPanel
│   ├── layout/              # Header, ProgressBar
│   ├── steps/               # Wizard: StepGarment → StepDesign → StepItems → StepDetails → StepSummary
│   │   └── garment/         # SkuList, FabricGrid, ColorPicker, SizeTable, ExtrasAccordion
│   ├── orders/              # KanbanBoard, KanbanCard, OrderDrawer
│   ├── editors/             # PriceEditor (wrapper), SkuEditor (8 табов), ExpressCalc
│   │   └── sku/             # SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, PricingTabContent, CategoryRulesTab, ZonesCatalogTab, AddSkuModal, ZonesModal, SkuDetailModal
│   ├── output/              # PrintPreview (PDF)
│   ├── analytics/           # Dashboard
│   ├── production/          # TechCard
│   └── shared/              # ErrorBoundary, Toast, PageHeader, PriceBreakdown, RolePreviewBar, Skeleton, OnboardingTips, CommandPalette
├── store/                   # Все файлы — TypeScript (.ts)
│   ├── useStore.ts          # Главный Zustand store (собирает слайсы)
│   ├── slices/              # wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice — все .ts
│   ├── useAuthStore.ts      # Auth + роли
│   ├── useOrdersStore.ts    # CRUD заказов, Kanban
│   ├── useCommentsStore.ts  # Комментарии к заказам
│   ├── useToastStore.ts     # Уведомления
│   └── useConfirmStore.ts   # Imperative confirm dialog
├── hooks/
│   ├── useDraft.js          # Авто-сохранение черновика
│   ├── useFocusTrap.js      # Focus trap для модалок
│   └── useEffectiveRules.ts # Resolved category rules для визарда
├── lib/
│   ├── supabase.ts          # Supabase client
│   ├── api.ts               # API-функции (orders, comments, templates)
│   ├── storage.ts           # localStorage/sessionStorage обёртки + storageClearAll + Supabase Storage (sku-photos)
│   └── catalogs.ts          # Загрузка каталогов из Supabase (catalog_config + app_config)
├── data/                    # Статические данные: цвета, ткани, цены, SKU, extras
├── types/                   # TypeScript типы: order, catalog, auth, pricing
├── utils/
│   ├── pricing.ts           # Расчёт цен (покрыт 88 тестами), TECH_TABS, priceMultiplier
│   ├── skuRules.ts          # CategoryRules резолюция, getEffectiveRules, динамические зоны (29 тестов)
│   ├── validate.ts          # Валидация заказа
│   ├── mockup.ts            # SVG-мокап генерация
│   ├── deadline.ts          # Расчёт дедлайнов
│   └── i18n.ts              # Pluralize, translateSupabaseError
└── styles/                  # CSS: auth, kanban, wizard, forms, layout, garment, editors, extras-zones
```

```
supabase/
└── migrations/              # SQL-миграции (Supabase CLI)
```

## Роутинг

`App.jsx` выбирает оболочку по флагу `orderStudio` (`src/config/features.ts`):
по умолчанию **ErpApp** (Производство), с флагом — **OrderStudioApp** (ТЗ).
Переключатель — в шапке обоих разделов (admin/director).

### 🏭 Производство — `src/erp/ErpApp.jsx`

| Путь | Компонент | Доступ |
|---|---|---|
| `/` | ErpDashboard (обзор производства) | Все |
| `/orders`, `/orders/:orderId` | OrdersScreen, OrderCard | Все |
| `/board` | ProductionBoard (таблица + канбан цехов) | Все |
| `/queue`, `/queue/:deptCode` | DepartmentQueue (очередь участка) | Все |
| `/task/:stageId` | ProductionTask (производственное задание) | Все |
| `/purchasing`, `/warehouse`, `/subcontracting`, `/experimental` | Закупка, Склад, Подряд, Эксперим. цех | admin, director |
| `/admin` | AdminScreen (пользователи, права, цеха, справочники, заказы ТЗ) | admin, director |

### ✏️ ТЗ (Order Studio) — за флагом `orderStudio`

| Путь | Компонент | Доступ |
|---|---|---|
| `/` | WizardPage (5 шагов) | Все |
| `/orders` | KanbanBoard | Все |
| `/print` | PrintPreview | Все |
| `/express` | ExpressCalc | Не production/designer |
| `/prices` | → redirect `/sku?tab=pricing` | admin, director |
| `/sku` | SkuEditor (8 табов) | admin, director |
| `/admin` | AdminPanel | admin, director |
| `/analytics` | Dashboard | admin, director, rop, production |

## Роли

admin, director, manager, rop, designer, production

## Правила и стиль

- Общение с пользователем: всегда на русском языке
- Язык интерфейса: русский
- CSS: vanilla + CSS Modules, токены в `styles/index.css`
- Компоненты: `.jsx`, утилиты/типы: `.ts`
- Стейт: Zustand слайсы, useShallow обязателен для объектных селекторов
- Тесты рядом с файлами: `Component.test.jsx`, `util.test.ts`
- Lazy loading: KanbanBoard, PriceEditor, ExpressCalc, AdminPanel, Dashboard, StepDesign, StepItems, StepDetails, StepSummary
- Ошибки: toast уведомления через useToastStore
- Коммиты: на русском или английском, формат conventional commits

## Supabase — схема

| Таблица | Назначение |
|---------|-----------|
| `orders` | id, order_number (PH-XXXX), status, data JSONB, bitrix_deal |
| `profiles` | id, name, email, role, approved, active |
| `order_comments` | Комментарии к заказам |
| `order_audit` | Лог изменений статусов |
| `app_config` | SKU (sku_catalog), цены (prices), обработки (extrasCatalog), фурнитура (hardwareCatalog), правила (categoryRules), зоны (zonesCatalog) |
| `catalog_config` | Ткани (fabricsCatalog), отделка (trimCatalog) |

**ERP (префикс `erp_*`, проект pinhead-os-v2)** — полная схема в
`pinhead-react/src/erp/types.ts` (зеркало таблиц) и в `supabase/migrations/`.
Ядро: `erp_departments` · `erp_orders` (+ `customer`) · `erp_order_items` ·
`erp_item_stages` (граф `depends_on`, `queue_position` — приоритет в очереди цеха,
`assignee` — исполнитель) · `erp_materials`. Сопровождение: `erp_item_prints`,
`erp_stage_events` (история этапов), `erp_order_audit`/`_comments`/`_attachments`,
`erp_procurement_tasks`, `erp_subcontracting`, `erp_warehouse_ops`/`_tasks`,
`erp_experimental`(+`_ops`), `erp_employees`, `erp_role_permissions` (матрица прав),
`erp_dictionaries` (справочники админки: причины блокировок, типы проблем, типы изделий,
поставщики), `erp_material_suppliers` (варианты поставщиков на позицию закупки, ровно один
`is_selected`), `erp_tz_documents`/`erp_tz_assignments` (ТЗ в PDF: версии внутри `group_id`,
назначение цеху ссылается на группу).

**Storage:**
| Bucket | Назначение |
|--------|-----------|
| `sku-photos` | Фото моделей (до 4 на SKU), public read |
| `erp-attachments` | Превью макетов, вложения заказов и ТЗ в PDF (префикс `tz/`), public read |

Статусы заказа: draft → review → approved → production → done

Статусы профиля (ProfileStatus): active | pending_approval | disabled | no_profile
- `active`: approved + active
- `pending_approval`: active, но не approved
- `disabled`: active=false (soft-delete)
- `no_profile`: нет записи в profiles (user=null в store)

## Правило конца сессии (обязательное)

В конце КАЖДОЙ сессии обновить:
1. `SESSION-STATE.md` — текущее состояние, новые решения, next steps
2. `PROJECT.md` — запись сессии в Changelog (что сделано)
3. `docs/DESIGN.md` — если менялся визуал/компоненты
4. `CLAUDE.md` (корневой и pinhead-react/) — если менялась структура/правила
Также: удалить временные QA-политики из БД (tmp_*), остановить dev-серверы.

## Правила кода

- `useShallow` для объектных селекторов Zustand — обязательно
- `toast.error` при каждой Supabase ошибке
- `return null` из async при ошибке (не fallback объект)
- Optimistic update только с rollback
- НЕ optimistic delete — ждать ответ Supabase
- CSS токены из `:root` (--type-*, --space-*, --z-*)
- Autofocus на первом поле формы
- Не добавлять npm-зависимости без обсуждения
- Не `!important` в CSS
- Supabase ключи строго из `.env` (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- RLS: политика пишется НА КОМАНДУ (`for select/insert/update/delete`), а не `for all`
  рядом с отдельной `select` — иначе Postgres проверяет обе на каждый SELECT
  (advisor `multiple_permissive_policies`). `auth.uid()`/`auth.role()` в предикате
  оборачивать в `(select …)` — иначе вызов идёт на каждую строку (`auth_rls_initplan`)
- `is_admin()`, `erp_is_manager()`, `erp_is_member()` вызываемы через REST, и advisor
  на это ругается — **так и оставляем**: выражения RLS исполняются от лица вызывающего,
  и отзыв `EXECUTE` сломает сами политики. Утечки нет: функции без аргументов и
  возвращают булево о самом вызывающем. Не «чинить»
- При logout вызывать `storageClearAll()` — чистит все app-ключи
- Удаление пользователя: soft-delete (active=false), не hard delete
- Auth: ProfileStatus state machine (active/pending_approval/disabled/no_profile)
- Dev-mode created_by: фильтровать 'dev' → null (и в saveOrder, и в duplicateOrder)
- deleteSkuPhotoByUrl: проверять результат, показывать toast.error при ошибке
- ERP: доступ только через `useErpAccess` (право из матрицы + принадлежность цеху),
  кнопки этапа — через `useStagePermissions` (у каждого действия своё право);
  приоритет очереди — `reorderStageQueue`, перенос между цехами — `moveStageToDepartment`
  с подтверждением последствий; прогресс считается в штуках (`erp/utils/progress`)
- ERP, необратимое действие этапа: последствия считает чистая утилита с тестами и
  формулирует их текстом — `utils/stageDone` (закрытие с недосдачей),
  `utils/stageDefect` (возврат брака через промежуточные этапы). Записывать факт
  «по умолчанию весь тираж» / молча откатывать маршрут нельзя
- Справочники ERP (`erp_dictionaries`) — подсказка, а не ограничение; значения отключаются,
  а не удаляются. Статусы в справочник не выносятся — они часть маршрутной логики
- ТЗ в PDF: назначение цеху хранит `group_id`, а не версию — замена файла обновляет ТЗ
  у всех связанных цехов сама. Гейт (`utils/tz`) требует ТЗ только у производственных
  цехов и только при `tz_required === true` (fail-open: остановка цеха не должна
  случаться из-за отсутствующего поля). Заказ с ТЗ создаётся одной транзакцией:
  файлы в бакет → `erp_create_order` с секцией `tz`

## Документация

| Файл | Назначение |
|------|-----------|
| `CLAUDE.md` | Контекст для Claude (этот файл) |
| `pinhead-react/CLAUDE.md` | Контекст для Claude (вложенный, детали React-приложения) |
| `PROJECT.md` | История, changelog, roadmap |
| `SESSION-STATE.md` | Память проекта: текущее состояние, решения, next steps |
| `docs/DESIGN.md` | Дизайн-система (токены, компоненты, UX-правила) |
| `docs/erp/*` | ERP: план, разборы таблицы/kontora24/ТЗ |
| `docs/PINHEAD-PORTAL-LOGIC.md` | Логика визарда |
| `docs/2026-04-10-design-audit.md` | 5-агентный аудит UI/UX |
| `docs/2026-07-27-skills-audit.md` | Аудит по чек-листам скилов: 16 находок + план работ |

## Команды

```bash
cd pinhead-react
npm run dev        # Dev server
npm run build      # Production build
npm run test       # Vitest unit tests
npm run e2e        # Playwright e2e tests
npm run lint       # ESLint
npm run seed       # Seed catalog data
```
