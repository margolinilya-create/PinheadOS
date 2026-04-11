# Pinhead Order Studio — Проект

## История

### ERA 1 — Vanilla HTML (до марта 2026)
Весь проект в одном файле `pinhead-order-studio-v1_7__5_.html` (~9 500 строк).
Supabase через CDN. Финальная версия v1.7 — полностью функциональна для внутреннего использования.

Ушли от vanilla потому что: файл неподдерживаем, нет тестов, нет типов, невозможно масштабировать.

### ERA 2 — React Migration (февраль–март 2026)
Полная миграция в React 19 + Zustand. 138 коммитов. Воспроизведён весь функционал v1.7.

Ключевая сессия — 20 марта 2026 (56 коммитов): ревизия по Design Guidebook, 5 критических багов, 65 тестов на pricing.

### ERA 3 — Стабилизация + CRM/ERP (апрель 2026)
Сессии 1-5: баги, качество, UX, аудит UI, security hardening. Стратегический разворот к CRM/ERP интеграции.

---

## Changelog

### Сессия 10 (11.04.2026) — SKU как центр управления ТЗ (28 файлов, 796 тестов)

**Фаза 1: Ценообразование → SKU Editor**
- PriceEditor извлечён в PricingTabContent (переиспользуемый компонент)
- 6-й таб «Ценообразование» в SkuEditor с dirty-индикатором
- Секция «Экономика» (read-only себестоимость) в SkuDetailModal
- `/prices` → redirect `/sku?tab=pricing`, кнопка убрана из Header

**Фаза 2: Правила категорий**
- Типы: CategoryRules, CategoryRulesOverrides, ZoneDefinition
- getEffectiveRules() — мерж категория + per-SKU overrides (29 unit-тестов)
- 7-й таб «Правила категорий» — аккордеон с техниками, MOQ, размерами, zone↔tech матрицей
- Секция «Переопределения» в SkuDetailModal

**Фаза 3: Умный визард**
- useEffectiveRules() хук для визарда
- ZoneTechBlock — disabled техники, SizeTable — фильтр размеров
- ColorPicker — фильтр палитры, selectSku — авто defaultExtras + labelPresets
- StepSummary — MOQ warning

**Фаза 4: Продвинутые правила**
- priceMultiplier в getSkuEstPrice() — per-SKU множитель себестоимости
- Per-SKU color picker (swatch grid), Zone↔Tech матрица

**Динамические зоны + per-SKU конфигурация:**
- ZoneDefinition тип + ZONES_CATALOG_DEFAULT (8 зон)
- zonesCatalog в catalogSlice (Supabase + localStorage)
- 8-й таб «Зоны нанесения» — CRUD зон (add/rename/delete)
- Убран хардкод ALL_ZONES из 4 файлов → getAvailableZonesForSku()
- Per-SKU: allowedFabrics, allowedExtras, availableSizes в SkuDetailModal
- Wizard: FabricGrid + ExtrasAccordion фильтруют per-SKU

**Тестирование и качество:**
- Supabase mock в setupTests.js — починены 18 падавших тестов
- 796 unit-тестов (41 файл), все зелёные
- E2E: sku-editor.spec.ts (8 сценариев навигации/табов)
- Аудит: 6 багов найдено и исправлено (pricingDirty, ложный autosave, toast, TECHS дупликат, etc.)
- Мобильная адаптация: горизонтальный скролл табов, compact layout

### Сессия 9 (11.04.2026) — консолидация SKU-редактора (10 файлов)

**Data flow cleanup:**
- Hardware + extras перенесены из useState в Zustand store (catalogSlice)
- Hardware + extras сохраняются в Supabase (app_config) при saveAll()
- Удалён дубль цен: PriceEditor больше не пишет в catalog_config
- Удалено мёртвое поле photoUrl — везде photos[0]
- SkuItem тип обновлён: добавлены photos, description, sizeChart, article
- ExpressCalc читает из store вместо data/ — видит правки из редактора
- Убран дубль input курса USD из actions bar
- Индикатор несохранённых изменений (точка) на всех табах редактора

**Mobile UI:**
- SKU-карточки на step 1: text wrap, auto height, full-width кнопка
- SKU editor table: visible numbers, wider columns, no spinners

### Сессия 8 (10.04.2026) — архитектурные фиксы (10 файлов, 14 новых тестов)

**Каталоги и persistence:**
- catalogs.ts: partial failure logging (catalog_config/app_config падают независимо), валидация обязательных ключей
- catalogSlice.ts: usdRate fallback из localStorage (try + catch), fallback на top-level catalogs.usdRate
- Фикс: usdRate больше не теряется при перезагрузке когда Supabase недоступен

**Auth state machine:**
- Новый тип `ProfileStatus`: active | pending_approval | disabled | no_profile
- useAuthStore.ts: `profileStatus` поле, `fetchProfile` определяет статус по active+approved
- Удалённый пользователь → `user: null` вместо phantom manager (ghost-доступ закрыт)
- types/auth.ts: поле `active: boolean` на User и Profile

**Soft-delete пользователей:**
- Миграция: `ALTER TABLE profiles ADD COLUMN active BOOLEAN NOT NULL DEFAULT true`
- AdminPanel.jsx: деактивация вместо hard delete, кнопка реактивации, визуальный маркер "Деактивирован"

**Dev/prod consistency:**
- useOrdersStore.ts: duplicateOrder фильтрует 'dev' из created_by (как saveOrder)

**SKU фото:**
- storage.ts: deleteSkuPhotoByUrl возвращает boolean, логирует ошибки
- SkuDetailModal.jsx: проверяет результат удаления, toast.error при ошибке

**Тесты:** +14 (catalogs.test.ts — 5, useAuthStore.test.js — 5, useOrdersStore.test.js — 1, storage.test.js — 3)
**Verification:** 735 тестов ✓, lint 0 ошибок, build ✓

### Сессия 7 (10.04.2026) — техдолг, UX/UI, SKU каталог (24 коммита)

**Техдолг:**
- God-компоненты разбиты: SkuEditor (844→419), StepGarment (680→75), KanbanBoard (630→277) → 14 подкомпонентов
- TypeScript: 15 файлов JS→TS (все store/slices, utils, lib включая pricing.ts)
- E2E: 9→40 сценариев (7 файлов), покрытие всех роутов + dark mode
- Recharts→Chart.js: Dashboard 393→199 KB (-49%)
- Lazy-load wizard steps 2-5: main bundle 943→576 KB (-39%)

**5-агентный аудит (26 находок → все закрыты):**
- UX: empty states с иконками, Express redesign, sticky PriceEditor headers
- A11y: focus trap модалки, aria-labels, keyboard DnD (Arrow Left/Right), :focus-visible
- Mobile: touch targets 36px+, scroll affordance, Express stacking
- Design system: button consolidation (7→1 с variants), ~120 spacing tokens, ~40 color tokens, inline→CSS
- CSS: --font-mono баг, ЭКСПРЕСС красный→синий accent

**UX/UI фичи:**
- Dark mode (полная тёмная тема + ~60 CSS фиксов + toggle в хедере)
- Анимации: fadeSlideIn визард, slideInRight drawer, scaleIn модалки, hover-эффекты
- Skeleton loading: shimmer-компоненты для Kanban/Dashboard/Admin
- Wizard progress bar (заполняемая полоска по шагам)
- DnD визуал: ghost card, dashed drop zone, grab cursor
- Onboarding: 3-шаговые tooltips для новых пользователей
- Cmd+K command palette для быстрой навигации
- Zebra striping + hover на всех таблицах
- Kanban card polish: shadow, rounded corners, hover lift
- Garment category icons → заменены на реальные фото/мокапы

**SKU каталог — расширение:**
- SkuDetailModal: модалка полного редактирования SKU (фото, описание, табель мер, зоны, параметры)
- До 4 фото на SKU через Supabase Storage (drag&drop upload)
- Короткое + полное описание, sizeChart с редактируемой таблицей
- Expandable cards в визарде: клик→раскрытие панели с галереей, описанием, размерами, зонами
- Supabase: создана таблица app_config, RLS policies, Storage bucket sku-photos
- Фикс persistence: key mapping sku_catalog→skuCatalog, cache invalidation, localStorage fallback

**Чистка:** PNG из корня, .gitignore, старые планы, обновлены все docs.
**Vercel:** добавлены env-переменные Supabase (фикс белого экрана на проде).

### Сессия 6 (09.04.2026) — закрытие 10-agent аудита
Полное закрытие бэклога `docs/plans/2026-04-09-pinhead-react-audit.md` (30/30 задач).
- **CSS hygiene**: убраны все `!important` из проекта (22 инстанса → 0; остался только задокументированный `@media (prefers-reduced-motion)` как W3C exception). Замена — повышение специфичности селекторов / double-class boost.
- **a11y**: `PriceEditor` — 20 `<div className="pe-input-row">` → `<label>` (неявная ассоциация), aria-label на все matrix-инпуты (screen / flex / markup). KanbanBoard — shortcuts-диалог получил role="dialog" + aria-label.
- **CSS Modules**: инлайн-стили мигрированы из `StepDesign.jsx`, `Dashboard.jsx`, `KanbanBoard.jsx` (дра́вер + shortcuts-модалка + колоночные заголовки). Динамические значения (цвета из STATUS_COLORS, ширины) остаются inline как должно быть.
- **TypeScript**: `useStore.js` → `useStore.ts`, `useOrdersStore.js` → `useOrdersStore.ts`. Типизирован `OrdersStore` интерфейс, `STATUS_LIST/LABELS/COLORS` получили `OrderStatus`-типы, payload-ы описаны через `Order`/`OrderData`. Слайсы `useStore` остаются JS — загнаны через loose `SlicePart` type.
- **E2E**: добавлен `e2e/navigation.spec.ts` — smoke-тесты kanban/express/wizard навигации + открытие shortcuts-диалога по `?` и закрытие по Esc.
- **Verification**: lint 0 errors, 721/721 unit-тестов, build ✓.

### Сессия 5 (08.04.2026)
- Security: убраны хардкод Supabase ключи, .env обязателен
- Security: sanitizeHex XSS-защита SVG мокапов
- Auth: validatePassword + отображение ошибки, storageClearAll при logout
- Docs: консолидация 4 файлов -> CLAUDE.md + PROJECT.md

### Сессия 4 (08.04.2026)
- UI/UX аудит: WCAG AA контраст, design tokens, touch targets 44px, mobile responsive
- PageHeader компонент, нумерация шагов 01-05
- Удалены шаблоны заказов (не нужны)
- Стратегический разворот: Bitrix24 + Pinhead + 1С

### Сессия 3 (07.04.2026)
- Комментарии к заказу, пагинация (50 + загрузить ещё)
- SVG мокап в PrintPreview, keyboard shortcuts в Kanban
- useBlocker (блокировка навигации), дедлайн min/предупреждение
- Store audit: rollback/toast, useShallow (16 селекторов), memo()
- Dashboard lazy — бандл -26% (1537 -> 1142 KB)
- 3 Playwright E2E теста, 15 Claude Code скиллов

### Сессии 1-2 (06.04.2026)
- Фиксы: saveOrder/updateOrder/deleteOrder ошибки Supabase
- Визард 6 -> 5 шагов, кнопка "Повторить заказ"
- Топ артикулов в аналитике

---

## Статистика (10.04.2026, конец сессии 8)

| Метрика | Значение |
|---------|----------|
| Тесты (unit) | 735 |
| Тесты (E2E) | 40 сценариев (7 файлов) |
| TypeScript | store, slices, utils, lib, types — 100% .ts |
| Бандл main | 576 KB (было 943) |
| Бандл Dashboard | 199 KB (было 393) |
| Dark mode | полная поддержка |
| Supabase Storage | sku-photos bucket |
| SKU фото | до 4 на артикул |
| Auth states | active, pending_approval, disabled, no_profile |
| User deletion | soft-delete (active column) |
| God-компоненты (>500 строк) | 0 |

---

## Roadmap

### Закрыто
Все P0/P1/P2 задачи сессий 1-4: баги, качество, UX, UI/UX аудит.

### Фаза 2 — Планирование производства (следующая)
- [ ] Supabase таблицы: production_slots, production_capacity
- [ ] Триггер: approved -> автогенерация слотов
- [ ] ProductionBoard.jsx — недельный/Gantt вид
- [ ] WeeklyCapacity.jsx — бары загрузки
- [ ] useProductionStore.js
- [ ] Загрузка производства в StepDetails (дедлайн)

### Фаза 1 — Bitrix24 sync (после уточнения доступа)
- [ ] Edge Function: bitrix-inbound
- [ ] Edge Function: bitrix-sync
- [ ] integration_sync + status_mapping таблицы
- [ ] Frontend: компонент связи с Bitrix в StepDetails

### Фаза 3 — 1С интеграция
- [ ] Edge Function: 1c-export
- [ ] 1С HTTP Service (нужен 1С-разработчик)

### Фаза 4 — Управленческий дашборд
- [ ] Production heatmap + deadline risk
- [ ] Supabase Realtime подписки

### Арх. фиксы Batch 2 (после текущего PR)
- [ ] Типизация store: замена `Record<string, unknown>` на строгие интерфейсы слайсов
- [ ] Чистка тестовых предупреждений: act() wrapping, глобальный Chart.js/canvas mock
- [ ] Нормализация error objects в storage/catalog слое
- [ ] Консолидация хранения prices (сейчас дублируется в app_config + catalog_config)

### Отклонено / отложено
- Покупательский портал /order — приоритет сменился на CRM/ERP
- TypeScript миграция остальных `utils/pricing.js` (418 строк pricing-движка) + слайсы `useStore` — инкрементально, по мере касания кода
- Split `SkuEditor.jsx` (842 строки god-component на 5 tab'ов) — отложено: низкий ROI без активного касания, высокий риск регрессий
