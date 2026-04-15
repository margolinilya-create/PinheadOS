# CLAUDE.md — Pinhead Order Studio

## Проект

Pinhead — внутренняя ERP/CRM-система для типографии (печать на одежде).
Пользователи: менеджеры, дизайнеры, производство, директор.
Цель: оформление заказов через визард, управление на Kanban-доске, аналитика, интеграция с Bitrix24 и 1С.

## ⚠️ Активные ветки (2026-04-15)

| Ветка | Назначение | Статус | Deploy |
|---|---|---|---|
| `main` | **Production** — менеджеры работают здесь | STABLE, не ломать | `pinhead-os.vercel.app` |
| `redesign/v2` | **Production-слой редизайн** | **W1+W2+W3+W4 ЗАКРЫТЫ + сессия 13** (HR роль / payroll delegation / reversal dropdown / orders tabs / /kpi / RoleGuard fix). Готов к cutover. Bitrix sync блокирован. | Vercel preview → v2 Supabase |

### Правила работы в параллельных ветках

- **Никогда не ломать main** — менеджеры там работают ежедневно. Любой bug в main = немедленный switch на main, fix, возврат к redesign/v2
- **Migrations аддитивные** — новые таблицы/колонки, никаких DROP/RENAME/ALTER existing без feature flag и rollback плана
- **Diff-guard CI** (W1) запрещает изменения в защищённых файлах:
  - `pinhead-react/src/utils/pricing.ts` (84 теста)
  - `pinhead-react/src/store/slices/{wizard,product,design,items,details,catalog,order}Slice.ts` (796 тестов)
  - `pinhead-react/src/components/steps/**` (DOM-чувствительные тесты)
  - `pinhead-react/src/components/shared/CommandPalette.jsx` (hand-rolled, остаётся)
- **Feature flags** — новые экраны скрыты за `app_config.feature_flags.*` до cutover. Merge в main возможен с flags=OFF в prod Supabase, flags=ON в preview
- **Full план:** `docs/adr/README.md` + существующий план в рабочем пространстве разработчика

### redesign/v2 — текущее состояние

**Закрыто (W1-W4 + UAT round 1+2 + сессия 13):**
- **9 миграций** применены к v2 Supabase (последняя `20260530_hr_role_and_payroll_close`)
- 6 ADR-0001 root stores + useUndoStore
- **10 production routes** под feature flags: `/orders` (с табами Канбан/Таблица) `/tech-cards` `/tech-cards/:id` `/workshop` `/foreman` `/payroll` `/workers` `/trash` `/notifications` `/kpi`
- NotificationsBell + V2Nav (sticky, onboarding toggle) + UndoToastHost (10с окно) + OrdersPageShell (табы Канбан/Таблица)
- Outbox loop end-to-end: producer (`lib/domainEvents.ts`) → cron 1 min → dispatcher edge function → mark processed → realtime → bell
- DB invariants: `paid_at` immutability trigger, `amount = rate × qty` CHECK, denorm consistency trigger
- Sub_role для production (`foreman` / `senior_foreman` / `technologist` / `procurement` / `qc_operator`)
- piecework reversal flow: dropdown причин (Опечатка / Брак / Неправильный работник / Другое)
- **HR роль** — новая роль `hr`, RLS позволяет HR читать+писать workers и закрывать payroll batches
- **Payroll close delegation**: director + senior_foreman (мастера цехов) + hr
- **/kpi экран**: section load (план) из snapshot-полей + placeholder'ы для маржи (cost-model) и on-time (Bitrix baseline)
- **RoleGuard fix**: деньги-link race больше не редиректит на `/` — рендерит `.no-access` карточку
- **UAT round 1+2:** blocker (payroll close RLS policy) + 3 major (confirm dialogs) + minor (i18n, onboarding z-index) — всё починено, round 2 PASS
- Director UAT checklist: `docs/UAT-director-checklist.md`
- **865/865 тестов** зелёные (846 + 9 canClosePayroll/hr + 5 OrdersPageShell + 5 KpiScreen)

**v2 Supabase project:** `glhwbktsokphgksdvcxj` (`pinhead-os-v2`)
**UAT login:** `demo@pinhead.local` / `DemoPass2026!` (кнопка «🔐 Войти как demo» в V2Nav)
**Demo seed:** `supabase/seed/v2_uat_demo.sql` — 3 заказа, 5 workers, 2 tech cards, 1 batch
**Cron:** `dispatch-domain-events` каждую минуту → edge function

**Заблокировано (внешние входы):**
- Bitrix one-way sync — нужен webhook URL
- baseline-extract (ADR-0006) — нужен Bitrix API
- piecework parallel-run vs Excel (ADR-0007) — нужны Excel-данные

См. `docs/adr/SESSION-STATE.md` и `docs/adr/0001..0009.md` для деталей.

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

## Роутинг (App.jsx)

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

admin, director, manager, rop, designer, production, **hr** (новая, сессия 13)

`production` имеет sub_role: foreman / senior_foreman / technologist / procurement / qc_operator. RLS политики используют `auth_is_*()` SECURITY DEFINER функции для проверки роли + sub_role.

## Правила и стиль

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

**Storage:**
| Bucket | Назначение |
|--------|-----------|
| `sku-photos` | Фото моделей (до 4 на SKU), public read |

Статусы заказа: draft → review → approved → production → done

Статусы профиля (ProfileStatus): active | pending_approval | disabled | no_profile
- `active`: approved + active
- `pending_approval`: active, но не approved
- `disabled`: active=false (soft-delete)
- `no_profile`: нет записи в profiles (user=null в store)

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
- При logout вызывать `storageClearAll()` — чистит все app-ключи
- Удаление пользователя: soft-delete (active=false), не hard delete
- Auth: ProfileStatus state machine (active/pending_approval/disabled/no_profile)
- Dev-mode created_by: фильтровать 'dev' → null (и в saveOrder, и в duplicateOrder)
- deleteSkuPhotoByUrl: проверять результат, показывать toast.error при ошибке

## Документация

| Файл | Назначение |
|------|-----------|
| `CLAUDE.md` | Контекст для Claude (этот файл) |
| `pinhead-react/CLAUDE.md` | Контекст для Claude (вложенный, детали React-приложения) |
| `PROJECT.md` | История, changelog, roadmap |
| `docs/PINHEAD-PORTAL-LOGIC.md` | Логика визарда |
| `docs/2026-04-10-design-audit.md` | 5-агентный аудит UI/UX |

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
