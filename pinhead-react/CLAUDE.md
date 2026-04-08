# PINHEAD Order Studio — pinhead-react

## Проект
ERP/CRM для типографии (печать на одежде). React 19 + Vite 7 + Zustand 5 + Supabase.
URL: https://pinhead-os.vercel.app

## Структура src/
- components/ — UI (steps/, editors/, orders/, layout/, shared/, production/, analytics/, auth/, output/)
- store/ — Zustand: useStore (7 слайсов), useAuthStore, useOrdersStore, useCommentsStore, useToastStore
- store/slices/ — wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice
- utils/pricing.js — движок ценообразования (покрыт тестами)
- utils/validate.ts — валидация (email, password, required)
- utils/mockup.js — SVG-мокап генерация (sanitizeHex для XSS)
- lib/supabase.js — клиент (ключи строго из .env)
- lib/api.ts — CRUD orders, comments
- lib/storage.ts — localStorage/sessionStorage обёртки + storageClearAll
- lib/catalogs.js — загрузка каталогов из Supabase
- types/ — TypeScript типы: order, catalog, auth, pricing
- data/ — fallback данные: prices, skuCatalog, extras, fabrics, colors
- hooks/useDraft.js — авто-сохранение черновика

## Ключевые правила
- Цены: getPrices() -> store -> localStorage -> DEFAULT_PRICES
- Каталоги: Supabase catalog_config -> fallback на data/*.js
- Черновик: localStorage 'pinhead_draft'
- Роли: admin > director > rop > manager > production > designer
- RLS: manager видит только свои заказы
- Supabase ключи только через .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

## Не трогать без тестов
- utils/pricing.js — только через pricing.test.js
- store/slices/ — 723 теста зависят от них

## Тесты
```bash
npm run test     # 723 unit тестов
npm run e2e      # 3 Playwright E2E
npm run lint     # 0 ошибок обязательно
npm run build    # успешный билд обязательно
```

## Design System
- Токены: src/styles/index.css (:root) — --type-*, --space-*, --z-*
- Шрифты: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
