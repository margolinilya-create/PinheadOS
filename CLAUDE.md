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

## ⛔ Order Studio (ТЗ) — в дальнем ящике (2026-07-20)

Весь код раздела **ТЗ (Order Studio)** физически вынесен в
`pinhead-react/src/orderstudio/**` и заморожен за feature-flag `orderStudio`
(по умолчанию OFF; корень приложения — ERP). Раздел не грузится в проде,
включается только вручную (`?studio=1`).

**Правило:** НЕ читать, НЕ модифицировать и НЕ покрывать тестами код внутри
`src/orderstudio/**` без явной команды пользователя — это экономит контекст
и токены. Работая над ERP, игнорируйте эту папку.

**Исключение** (мостик «Заказы ТЗ» в ERP-админке — их использует ERP, поэтому
остались общими, трогать можно): `components/auth/AdminPanel`,
`components/shared/PageHeader`, `store/useOrdersStore`, `data/*` (каталоги),
`utils/validate`, `types/{order,catalog}`.

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
├── App.jsx                  # Выбор Shell: ErpApp (по умолч.) / OrderStudioApp (за флагом), auth-гейтинг
├── main.jsx                 # Entry point (ТЗ-store грузится динамически только при флаге)
├── config/features.ts       # Feature-flag orderStudio («ящик»)
│
├── erp/                     # 🏭 ПРОИЗВОДСТВО (ERP) — активный раздел, корень приложения
│   ├── ErpApp.jsx, layout/, screens/ (Dashboard, Orders, OrderCard, ProductionBoard, DepartmentQueue, ...)
│   ├── components/ (ErpKanban, PageHead, InlineEdit, ErpSkeletons), store/useErpStore.ts, utils/, data/
│   └── screens/AdminScreen  # Единая админка (смонтирована в оба раздела)
│
├── orderstudio/             # ⛔ ✏️ ТЗ (Order Studio) — ЗАМОРОЖЕН (см. банер выше), за флагом
│   ├── OrderStudioApp.jsx   # Роутинг ТЗ, guards
│   ├── components/          # steps/ (визард + garment/), orders/ (Kanban), editors/ (SkuEditor + sku/), output/, analytics/, layout/ (Header, ProgressBar), shared/, production/
│   ├── store/               # useStore + slices/, useCommentsStore, useEmployeesStore, useDepartmentsStore
│   ├── utils/               # pricing, skuRules, mockup, deadline
│   ├── hooks/ (useDraft, useEffectiveRules), lib/ (api, catalogs)
│   └── data/ (data.test), types/ (pricing, index)
│
├── components/              # ОБЩИЕ: auth/ (AuthScreen, AdminPanel*), shared/ (ErrorBoundary, Toast, ConfirmDialog(Host), Skeleton, PageHeader*)
├── store/                   # ОБЩИЕ: useAuthStore, useToastStore, useConfirmStore, useOrdersStore*
├── hooks/                   # ОБЩИЕ: useFocusTrap, useMediaQuery, useScrollHints, useTheme
├── lib/                     # ОБЩИЕ: supabase, storage
├── utils/                   # ОБЩИЕ: i18n, validate*
├── data/                    # ОБЩИЕ: roles + каталоги* (colors, prices, skuCatalog, extras, fabricsCatalog, constants, index)
├── types/                   # ОБЩИЕ: auth + order*, catalog*
└── styles/                  # CSS-токены и стили
```
`*` — используется ERP-мостиком «Заказы ТЗ», поэтому осталось общим (не в `orderstudio/`).

```
supabase/
└── migrations/              # SQL-миграции (Supabase CLI)
```

## Роутинг раздела ТЗ (⛔ orderstudio/OrderStudioApp.jsx, заморожен)

Роуты ниже — только раздела Order Studio (за флагом). У ERP свой роутинг в
`erp/ErpApp.jsx` (`/`, `/orders`, `/board`, `/queue`, `/admin`, `/purchasing`, ...).

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
| `SESSION-STATE.md` | Память проекта: текущее состояние, решения, next steps |
| `docs/DESIGN.md` | Дизайн-система (токены, компоненты, UX-правила) |
| `docs/erp/*` | ERP: план, разборы таблицы/kontora24/ТЗ |
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
