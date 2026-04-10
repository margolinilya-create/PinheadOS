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

## Статистика (09.04.2026)

| Метрика | Значение |
|---------|----------|
| Тесты (unit) | 721 |
| Тесты (E2E) | 8 (wizard + visual + navigation) |
| Файлы исходников | 55+ |
| Бандл index.js | ~940 KB |
| Шагов визарда | 5 |
| Стор-файлы в TypeScript | 6 / 6 |
| `!important` в CSS | 0 (только WCAG reduced-motion) |

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
