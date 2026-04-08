# PINHEAD Order Studio — Project Skill
**Версия:** 2.0 · 08.04.2026  
**Назначение:** Контекст для Claude при работе с проектом

---

## 1. Что такое проект

**Pinhead Order Studio** — система управления заказами на пошив одежды с нанесением.  
Сейчас: внутренний инструмент менеджеров + производства.  
Цель: **полная синхронизация отдела продаж ↔ производства** через Bitrix24 + Pinhead + 1С.

**Деплой:** Vercel (автодеплой из main)  
**БД:** Supabase (PostgreSQL + Auth + RLS)  
**Интеграции (план):** Bitrix24 REST API, 1С HTTP Services

---

## 2. Стек

| Слой | Технология |
|------|-----------|
| UI | React 19 + Vite 7 |
| State | Zustand 5 (4 стора + slices) |
| Router | React Router 7 (`createBrowserRouter`) |
| DB/Auth | Supabase JS SDK 2 |
| Тесты | Vitest 4 + RTL + Playwright |
| CSS | Vanilla CSS (12 файлов + design tokens) |
| CI/CD | GitHub Actions → Vercel |
| MCP | Playwright MCP (браузерное тестирование) |

**Тестов:** 723 unit + 3 E2E  
**Шагов визарда:** 5 (Изделие → Дизайн → Позиции → Детали → Итог)

---

## 3. Структура файлов

```
pinhead-react/src/
├── App.jsx                  # createBrowserRouter + useBlocker + ErrorBoundary
├── main.jsx                 # createBrowserRouter (НЕ BrowserRouter)
├── index.css                # Design tokens: type/spacing/z-index scale
├── components/
│   ├── steps/               # 5 шагов визарда
│   │   ├── StepGarment.jsx  # SKU + ткань + цвет + размеры + аккордеон обработок
│   │   ├── StepDesign.jsx   # зоны + техника + аккордеон бирок + путь к макетам
│   │   ├── StepItems.jsx    # список позиций (multi-SKU)
│   │   ├── StepDetails.jsx  # имя, телефон, дедлайн (min=сегодня, autofocus)
│   │   └── StepSummary.jsx  # итог + сохранение
│   ├── orders/
│   │   └── KanbanBoard.jsx  # Канбан + memo + хоткеи (/, n, ?, 1-5) + комментарии
│   ├── analytics/
│   │   └── Dashboard.jsx    # Recharts (lazy) + топ артикулов + PageHeader
│   ├── output/
│   │   └── PrintPreview.jsx # ТЗ + SVG мокап + artworkPath + ПЕЧАТЬ/PDF
│   ├── shared/
│   │   ├── PageHeader.jsx   # Единый хедер: ← Назад, title, badge, tabs
│   │   ├── ErrorBoundary.jsx
│   │   └── Toast.jsx
│   └── layout/
│       ├── Header.jsx
│       └── ProgressBar.jsx  # 01-05 + галочки заполненности
├── store/
│   ├── useStore.js          # Объединяет slices
│   ├── useOrdersStore.js    # CRUD + пагинация (50/page) + null на ошибку
│   ├── useCommentsStore.js  # Комментарии к заказам
│   ├── useAuthStore.js
│   ├── useToastStore.js
│   └── slices/
│       ├── wizardSlice.js   # nextStep saves item at step 1→2
│       ├── productSlice.js
│       ├── designSlice.js   # artworkPath
│       ├── itemsSlice.js    # editItem → step 1 (Дизайн)
│       ├── detailsSlice.js
│       ├── catalogSlice.js  # toast.warning при fallback
│       └── orderSlice.js    # loadOrder → step 4, maxStep 4
├── hooks/useDraft.js        # Автосохранение (DRAFT_FIELDS включает artworkPath)
├── utils/pricing.js         # calcItemTotal, calcItemBreakdown
└── styles/                  # 12 файлов + design tokens в index.css
```

---

## 4. Маршруты

| Путь | Компонент | Доступ |
|------|-----------|--------|
| `/` | WizardPage (5 шагов) | Все |
| `/orders` | KanbanBoard (lazy) | Все |
| `/print` | PrintPreview | Все |
| `/express` | ExpressCalc (lazy) | canEdit |
| `/prices` | PriceEditor (lazy) | admin |
| `/sku` | SkuEditor | admin |
| `/admin` | AdminPanel (lazy) | admin |
| `/analytics` | Dashboard (lazy) | admin, rop, production |

---

## 5. Правила кода

### Делаем
- `useShallow` для объектных селекторов Zustand
- `toast.error` при каждой Supabase ошибке
- `return null` из async при ошибке (не fallback объект)
- Optimistic update ТОЛЬКО с rollback
- НЕ optimistic delete — ждать Supabase
- `createBrowserRouter` (не BrowserRouter)
- CSS токены из `:root` (--type-*, --space-*, --z-*)
- Autofocus на первом поле формы

### Не делаем
- Не добавлять зависимости без обсуждения
- Не TypeScript (проект на JS)
- Не CSS Modules для существующих компонентов
- Не `!important` (25 уже есть, не добавлять новые)

### Тесты
Baseline: **723 unit + 3 E2E**. Если упало — чиним до коммита.

### Коммиты
`feat(scope):` / `fix(scope):` / `docs:` / `perf:` / `refactor:`

---

## 6. Supabase — схема

| Таблица | Назначение |
|---------|-----------|
| `orders` | id, order_number (PH-XXXX), status, data JSONB, bitrix_deal |
| `profiles` | id, name, email, role, approved |
| `order_comments` | Комментарии к заказам |
| `order_audit` | Лог изменений статусов |
| `app_config` | Конфигурация (цены, каталоги) |

**Статусы:** draft → review → approved → production → done

**Планируемые таблицы (Фаза 2):**
- `production_slots` — операции по заказу (раскрой/пошив/печать/упаковка)
- `production_capacity` — недельная мощность по операциям
- `integration_sync` — статус синхронизации с Bitrix24/1С
- `status_mapping` — маппинг статусов между системами

---

## 7. Стратегическое направление

**Цель:** Синхронизация продаж ↔ производства

```
Bitrix24 (CRM) ←→ Pinhead (Order Studio) ←→ 1С (Бухгалтерия)
  Сделки            Заказы + ТЗ              Учёт
  Клиенты           Производство              Документы
  Воронка           Plan/Capacity             Себестоимость
```

**Фазы:**
1. Production Planning (доска производства, загрузка, Gantt) ← СЛЕДУЮЩАЯ
2. Bitrix24 sync (webhook, Edge Functions)
3. 1С интеграция (HTTP Service)
4. Управленческий дашборд

---

## 8. Файлы документации

| Файл | Содержимое |
|------|-----------|
| `PINHEAD-SKILL.md` | Этот файл — контекст для Claude |
| `ACTION-PLAN.md` | Задачи с приоритетами и статусами |
| `CHANGELOG.md` | Changelog по сессиям |
| `PINHEAD-PROJECT-MASTER.md` | История проекта (ERA 1-3) |
| `docs/PINHEAD-PORTAL-LOGIC.md` | Логика визарда |
| `tests/E2E-TEST-PLAN.md` | 56 E2E сценариев |

---

*Обновлять при каждом значимом изменении*
