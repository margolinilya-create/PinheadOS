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
- **orderstudio/** — ⛔ ✏️ ТЗ (Order Studio, за флагом orderStudio) — **ЗАМОРОЖЕН**.
  Весь код ТЗ физически здесь (`src/orderstudio/**`). НЕ читать/не трогать/не
  тестировать без явной команды пользователя (экономия токенов). Работая над ERP —
  игнорировать эту папку.
- Единая админка: erp/screens/AdminScreen смонтирован в оба раздела.
- Правила ERP: см. SESSION-STATE.md и docs/DESIGN.md в корне репо.

## Структура src/

### 🏭 ERP (активный) + ОБЩЕЕ — здесь ведём разработку
- **erp/** — весь код производства (screens, components, store/useErpStore.ts, utils, data)
- components/auth/ — AuthScreen (+ **AdminPanel\*** — мостик «Заказы ТЗ» в ERP-админке)
- components/shared/ — ErrorBoundary, Toast, ConfirmDialog(Host), Skeleton (+ **PageHeader\***)
- store/ — useAuthStore, useToastStore, useConfirmStore (+ **useOrdersStore\***)
- hooks/ — useFocusTrap, useMediaQuery, useScrollHints, useTheme
- lib/ — supabase, storage · utils/ — i18n (+ **validate\***)
- data/ — roles (+ **каталоги\***: prices, skuCatalog, fabricsCatalog, colors, extras, constants, index)
- types/ — auth (+ **order\***, **catalog\***) · styles/ — CSS-токены
- `*` — реально общее (тянет ERP-мостик «Заказы ТЗ»), поэтому НЕ в orderstudio/

### ⛔ orderstudio/ (ЗАМОРОЖЕН — не трогать)
- components/ — steps/ (визард + garment/), orders/ (Kanban), editors/ (SkuEditor + sku/), output/ (PrintPreview), analytics/ (Dashboard), layout/ (Header, ProgressBar), shared/ (PriceBreakdown, RolePreviewBar, OnboardingTips, CommandPalette), production/
- store/ — useStore + slices/, useCommentsStore, useEmployeesStore, useDepartmentsStore
- utils/ — pricing, skuRules, mockup, deadline · hooks/ — useDraft, useEffectiveRules
- lib/ — api, catalogs · data/data.test · types/ — pricing, index

## Ключевые правила
- Общение с пользователем: всегда на русском языке
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

## Не трогать без тестов (в замороженном orderstudio/)
- orderstudio/utils/pricing.ts — 84 теста (pricing.test.js + pricing-extended.test.js)
- orderstudio/store/slices/ — тесты зависят от них

## Тесты
```bash
npm run test     # 953 unit теста (Vitest, 48 файлов)
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
