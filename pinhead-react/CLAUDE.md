# PINHEAD Order Studio — pinhead-react

## Проект
ERP/CRM для типографии (печать на одежде). React 19 + Vite 7 + Zustand 5 + Supabase.
URL: https://pinhead-os.vercel.app

## Два раздела (переключение в шапке, admin/director)
- **erp/** — 🏭 Производство (по умолчанию): ErpApp (lazy-экраны), layout,
  screens (Dashboard/Orders/OrderCard/ProductionBoard+Kanban/DepartmentQueue/
  FabricPurchasing/AdminScreen), components (ErpKanban, InlineEdit, PageHead,
  ErpSkeletons), store/useErpStore.ts (точечный realtime, ленивый архив,
  RPC erp_create_order, pendingMutations), utils (routes/time/stageUi/orderForm),
  data/departments, types.ts, erp.module.css (брейкпоинты 760/480,
  pointer:coarse). Touch-DnD канбана: mobile-drag-drop (dynamic import).
  PWA: public/manifest.webmanifest + icon-192/512.
- **orderstudio/** — ✏️ ТЗ (Order Studio, за флагом orderStudio): визард,
  SKU, аналитика. Компоненты ниже — его состав.
- Единая админка: erp/screens/AdminScreen смонтирован в оба раздела.
- Правила ERP: см. SESSION-STATE.md и docs/DESIGN.md в корне репо.

## Структура src/
- components/ — UI-компоненты
  - steps/ — Визард: StepGarment → StepDesign → StepItems → StepDetails → StepSummary (lazy 2-5)
  - steps/garment/ — SkuList (expandable cards), FabricGrid, ColorPicker, SizeTable, ExtrasAccordion
  - orders/ — KanbanBoard, KanbanCard (keyboard DnD), OrderDrawer
  - editors/ — PriceEditor (wrapper), SkuEditor (8 табов), ExpressCalc
  - editors/sku/ — SkuItemsTab, SkuFabricsTab, SkuTrimsTab, ExtrasEditor, SkuHardwareTab, PricingTabContent, CategoryRulesTab, ZonesCatalogTab, AddSkuModal, ZonesModal, SkuDetailModal
  - analytics/ — Dashboard (Chart.js)
  - auth/ — AuthScreen, AdminPanel
  - layout/ — Header (dark mode toggle), ProgressBar (fill bar)
  - output/ — PrintPreview
  - shared/ — ErrorBoundary, Toast, PageHeader, Skeleton, OnboardingTips, CommandPalette, PriceBreakdown, RolePreviewBar
- store/ — Zustand (все .ts)
  - useStore.ts — главный store (7 слайсов)
  - slices/ — все .ts: wizardSlice, productSlice, designSlice, itemsSlice, detailsSlice, catalogSlice, orderSlice
  - useAuthStore.ts, useOrdersStore.ts, useCommentsStore.ts, useToastStore.ts, useConfirmStore.ts
- utils/ — все .ts: pricing, skuRules, validate, mockup, deadline, i18n
- lib/ — все .ts: supabase, api, storage (+ Supabase Storage: sku-photos), catalogs
- types/ — TypeScript типы: order, catalog, auth, pricing
- data/ — fallback данные: prices, skuCatalog (с description, sizeChart, photos), extras, fabrics, colors
- hooks/ — useDraft.js, useFocusTrap.js, useEffectiveRules.ts, useMediaQuery.js, useScrollHints.js

## Ключевые правила
- Цены: getPrices() -> store -> localStorage -> DEFAULT_PRICES
- Каталоги: Supabase (app_config + catalog_config) -> localStorage -> defaults
- Все каталоги в Zustand store (catalogSlice): skuCatalog, fabricsCatalog, trimCatalog, extrasCatalog, hardwareCatalog, labelsCatalog
- app_config хранит: sku_catalog, prices, extrasCatalog, hardwareCatalog, categoryRules, zonesCatalog
- catalog_config хранит: fabricsCatalog, trimCatalog
- SKU Editor: 8 табов (items, fabrics, trims, extras, hardware, pricing, rules, zones)
- CategoryRules: per-категория (allowedTechs, moq, availableSizes, defaultExtras, allowedZoneTechs)
- Per-SKU overrides: allowedFabrics, allowedExtras, availableSizes, overrides (techs/moq/colors), priceMultiplier
- Зоны нанесения: динамические (ZoneDefinition в zonesCatalog), не хардкод
- Визард: useEffectiveRules() → фильтрация техник, цветов, размеров, тканей, обработок
- SKU фото: Supabase Storage bucket `sku-photos`, до 4 фото на артикул, поле `photos[]` (photoUrl удалён)
- Черновик: localStorage 'pinhead_draft'
- Роли: admin > director > rop > manager > production > designer
- Auth states (ProfileStatus): active | pending_approval | disabled | no_profile
- Пользователи: soft-delete (active=false), не hard delete
- RLS: manager видит только свои заказы
- Supabase ключи только через .env (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
- Dark mode: html[data-theme="dark"], toggle в Header, persist в localStorage

## Не трогать без тестов
- utils/pricing.ts — 84 теста (pricing.test.js + pricing-extended.test.js)
- store/slices/ — 796 тестов зависят от них

## Тесты
```bash
npm run test     # 887 unit тестов (Vitest)
npm run e2e      # 40 E2E сценариев (Playwright, 7 файлов)
npm run lint     # 0 ошибок обязательно
npm run build    # успешный билд обязательно
```

## Design System
- Токены: src/index.css (:root) — --type-*, --space-*, --z-*, --radius-*, --color-*
- Dark mode: html[data-theme="dark"] с полным набором override-токенов
- Шрифты: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
- Кнопки: .btn + variants (.btn-primary, .btn-secondary, .btn-danger, .btn-ghost)
- Анимации: fadeSlideIn, slideInRight, scaleIn, skeleton shimmer
