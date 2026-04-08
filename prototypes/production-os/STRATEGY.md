# Pinhead Production OS — Стратегический анализ и план улучшений

## Context

Прототип Production OS построен (5 экранов, 6 фаз). Перед интеграцией в основной Pinhead OS нужен глубокий анализ: что у конкурентов, где наши gaps, и поэтапный план улучшений.

---

## Конкурентный ландшафт

### Прямые конкуренты (print shop management)

| Продукт | Что делает хорошо | Что делает плохо | Цена |
|---------|-------------------|------------------|------|
| **Printavo** | Простой UX, Production Hub (Kanban), mobile-friendly, онбординг | Нет MES-уровня, нет station tracking, слабая capacity | $99-299/мес |
| **ShopWorx** | Глубокое знание screen printing (ink usage, screen tracking) | Устаревший UI, не mobile-first | — |
| **OnSite** | Feature-rich для крупных цехов | Древний UI, Windows-only, сложный | Enterprise |

### Адаптируемые MES/MRP

| Продукт | Сильная сторона | Слабость для нас | Цена |
|---------|----------------|------------------|------|
| **Katana MRP** | Чистый UI, shop floor app (планшет), real-time tracking | Не garment-specific, generic BOM | $99-799/мес |
| **MRPeasy** | Дёшево, полный MRP цикл | UI слабый, нет mobile kiosk | $49-149/user |
| **JobBOSS2** | Детальный job costing, visual scheduler | Сложная настройка, дорого | Enterprise |
| **Tulip** | No-code station apps, IoT, kiosk mode, лучший UX в индустрии | Нужно строить самому, дорого | Enterprise |
| **Plex** | True enterprise MES, real-time visibility | Слишком тяжёлый для SMB | Enterprise |

### Ключевой вывод

**Рыночная ниша пустая:** Никто не совмещает garment-printing-specific логику (маршруты по технике, зоны печати, artwork) с современным MES-уровнем (station terminals, real-time capacity). Printavo — ближайший, но он только order management без shop floor.

---

## Наши сильные стороны (что уже хорошо)

1. **Workshop-centric архитектура** — каждый цех видит только свою очередь. Это лучше, чем order-centric подход SAP/JobBOSS
2. **Route templates** — авто-маршрутизация по технике печати (screen→до пошива, embroidery→после). Ни один конкурент этого не делает из коробки
3. **Handoff notes** — межцеховая коммуникация как first-class concept. Редкость в MES
4. **Bottleneck detection** — автоматическое определение узких мест + risk assessment
5. **Mobile-first** — bottom nav, touch targets, tablet-ready. Большинство MES = desktop-only
6. **Problem picker** — структурированные типы проблем (не freetext) → основа для качественной аналитики

---

## GAP-анализ vs MES best practices

### CRITICAL (блокеры для production use)

| Gap | Текущее состояние | Что нужно |
|-----|-------------------|-----------|
| **Persistence** | In-memory Zustand, refresh = reset | Supabase таблицы + триггеры |
| **Auth + users** | Нет. Все действия от "Вы" | Интеграция с useAuthStore, profiles |
| **Bridge к заказам** | Mock данные, KanbanMock | Реальная связь: order approved → tasks |
| **Audit trail** | In-memory event log | Immutable Supabase table, user attribution |

### HIGH (нужно для credibility)

| Gap | Что нужно |
|-----|-----------|
| **QC checklists** | Чеклист на этапе Упаковка+ОТК: "Печать OK", "Размеры верны", "Бирки пришиты" |
| **Reporting/export** | PDF daily report, Excel export, shift summary |
| **Worker identity** | Кто взял задачу, кто завершил, throughput per operator |
| **Material tracking** | Базовый: ткань на складе → расход по заказу → остаток |

### MEDIUM (усилители)

| Gap | Что нужно |
|-----|-----------|
| **Equipment management** | Реестр машин, downtime tracking, maintenance schedules |
| **Scheduling optimization** | Параллельные задачи, priority reordering, capacity-based scheduling |
| **Multi-shift** | Смены, handoff между сменами, daily reset |
| **Barcode/QR** | Сканирование для быстрого поиска задачи по заказу |
| **Andon board** | Full-screen TV-режим для цеха (авто-обновление, без интерактива) |

---

## MES UI паттерны для внедрения

### 1. Andon Board (настенный дисплей)
Новый роут `/andon` — full-screen, dark theme, авто-обновление каждые 30 сек. Каждый цех = колонка. Заказы = карточки с PH-XXXX + qty + время в стадии. Красный = просрочен. Читаемость с 10+ метров (шрифт 80px+).

### 2. Kiosk Mode (планшет на рабочем месте)
Расширение TaskDetail → один заказ на весь экран. Одна операция за раз. Кнопки 64px+. Auth через QR-код на карточке заказа (не login form).

### 3. Digital Work Instructions
Пошаговый carousel из данных заказа: (1) SVG mockup с зонами, (2) спецификация цветов/техники, (3) размерная сетка, (4) фото готового результата. Заменяет бумажные ТЗ.

### 4. TV Dashboard
Роут `/dashboard/tv` — dark theme, real-time KPI: заказы сегодня, completion rate, throughput graph (Recharts). Scrolling ticker событий. Авто-refresh.

---

## План улучшений по этапам

### Этап 1: Production-Ready Foundation (2-3 недели)
**Цель:** Из прототипа в рабочую систему в основном Pinhead OS

| # | Задача | Файлы | Дни |
|---|--------|-------|-----|
| 1.1 | Supabase миграция: `workshop_tasks`, `task_events`, `task_comments`, `task_photos` | `supabase/migrations/` | 2 |
| 1.2 | DB trigger: order → approved → generate tasks по route template | `supabase/migrations/` | 1 |
| 1.3 | `useWorkshopStore` → Supabase CRUD (replace in-memory) | `pinhead-react/src/store/` | 3 |
| 1.4 | Auth integration: workshop_code в profiles, user attribution | `pinhead-react/src/store/useAuthStore.js` | 2 |
| 1.5 | Bridge: KanbanBoard → OrderTimeline в OrderDrawer для production заказов | `pinhead-react/src/components/orders/KanbanBoard.jsx` | 2 |
| 1.6 | Immutable audit trail (task_audit table + SECURITY DEFINER) | `supabase/migrations/` | 1 |
| 1.7 | Роуты в App.jsx: /workshop, /director, /capacity | `pinhead-react/src/App.jsx` | 1 |
| 1.8 | Supabase Realtime подписка для live-обновлений | `pinhead-react/src/store/` | 1 |

### Этап 2: Quality & Reporting (2 недели)
**Цель:** Credibility для реального использования

| # | Задача | Дни |
|---|--------|-----|
| 2.1 | QC checklist на этапе Упаковка+ОТК (configurable items) | 2 |
| 2.2 | Defect tracking: тип дефекта, количество брака, % годных | 2 |
| 2.3 | PDF daily report (Recharts → canvas → PDF) | 2 |
| 2.4 | Worker performance: throughput per operator, avg cycle time | 2 |
| 2.5 | Shift summary: что сделано за смену, что осталось | 1 |

### Этап 3: Shop Floor Experience (2 недели)
**Цель:** Удобство для операторов на полу цеха

| # | Задача | Дни |
|---|--------|-----|
| 3.1 | Andon Board: `/andon` — full-screen, dark, авто-refresh | 3 |
| 3.2 | Kiosk Mode: расширенный TaskDetail на весь экран | 2 |
| 3.3 | QR Scanner: камера → поиск задачи по order_number | 2 |
| 3.4 | Digital Work Instructions: carousel из данных заказа | 2 |
| 3.5 | Offline support: Service Worker cache task list | 1 |

### Этап 4: Smart Planning (2 недели)
**Цель:** Интеллектуальное планирование

| # | Задача | Дни |
|---|--------|-----|
| 4.1 | Capacity-based scheduling: назначение дат по загрузке | 3 |
| 4.2 | Parallel tasks: screen+embroidery одновременно (разное оборудование) | 2 |
| 4.3 | Batch optimization: группировка заказов с одинаковой краской/техникой | 3 |
| 4.4 | Deadline prediction: ML-based ETA на основе historical throughput | 2 |

### Этап 5: Material & Equipment (2 недели)
**Цель:** Полный MES

| # | Задача | Дни |
|---|--------|-----|
| 5.1 | Material tracking: ткань на складе → расход → остаток | 3 |
| 5.2 | Equipment registry: машины, статус, downtime log | 2 |
| 5.3 | Maintenance schedules: planned maintenance с уведомлениями | 2 |
| 5.4 | Cost tracking: себестоимость операции per order | 3 |

### Этап 6: Enterprise Features (ongoing)
| Задача |
|--------|
| Multi-shift support + shift handoff |
| API layer для внешних интеграций (1C, Bitrix) |
| Customer portal: клиент видит прогресс заказа |
| Mobile app (PWA → App Store) |
| OEE (Overall Equipment Effectiveness) metrics |

---

## Позиционирование

**"Shopify для управления производством в типографии"**

- Простой, opinionated, вертикальный
- Не для 100 индустрий — для одной, но идеально
- Из коробки понимает screen/DTG/DTF/embroidery маршруты
- Workshop-first UX (не ERP admin-first)
- Интегрирован с заказами от менеджера до готового продукта

---

## Верификация (после Этапа 1)

1. Менеджер создаёт заказ в визарде → approve → задачи появляются в workshop board
2. Оператор раскроя открывает /workshop → видит задачу → НАЧАТЬ → ГОТОВО → handoff в следующий цех
3. Следующий цех видит задачу с handoff note через Realtime (без refresh)
4. Все задачи done → order.status автоматически = done на Kanban
5. Директор видит /director с реальными данными из Supabase
6. Event log persisted — refresh не теряет историю
7. `npm run lint && npm run test && npm run build` — 0 ошибок
