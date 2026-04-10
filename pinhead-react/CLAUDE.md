# PINHEAD Order Studio — pinhead-react

## Проект
ERP/CRM для типографии (печать на одежде). React 19 + Vite 7 + Zustand 5 + Supabase.
URL: https://pinhead-os.vercel.app

## Структура src/
- components/ — UI-компоненты
  - steps/ — Визард: StepGarment → StepDesign → StepItems → StepDetails → StepSummary
  - steps/garment/ — SkuList, FabricGrid, ColorPicker, SizeTable, ExtrasAccordion
  - orders/ — KanbanBoard, KanbanCard, OrderDrawer
  - editors/ — PriceEditor, SkuEditor, ExpressCalc
  - editors/sku/ — SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, AddSkuModal, ZonesModal
  - analytics/ — Dashboard
  - auth/ — AuthScreen, AdminPanel
  - layout/ — Header, ProgressBar
  - output/ — PrintPreview
  - shared/ — ErrorBoundary, Toast, PageHeader, PriceBreakdown, RolePreviewBar
- store/ — Zustand (все .ts)
  - useStore.ts — главный store (7 слайсов)
  - slices/ — wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice (все .ts)
  - useAuthStore.ts, useOrdersStore.ts, useCommentsStore.ts, useToastStore.ts, useConfirmStore.ts
- utils/ — pricing.ts, validate.ts, mockup.ts, deadline.ts, i18n.ts (все .ts)
- lib/ — supabase.ts, api.ts, storage.ts, catalogs.ts (все .ts)
- types/ — TypeScript типы: order, catalog, auth, pricing
- data/ — fallback данные: prices, skuCatalog, extras, fabrics, colors
- hooks/ — useDraft.js, useFocusTrap.js

## Ключевые правила
- Цены: getPrices() -> store -> localStorage -> DEFAULT_PRICES
- Каталоги: Supabase catalog_config -> fallback на data/*.js
- Черновик: localStorage 'pinhead_draft'
- Роли: admin > director > rop > manager > production > designer
- RLS: manager видит только свои заказы
- Supabase ключи только через .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)

## Не трогать без тестов
- utils/pricing.ts — 84 теста (pricing.test.js + pricing-extended.test.js)
- store/slices/ — 721 тест зависят от них

## Тесты
```bash
npm run test     # 721 unit тестов (Vitest)
npm run e2e      # 33 E2E сценариев (Playwright, desktop)
npm run lint     # 0 ошибок обязательно
npm run build    # успешный билд обязательно
```

## Design System
- Токены: src/styles/index.css (:root) — --type-*, --space-*, --z-*
- Шрифты: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
