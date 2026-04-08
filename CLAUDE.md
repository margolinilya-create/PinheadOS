# CLAUDE.md — Pinhead Order Studio

## Проект

Pinhead — внутренняя ERP/CRM-система для типографии (печать на одежде).
Пользователи: менеджеры, дизайнеры, производство, директор.
Цель: оформление заказов через визард, управление на Kanban-доске, аналитика, интеграция с Bitrix24 и 1С.

## Приложения

| Приложение | Путь | Назначение |
|---|---|---|
| **pinhead-react** | `pinhead-react/` | SPA — основной фронтенд |
| **Supabase** | `supabase/` | БД, auth, edge functions, миграции |
| **Vercel** | `vercel.json` | Хостинг и деплой фронтенда |

## Стек

- **Язык:** JavaScript/JSX, TypeScript (типы, утилиты, валидация)
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
│   ├── orders/              # KanbanBoard
│   ├── editors/             # PriceEditor, SkuEditor, ExpressCalc
│   ├── output/              # PrintPreview (PDF)
│   ├── analytics/           # Dashboard
│   ├── production/          # TechCard
│   └── shared/              # ErrorBoundary, Toast, PageHeader, PriceBreakdown, RolePreviewBar
├── store/
│   ├── useStore.js          # Главный Zustand store (собирает слайсы)
│   ├── slices/              # wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice
│   ├── useAuthStore.js      # Auth + роли
│   ├── useOrdersStore.js    # CRUD заказов, Kanban
│   ├── useCommentsStore.js  # Комментарии к заказам
│   └── useToastStore.js     # Уведомления
├── hooks/
│   └── useDraft.js          # Авто-сохранение черновика
├── lib/
│   ├── supabase.js          # Supabase client
│   ├── api.ts               # API-функции (orders, comments, templates)
│   ├── storage.ts           # Файловое хранилище (artwork)
│   └── catalogs.js          # Загрузка каталогов из Supabase
├── data/                    # Статические данные: цвета, ткани, цены, SKU, extras
├── types/                   # TypeScript типы: order, catalog, auth, pricing
├── utils/
│   ├── pricing.js           # Расчёт цен
│   ├── validate.ts          # Валидация заказа
│   └── mockup.js            # SVG-мокап генерация
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
| `/prices` | PriceEditor | admin, director |
| `/sku` | SkuEditor | admin, director |
| `/admin` | AdminPanel | admin, director |
| `/analytics` | Dashboard | admin, director, rop, production |

## Роли

admin, director, manager, rop, designer, production

## Правила и стиль

- Язык интерфейса: русский
- CSS: vanilla + CSS Modules, токены в `styles/index.css`
- Компоненты: `.jsx`, утилиты/типы: `.ts`
- Стейт: Zustand слайсы, useShallow обязателен для объектных селекторов
- Тесты рядом с файлами: `Component.test.jsx`, `util.test.ts`
- Lazy loading: KanbanBoard, PriceEditor, ExpressCalc, AdminPanel, Dashboard
- Ошибки: toast уведомления через useToastStore
- Коммиты: на русском или английском, формат conventional commits

## Supabase — схема

| Таблица | Назначение |
|---------|-----------|
| `orders` | id, order_number (PH-XXXX), status, data JSONB, bitrix_deal |
| `profiles` | id, name, email, role, approved |
| `order_comments` | Комментарии к заказам |
| `order_audit` | Лог изменений статусов |
| `app_config` | Конфигурация (цены, каталоги) |

Статусы заказа: draft → review → approved → production → done

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
