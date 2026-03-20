# PINHEAD ORDER STUDIO — Полные данные проекта

## Общая информация

| Параметр | Значение |
|----------|----------|
| Название | Pinhead Order Studio |
| Назначение | Конфигуратор заказов на пошив одежды с нанесением (шелкография, flex, DTG, вышивка, DTF) |
| Тип | SPA (Single Page Application) |
| Язык интерфейса | Русский |
| Деплой | Vercel |
| База данных | Supabase (PostgreSQL) |
| Коммитов в истории | 138 |
| Последний PR | #63 |

---

## Стек технологий

### Frontend
- **React 19.2** — UI framework
- **Vite 7.3** — сборщик / dev-сервер
- **Zustand 5.0** — state management (4 стора)
- **React Router DOM 7.13** — маршрутизация (SPA)
- **Recharts 3.7** — графики/аналитика
- **QRCode 1.5** — генерация QR-кодов
- **Agentation 2.2** — dev-инструмент для AI-контекста (только admin)

### Backend / Data
- **Supabase JS SDK 2.98** — авторизация, БД, RLS
- **Supabase Auth** — email/password регистрация, сессии
- **PostgreSQL (Supabase)** — таблицы: `orders`, `profiles`, `app_config`, `catalog_config`, `order_audit`
- **Row Level Security (RLS)** — разграничение доступа по ролям

### Тестирование
- **Vitest 4.0** — тест-раннер
- **Testing Library (React 16.3)** — рендер-тесты компонентов
- **jsdom 29.0** — DOM-окружение для тестов

### Линтинг
- **ESLint 9.39** — flat config
- **eslint-plugin-react-hooks** — правила хуков
- **eslint-plugin-react-refresh** — правила HMR

### CI/CD
- **GitHub Actions** — `npm ci → lint → test` на Node 20
- **Vercel** — автодеплой, SPA rewrites

---

## Структура файлов

```
PinheadOS/
├── .github/workflows/ci.yml          # GitHub Actions CI
├── .gitignore
├── CHANGELOG-2026-03-03.md            # v1.7 session 1
├── CHANGELOG-2026-03-04.md            # v1.7 session 2
├── MIGRATION-PLAN.md                  # План миграции vanilla → React
├── vercel.json                        # Vercel деплой конфиг
├── supabase/
│   └── migrations/
│       └── 20260320_order_audit_log.sql  # Аудит-лог статусов
└── pinhead-react/                     # React-приложение
    ├── package.json
    ├── vite.config.js
    ├── eslint.config.js
    ├── .env.example
    ├── index.html
    ├── supabase-config.sql            # app_config таблица
    ├── supabase-rls.sql               # RLS политики orders/profiles
    ├── public/
    │   ├── favicon.svg
    │   └── vite.svg
    ├── scripts/
    │   ├── seed-catalog.js            # Сид каталогов в Supabase
    │   ├── seed-catalog.sql           # SQL-версия сидов
    │   ├── generate-seed-sql.js       # Генератор SQL из JS данных
    │   └── migrate-catalog-price-guard.sql
    └── src/
        ├── main.jsx                   # Точка входа + draft restore
        ├── App.jsx                    # Роутинг + авторизация + layout
        ├── index.css                  # Глобальные стили
        ├── setupTests.js              # Vitest setup
        ├── assets/garments/           # SVG мокапы (6 шт.)
        │   ├── hoodie.svg
        │   ├── longsleeve.svg
        │   ├── polo.svg
        │   ├── shopper.svg
        │   ├── sweatshirt.svg
        │   └── tshirt.svg
        ├── components/
        │   ├── layout/
        │   │   ├── Header.jsx         # 106 строк — навигация, юзер-меню
        │   │   └── ProgressBar.jsx    # 41 строка — шаги визарда
        │   ├── steps/                 # 6 шагов конфигуратора
        │   │   ├── StepGarment.jsx    # 521 строка — выбор изделия/ткани/цвета/размеров
        │   │   ├── StepExtras.jsx     # 83 строки — обработки (люверсы, молнии и т.д.)
        │   │   ├── StepDesign.jsx     # 185 строк — зоны нанесения + бирки
        │   │   ├── StepItems.jsx      # 130 строк — мульти-позиции (список товаров)
        │   │   ├── StepDetails.jsx    # 126 строк — данные клиента
        │   │   ├── StepSummary.jsx    # 437 строк — сводка + сохранение
        │   │   ├── ZoneTechBlock.jsx  # 178 строк — настройка техники для зоны
        │   │   ├── ZoneMockup.jsx     # 183 строки — SVG мокап с зонами
        │   │   └── LabelConfigurator.jsx # 221 строка — настройка бирок
        │   ├── orders/
        │   │   └── KanbanBoard.jsx    # 476 строк — канбан-доска (lazy)
        │   ├── editors/
        │   │   ├── PriceEditor.jsx    # 547 строк — редактор цен (lazy)
        │   │   ├── ExpressCalc.jsx    # 498 строк — экспресс-калькулятор (lazy)
        │   │   └── SkuEditor.jsx      # 703 строки — редактор SKU-каталога
        │   ├── output/
        │   │   └── PrintPreview.jsx   # 319 строк — печать ТЗ
        │   ├── production/
        │   │   └── TechCard.jsx       # 407 строк — тех. карта
        │   ├── analytics/
        │   │   └── Dashboard.jsx      # 455 строк — аналитика (Recharts)
        │   ├── auth/
        │   │   ├── AuthScreen.jsx     # 106 строк — логин/регистрация
        │   │   └── AdminPanel.jsx     # 221 строка — управление юзерами (lazy)
        │   └── shared/
        │       └── Toast.jsx          # 18 строк — уведомления
        ├── store/                     # Zustand сторы
        │   ├── useStore.js            # 465 строк — заказ + каталоги + мульти-позиции
        │   ├── useAuthStore.js        # 114 строк — авторизация
        │   ├── useOrdersStore.js      # 214 строк — CRUD заказов
        │   └── useToastStore.js       # 17 строк — уведомления
        ├── data/                      # Статические данные (fallback)
        │   ├── index.js               # Реэкспорт всех данных
        │   ├── skuCatalog.js          # SKU каталог (46 строк)
        │   ├── fabricsCatalog.js       # Каталог тканей (40 строк)
        │   ├── colors.js              # Палитры цветов (189 строк)
        │   ├── prices.js              # Матрицы цен (70 строк)
        │   ├── extras.js              # Обработки, бирки, фурнитура (134 строки)
        │   └── constants.js           # Размеры, названия, курс $ (39 строк)
        ├── hooks/
        │   └── useDraft.js            # 92 строки — автосохранение в localStorage
        ├── lib/
        │   ├── supabase.js            # 6 строк — Supabase клиент
        │   └── catalogs.js            # 53 строки — загрузка каталогов + кэш
        ├── utils/
        │   ├── pricing.js             # 301 строка — движок ценообразования
        │   └── mockup.js              # 66 строк — позиции зон на мокапе
        └── styles/                    # CSS модули
            ├── index.css              # 30 строк — импорт всех стилей
            ├── layout.css             # 111 строк
            ├── garment.css            # 277 строк
            ├── forms-buttons.css      # 350 строк
            ├── extras-zones.css       # 229 строк
            ├── editors.css            # 277 строк
            ├── utils.css              # 201 строка
            ├── wizard.css             # 104 строки
            ├── kanban.css             # 96 строк
            ├── express.css            # 89 строк
            └── auth.css               # 31 строка
```

---

## Статистика кода

| Метрика | Значение |
|---------|----------|
| Файлов JS/JSX (без тестов) | 35 |
| Строк JS/JSX (без тестов) | 8 033 |
| Файлов тестов | 21 |
| Строк тестов | 5 312 |
| Файлов CSS | 12 |
| Строк CSS | 1 855 |
| **Итого строк** | **~15 200** |
| SVG-ассеты | 6 (garment mockups) |
| SQL-миграции | 3 |

---

## Маршруты (React Router)

| Путь | Компонент | Доступ |
|------|-----------|--------|
| `/` | WizardPage (6 шагов) | Все авторизованные |
| `/orders` | KanbanBoard (lazy) | Все авторизованные |
| `/print` | PrintPreview | Все авторизованные |
| `/express` | ExpressCalc (lazy) | canEdit (не production/designer) |
| `/prices` | PriceEditor (lazy) | canEdit |
| `/sku` | SkuEditor | canEdit |
| `/admin` | AdminPanel (lazy) | admin, director |
| `/analytics` | Dashboard | admin, director, rop, production |

---

## Роли пользователей

| Роль | Права |
|------|-------|
| `admin` | Полный доступ, управление юзерами, Agentation |
| `director` | Как admin |
| `rop` | Видит все заказы, аналитику, не может редактировать каталоги |
| `manager` | Видит только свои заказы, создаёт заказы |
| `production` | Видит approved/production заказы, аналитику |
| `designer` | Ограниченный доступ, без редакторов |

---

## Zustand Store

### useStore (основной) — 465 строк
- **Навигация:** step, maxStep, goToStep, nextStep, prevStep
- **SKU:** selectSku, setSkuFilter, reorderSku
- **Ткань/Цвет:** selectFabric, selectColor, setColorSupplier
- **Крой:** selectFit (regular/oversized)
- **Размеры:** setSize, setOneSizeQty, addCustomSize, removeCustomSize
- **Обработки:** toggleExtra
- **Зоны нанесения:** toggleZone, setZoneTech, setZoneParam, toggleNoPrint
- **Бирки:** setLabelConfig, toggleCareLabel
- **Мульти-позиции:** items[], saveCurrentItem, addNewItem, editItem, removeItem
- **Каталоги:** loadCatalogs (из Supabase → fallback на JS)
- **Черновик:** restoreFromDraft, автосохранение в localStorage
- **Опции:** togglePack, toggleUrgent
- **loadOrder:** восстановление заказа из Supabase

### useAuthStore — 114 строк
- init (DEV_MODE bypass), fetchProfile, login, register, logout
- Role helpers: isAdmin, isROP, isProduction, isDesigner

### useOrdersStore — 214 строк
- fetchOrders (с фильтрацией по роли)
- saveOrder (INSERT + PH-XXXX нумерация)
- updateOrder, patchOrderData
- updateStatus (optimistic + rollback)
- deleteOrder, duplicateOrder
- getFiltered (по статусу + поиск)

### useToastStore — 17 строк
- toast.success(), toast.error(), toast.warning()

---

## Шаги конфигуратора (Wizard)

| Шаг | Компонент | Описание |
|-----|-----------|----------|
| 0 | StepGarment | Выбор SKU, ткани, цвета, кроя, размеров |
| 1 | StepExtras | Обработки (люверсы, шнурки, молнии и т.д.) |
| 2 | StepDesign | Зоны нанесения + техника + бирки |
| 3 | StepItems | Список позиций (мульти-товар) |
| 4 | StepDetails | Данные клиента (имя, телефон, email, дедлайн) |
| 5 | StepSummary | Сводка заказа + сохранение/обновление |

---

## Движок ценообразования (pricing.js)

### Техники нанесения
| Техника | Параметры | Особенности |
|---------|-----------|-------------|
| Шелкография (screen) | формат, цвета(1-8), текстиль(white/color), спецэффект | Матрица по тиражу: 50/100/300/500/700/1000 шт. |
| Flex | формат(A6-A3), цвета(1-3) | Отдельные цены для <20 и матрица для 20/35/50+ |
| DTG | формат, текстиль | Базовая цена + надбавка за формат/цветной текстиль |
| Вышивка (embroidery) | площадь(s/m/l), цвета | База + площадь + цвета |
| DTF | формат | База + формат |

### Формула расчёта
```
unitPrice = discountedBase + extras + labels + print + pack
total = totalQty × (unitPrice + urgentSurcharge)
```
- `discountedBase` = базовая цена SKU × (1 - скидка за объём)
- `urgentSurcharge` = unitPrice × 20% (если срочность)
- Скидка за объём: тиры из `PRICES.volumeTiers/volumeDiscounts`

---

## Supabase — схема БД

### Таблицы
| Таблица | Назначение |
|---------|------------|
| `orders` | Заказы (id, order_number, status, data JSONB, total_sum, total_qty, item_type, bitrix_deal, notes, created_by, created_at) |
| `profiles` | Профили юзеров (id, name, email, role, approved) |
| `app_config` | Общие настройки (key-value JSONB) |
| `catalog_config` | Каталоги (prices, skuCatalog, fabricsCatalog, ...) — key-value JSONB |
| `order_audit` | Аудит-лог (order_id, changed_by, changed_at, field, old_value, new_value) |

### Статусы заказов
| Статус | Цвет | Русское название |
|--------|------|------------------|
| `draft` | #888 (серый) | Черновик |
| `review` | #b89000 (жёлтый) | На проверке |
| `approved` | #1D19EA (синий) | Подтверждён |
| `production` | #c04500 (оранжевый) | В производстве |
| `done` | #007840 (зелёный) | Готов |

### RLS политики
- Менеджер видит только свои заказы (`created_by = auth.uid()`)
- admin/director/rop видят все
- production видит только `approved` и `production`
- INSERT — любой авторизованный
- UPDATE — свои заказы или admin/rop
- DELETE — только admin/director
- `catalog_config` с ключом `prices` скрыт от менеджеров

### Аудит-триггер
- `order_audit` — автологирование изменений `status` и `total_sum` через SECURITY DEFINER триггер

---

## Environment Variables

```env
SUPABASE_URL=https://pulzirakjqehsulmjhdj.supabase.co
SUPABASE_SERVICE_KEY=            # Service role key (для seed-скриптов)
```

Publishable key захардкожен в `src/lib/supabase.js`.

---

## CI/CD Pipeline

```yaml
# .github/workflows/ci.yml
on: push/PR → main
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup-node 20 (npm cache)
      - npm ci
      - npm run lint
      - npm run test
```

---

## Vercel Config

```json
{
  "buildCommand": "cd pinhead-react && npm install && npm run build",
  "outputDirectory": "pinhead-react/dist",
  "framework": null,
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

---

## NPM Scripts

| Команда | Действие |
|---------|----------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build → dist/ |
| `npm run lint` | ESLint проверка |
| `npm run test` | Vitest (all tests) |
| `npm run preview` | Preview production build |
| `npm run seed` | Загрузка каталогов в Supabase |
| `npm run seed:sql` | Генерация SQL из JS данных |

---

## Ключевые особенности

1. **Мульти-позиции** — один заказ может содержать несколько изделий с разными SKU/тканями/техниками
2. **5 техник нанесения** — шелкография, flex, DTG, вышивка, DTF — каждая с индивидуальными параметрами
3. **Конфигуратор бирок** — Care label, Main label, Hang tag с опциями материала/размещения
4. **Канбан-доска** — drag & drop по 5 статусам с поиском и фильтрами
5. **Автосохранение** — черновик в localStorage, восстановление при перезагрузке
6. **DEV MODE** — в dev-режиме авторизация пропускается (admin by default)
7. **Lazy loading** — KanbanBoard, PriceEditor, ExpressCalc, AdminPanel загружаются по требованию
8. **Каталоги из Supabase** — с sessionStorage кэшем (30 мин) и JS fallback
9. **Print Preview** — генерация ТЗ с секциями, таблицами, логотипом для печати
10. **Аналитика** — Dashboard с графиками Recharts (заказы, обороты, статусы)
11. **Ролевая модель** — 6 ролей с RLS на уровне БД + UI-ограничения
12. **QR-коды** — генерация через qrcode библиотеку
13. **Bitrix интеграция** — поле bitrix_deal для связи с CRM
14. **Экспресс-калькулятор** — быстрый расчёт без полного визарда
15. **SKU/Price Editor** — админские инструменты для управления каталогами и ценами
