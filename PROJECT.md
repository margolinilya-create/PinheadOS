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

## Статистика (10.04.2026, конец сессии 7)

| Метрика | Значение |
|---------|----------|
| Коммитов за сессию | 24 |
| Тесты (unit) | 721 |
| Тесты (E2E) | 40 сценариев (7 файлов) |
| TypeScript | store, slices, utils, lib — 100% .ts |
| Бандл main | 576 KB (было 943) |
| Бандл Dashboard | 199 KB (было 393) |
| Dark mode | полная поддержка |
| Supabase Storage | sku-photos bucket |
| SKU фото | до 4 на артикул |
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

### Отклонено / отложено
- Покупательский портал /order — приоритет сменился на CRM/ERP
- TypeScript миграция остальных `utils/pricing.js` (418 строк pricing-движка) + слайсы `useStore` — инкрементально, по мере касания кода
- Split `SkuEditor.jsx` (842 строки god-component на 5 tab'ов) — отложено: низкий ROI без активного касания, высокий риск регрессий
