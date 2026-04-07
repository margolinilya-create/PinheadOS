# PINHEAD Order Studio — Project Skill
**Версия:** 1.0 · 06.04.2026  
**Назначение:** Контекст для Claude при работе с проектом

---

## 1. Что такое проект

**Pinhead Order Studio** — внутренняя система приёма заказов на пошив одежды с нанесением.  
Используют: менеджеры компании Pinhead.  
Будут использовать: покупатели (покупательский портал — P3).

**Деплой:** Vercel (автодеплой из main)  
**БД:** Supabase (PostgreSQL + Auth + RLS)  
**Репо:** PinheadOS / pinhead-react/

---

## 2. Стек

| Слой | Технология |
|------|-----------|
| UI | React 19 + Vite 7 |
| State | Zustand 5 (4 стора + slices) |
| Router | React Router 7 (`createBrowserRouter`) |
| DB/Auth | Supabase JS SDK 2 |
| Тесты | Vitest 4 + RTL + Playwright |
| CSS | Vanilla CSS (глобальный, 12 файлов) |
| CI/CD | GitHub Actions → Vercel |

**Текущих тестов:** 722 (все зелёные)  
**Шагов визарда:** 5 (было 6 — объединили обработки в аккордеон)

---

## 3. Структура файлов

```
pinhead-react/src/
├── App.jsx                  # Роутинг + ErrorBoundary + useBlocker
├── main.jsx                 # createBrowserRouter (не BrowserRouter!)
├── components/
│   ├── steps/               # 5 шагов визарда
│   │   ├── StepGarment.jsx  # Шаг 0: SKU + ткань + цвет + размеры + аккордеон обработок
│   │   ├── StepDesign.jsx   # Шаг 1: зоны + техника + аккордеон бирок + путь к макетам
│   │   ├── StepItems.jsx    # Шаг 2: список позиций (multi-SKU)
│   │   ├── StepDetails.jsx  # Шаг 3: имя, телефон, дедлайн (min=сегодня)
│   │   ├── StepSummary.jsx  # Шаг 4: итог + сохранение
│   │   ├── ZoneTechBlock.jsx  # Параметры техники для зоны (с TECH_HELP подсказками)
│   │   ├── ZoneMockup.jsx     # SVG мокап изделия с зонами
│   │   └── LabelConfigurator.jsx  # Бирки (внутри аккордеона StepDesign)
│   ├── orders/
│   │   └── KanbanBoard.jsx  # Канбан + handleDuplicate → loadOrder → navigate('/')
│   ├── editors/
│   │   ├── PriceEditor.jsx  # Редактор цен (lazy, только admin)
│   │   ├── SkuEditor.jsx    # Редактор SKU каталога
│   │   └── ExpressCalc.jsx  # Экспресс-калькулятор (lazy)
│   ├── output/
│   │   └── PrintPreview.jsx # Печать ТЗ (показывает artworkPath если заполнен)
│   ├── analytics/
│   │   └── Dashboard.jsx    # Recharts + топ артикулов + фильтр периода
│   ├── auth/
│   │   ├── AuthScreen.jsx   # Логин/регистрация
│   │   └── AdminPanel.jsx   # Управление юзерами (lazy)
│   ├── layout/
│   │   ├── Header.jsx       # Навигация
│   │   └── ProgressBar.jsx  # Прогресс 01-05
│   └── shared/
│       ├── Toast.jsx        # Уведомления
│       ├── ErrorBoundary.jsx  # Уже реализован, обёрнут вокруг App
│       └── RolePreviewBar.jsx
├── store/
│   ├── useStore.js          # Объединяет все slices
│   ├── useAuthStore.js      # Auth + роли
│   ├── useOrdersStore.js    # CRUD заказов
│   ├── useToastStore.js     # toast.success/error/warning
│   └── slices/
│       ├── wizardSlice.js   # step, maxStep, goToStep, nextStep, prevStep
│       ├── productSlice.js  # sku, fabric, color, fit, sizes
│       ├── designSlice.js   # zones, zoneTechs, artworkPath, designNotes
│       ├── itemsSlice.js    # items[], editItem → step 1 (Дизайн)
│       ├── detailsSlice.js  # name, phone, email, deadline, notes
│       ├── catalogSlice.js  # loadCatalogs (toast.warning при fallback)
│       ├── orderSlice.js    # loadOrder, resetOrder, restoreFromDraft
│       └── helpers.js       # snapshotItem, restoreItem, ITEM_FIELDS
├── hooks/
│   └── useDraft.js          # Автосохранение в localStorage (DRAFT_FIELDS)
├── lib/
│   ├── supabase.js          # Supabase клиент
│   ├── storage.js           # storageGet/Set/Remove (обёртка localStorage)
│   └── catalogs.js          # loadCatalogs + sessionStorage кэш 30 мин
├── utils/
│   ├── pricing.js           # calcItemTotal, calcItemBreakdown, calcOrderTotal
│   └── mockup.js            # Позиции зон на SVG мокапе
├── data/                    # Fallback данные (если Supabase недоступен)
│   ├── index.js
│   ├── skuCatalog.js
│   ├── fabricsCatalog.js
│   ├── colors.js
│   ├── prices.js
│   ├── extras.js
│   └── constants.js
└── styles/                  # 12 глобальных CSS файлов
    ├── index.css
    ├── layout.css
    ├── garment.css
    ├── forms-buttons.css
    ├── extras-zones.css
    ├── editors.css
    ├── utils.css
    ├── wizard.css
    ├── kanban.css
    ├── express.css
    └── auth.css
```

---

## 4. Маршруты

| Путь | Компонент | Доступ |
|------|-----------|--------|
| `/` | WizardPage (5 шагов) | Все авторизованные |
| `/orders` | KanbanBoard (lazy) | Все авторизованные |
| `/print` | PrintPreview | Все авторизованные |
| `/express` | ExpressCalc (lazy) | canEdit |
| `/prices` | PriceEditor (lazy) | admin, director |
| `/sku` | SkuEditor | admin, director |
| `/admin` | AdminPanel (lazy) | admin, director |
| `/analytics` | Dashboard | admin, director, rop, production |

---

## 5. Роли

| Роль | Права |
|------|-------|
| `admin` / `director` | Полный доступ |
| `rop` | Все заказы + аналитика, без редакторов |
| `manager` | Только свои заказы |
| `production` | Только approved/production заказы |
| `designer` | Ограниченный доступ |

**DEV_MODE:** `import.meta.env.DEV` — в dev авторизация пропускается (role=admin). В продакшне Vite автоматически ставит DEV=false.

---

## 6. Zustand — важные паттерны

```js
// ПРАВИЛЬНО — useShallow для объектов
const { step, saved } = useStore(useShallow(s => ({ step: s.step, saved: s.saved })));

// ПРАВИЛЬНО — прямой селектор для одного значения
const step = useStore(s => s.step);

// НЕПРАВИЛЬНО — вызов без селектора (лишние ре-рендеры)
const store = useStore();
```

**Сторы:**
- `useStore` — основной (объединяет slices)
- `useAuthStore` — авторизация
- `useOrdersStore` — CRUD заказов
- `useToastStore` — `toast.success/error/warning`

---

## 7. Supabase — схема БД

| Таблица | Назначение |
|---------|-----------|
| `orders` | id, order_number (PH-XXXX), status, data JSONB, total_sum, total_qty, created_by |
| `profiles` | id, name, email, role, approved |
| `app_config` | key-value настройки |
| `catalog_config` | prices, skuCatalog, fabricsCatalog и др. |
| `order_audit` | Лог изменений статусов |

**Статусы:** draft → review → approved → production → done

**ВАЖНО по saveOrder/updateOrder:**
- При ошибке Supabase возвращать `null` (не fallback объект)
- StepSummary проверяет `if (saved)` — при null черновик НЕ удаляется
- deleteOrder ждёт ответа Supabase перед удалением из UI

---

## 8. Правила кода (CODE STYLE)

### Что делаем
- `useShallow` для всех объектных селекторов Zustand
- `toast.error` при каждой Supabase ошибке (не silent catch)
- Возвращать `null` из async функций при ошибке
- Новые CSS классы добавлять в существующие файлы `styles/`
- Inline стили только для динамических значений
- Компоненты — функциональные, хуки сверху

### Чего не делаем
- Не создавать новые CSS файлы без необходимости
- Не трогать TypeScript (проект на JS)
- Не рефакторить useStore — он разделён на slices, этого достаточно
- Не добавлять новые зависимости без обсуждения
- Не делать optimistic delete (только после успеха Supabase)
- Не использовать `BrowserRouter` — только `createBrowserRouter`

### Тесты
После каждого изменения: `npm test -- --run`  
Текущий baseline: **722 теста зелёные**  
Если тест упал — чиним до коммита, не пропускаем

### Коммиты
```
feat(scope): короткое описание
fix(scope): короткое описание
docs(scope): короткое описание
```

---

## 9. Визард — шаги и нумерация

```
Индекс  Название        Компонент
  0     Изделие         StepGarment  (SKU + ткань + цвет + размеры + аккордеон обработок)
  1     Дизайн          StepDesign   (зоны + техника + аккордеон бирок + путь к макетам)
  2     Позиции         StepItems    (список позиций)
  3     Детали          StepDetails  (клиент + дедлайн)
  4     Итог            StepSummary  (сводка + сохранение)
```

**editItem(idx)** — переходит на шаг 1 (Дизайн), не на 0  
**ProgressBar** показывает: 01 Изделие / 02 Дизайн / 03 Позиции / 04 Детали / 05 Итог

---

## 10. Известные особенности и решения

| Ситуация | Решение |
|----------|---------|
| Хранилище файлов | Путь к папке на сервере (\\server\files\PH-0042) — текстом, кнопка копирования |
| Bitrix интеграция | Поле bitrix_deal есть, API синхронизация — отложено |
| Покупательский портал | P3, не начат |
| Уведомления команде | Не приоритет |
| TypeScript | Не мигрируем |
| CSS Modules | Только для новых компонентов если нужно |
| Print Preview | Показывает artworkPath если заполнен |

---

## 11. Файлы документации в репо

| Файл | Содержимое |
|------|-----------|
| `PROJECT-MASTER.md` | Полный анализ проекта, история версий |
| `ACTION-PLAN.md` | Список задач с приоритетами и статусами |
| `PINHEAD-SKILL.md` | Этот файл — контекст для Claude |
| `docs/PINHEAD-PORTAL-LOGIC.md` | Логика визарда (этапы 1-2 описаны) |

---

*Обновлять при каждом значимом изменении архитектуры или добавлении фичи*
