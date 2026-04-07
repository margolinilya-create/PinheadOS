---
name: software-architecture
description: Use when designing new modules, planning large features, or making architectural decisions for Pinhead Order Studio. Triggers on "как лучше организовать", "архитектура", "покупательский портал", "новый модуль", "structure", "architecture", "design pattern".
---

# Software Architecture — Pinhead Order Studio

Принципы и паттерны для принятия архитектурных решений.

## Текущая архитектура

```
React 19 (UI)
  └── Zustand 5 (State) — разделён на slices
       ├── wizardSlice    — навигация по шагам
       ├── productSlice   — SKU, ткань, цвет, размеры
       ├── designSlice    — зоны, техники, artworkPath
       ├── itemsSlice     — мульти-позиции
       ├── detailsSlice   — данные клиента
       ├── catalogSlice   — загрузка каталогов
       └── orderSlice     — loadOrder, resetOrder

Supabase (Backend)
  ├── orders            — заказы
  ├── profiles          — пользователи + роли
  ├── catalog_config    — SKU, ткани, цены (JSONB)
  ├── order_comments    — комментарии
  ├── order_templates   — шаблоны
  └── order_audit       — лог изменений
```

---

## Правила для новых фич

### 1. Новый функционал — новый slice или store
Не добавляй в существующий useStore если это отдельная доменная область.

```
Новая область — новый файл:
- useCommentsStore.js — (уже сделано)
- useTemplatesStore.js — (уже сделано)
- usePortalStore.js — для покупательского портала
```

### 2. Supabase — всегда null при ошибке
Все async функции работающие с Supabase:
- При ошибке: `toast.error(...)` + `return null`
- При успехе: `return data[0]`
- Оптимистичное обновление только с rollback

### 3. Новые компоненты — рядом с тестом
```
components/
  portal/
    PortalWizard.jsx
    PortalWizard.test.jsx   — сразу
```

### 4. Lazy loading для тяжёлых панелей
```js
// Паттерн уже используется в App.jsx
const PortalPage = React.lazy(() => import('./components/portal/PortalPage'));
```

---

## Покупательский портал — архитектурный план

Новый роут `/order` — отдельный модуль, не ломает существующий визард.

```
src/
  components/
    portal/              — новая папка
      PortalWizard.jsx   — упрощённый визард (3 шага)
      PortalStep1.jsx    — изделие + цвет + размеры
      PortalStep2.jsx    — нанесение (только загрузка файла)
      PortalStep3.jsx    — данные + отправить заявку
  store/
    usePortalStore.js    — отдельный store, не трогает useStore
```

**Ключевое решение:** портал использует те же каталоги (`useCatalogStore`) и ту же `saveOrder()` из `useOrdersStore`, но имеет свой упрощённый UI и свой store для состояния.

---

## Чеклист перед реализацией крупной фичи

- [ ] Нарисовал структуру файлов (2 минуты)
- [ ] Определил какие существующие части переиспользую
- [ ] Определил что нужно новое (store, таблица, компонент)
- [ ] Нет ли циклических зависимостей
- [ ] Нужна ли миграция Supabase — если да, сначала SQL
- [ ] Написал тест перед кодом (см. test-driven-development skill)
