# Pinhead Order Studio — Frontend

ERP/CRM для типографии (печать на одежде). SPA на React 19.

**URL:** https://pinhead-os.vercel.app

## Стек

- React 19 + Vite 7
- Zustand 5 (state management)
- Supabase (БД, auth)
- Recharts (аналитика)
- Vitest + Testing Library (unit)
- Playwright (E2E)
- ESLint 9 + Husky

## Быстрый старт

```bash
# Установка
npm install

# Скопировать .env
cp .env.example .env
# Заполнить VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY

# Dev server
npm run dev        # → http://localhost:5173

# Тесты
npm run test       # 721 unit тестов
npm run e2e        # 33 E2E сценариев (Playwright)
npm run lint       # ESLint
npm run build      # Production build
```

## Структура

```
src/
├── components/
│   ├── steps/           # Визард: 5 шагов оформления заказа
│   │   └── garment/     # Подкомпоненты шага "Изделие"
│   ├── orders/          # Kanban-доска заказов
│   ├── editors/         # PriceEditor, SkuEditor, ExpressCalc
│   │   └── sku/         # Подкомпоненты SkuEditor (табы, модалки)
│   ├── analytics/       # Dashboard (графики, метрики)
│   ├── auth/            # AuthScreen, AdminPanel
│   ├── layout/          # Header, ProgressBar
│   ├── output/          # PrintPreview (ТЗ для печати)
│   └── shared/          # ErrorBoundary, Toast, PageHeader
├── store/               # Zustand (все файлы — TypeScript)
│   ├── useStore.ts      # Главный store (7 слайсов)
│   ├── slices/          # wizardSlice, productSlice, designSlice и др.
│   └── use*Store.ts     # Auth, Orders, Comments, Toast, Confirm
├── utils/               # pricing.ts, validate.ts, mockup.ts, deadline.ts, i18n.ts
├── lib/                 # supabase.ts, api.ts, storage.ts, catalogs.ts
├── types/               # TypeScript типы: order, catalog, auth, pricing
├── data/                # Статические данные: цены, SKU, ткани, цвета
├── hooks/               # useDraft, useFocusTrap
└── styles/              # CSS + CSS Modules
```

## Роуты

| Путь | Страница | Доступ |
|------|----------|--------|
| `/` | Визард (5 шагов) | Все |
| `/orders` | Kanban-доска | Все |
| `/print` | ТЗ для печати | Все |
| `/express` | Экспресс-калькулятор | Не production/designer |
| `/prices` | Редактор цен | admin, director |
| `/sku` | Каталог SKU | admin, director |
| `/admin` | Управление пользователями | admin, director |
| `/analytics` | Аналитика | admin, director, rop, production |

## Роли

`admin` · `director` · `manager` · `rop` · `designer` · `production`
