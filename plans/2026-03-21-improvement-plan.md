# План улучшения PinheadOS

> Дата: 2026-03-21
> Размер: L (архитектурные изменения, 10+ файлов)
> Основано на: `thoughts/research/2026-03-20-full-project-audit.md`

---

## Приоритеты

```
P0 = блокирует пользователей / теряет данные
P1 = значительно влияет на качество / поддерживаемость
P2 = улучшает опыт / расширяет возможности
P3 = nice-to-have
```

---

## ФАЗА 1: Надёжность (P0-P1)

### 1.1 Error Boundary + глобальная обработка ошибок
**Проблема:** Любая ошибка React = белый экран, Supabase-ошибки молча проглатываются
**Решение:**
- [ ] Создать `ErrorBoundary.jsx` — оборачивает `<App>`, показывает fallback UI с кнопкой "Перезагрузить"
- [ ] Добавить `window.onerror` + `unhandledrejection` → toast с сообщением
- [ ] Обернуть все Supabase-вызовы в единый helper с обработкой ошибок
- [ ] Заменить пустые catch-блоки на toast.error с понятным сообщением
**Файлы:** App.jsx, useOrdersStore.js, useAuthStore.js, PriceEditor.jsx, lib/supabase.js
**Оценка:** S (3-5 файлов)

### 1.2 Тесты на критический бизнес-код
**Проблема:** pricing.js, useStore, useOrdersStore, StepSummary — без тестов. 53% покрытие.
**Решение:**
- [ ] `pricing.test.js` — unit-тесты: базовая цена, скидки по объёму, surcharge каждой техники, extras, labels, urgency, edge cases (0 qty, пустые зоны)
- [ ] `useStore.test.js` — навигация, multi-item CRUD, loadOrder/saveOrder, draft restore
- [ ] `useOrdersStore.test.js` — fetchOrders, saveOrder, updateStatus, deleteOrder, duplicateOrder
- [ ] `StepSummary.test.jsx` — валидация, расчёт итога, save flow
- [ ] `StepGarment.test.jsx` — выбор SKU/ткани/цвета, размеры, custom sizes
- [ ] `StepDesign.test.jsx` — зоны, техники, параметры
**Файлы:** 6 новых тестовых файлов
**Оценка:** M (6-8 файлов, сложная логика)

### 1.3 Input validation & sanitization
**Проблема:** Текстовые поля (name, notes, phone) идут в БД без проверки
**Решение:**
- [ ] Создать `utils/validate.js` — sanitizeText (trim, max length), validatePhone, validateEmail
- [ ] Применить в StepDetails.jsx перед сохранением
- [ ] Добавить maxLength на все text inputs
- [ ] Валидация в useStore.saveCurrentItem() и StepSummary перед save
**Файлы:** новый validate.js, StepDetails.jsx, useStore.js, StepSummary.jsx
**Оценка:** S

---

## ФАЗА 2: Архитектура (P1)

### 2.1 Разделение useStore на доменные сторы
**Проблема:** Монолитный стор 486 строк, 14-строчные селекторы, сложно поддерживать
**Решение:**
- [ ] `useWizardStore.js` — step/maxStep, навигация, goToStep/nextStep/prevStep
- [ ] `useProductStore.js` — sku, fabric, color, fit, sizes, customSizes, extras, labels
- [ ] `useDesignStore.js` — zones, zoneTechs, zonePrints, flex/dtg/emb/dtf zones
- [ ] `useItemsStore.js` — items[], saveCurrentItem, addNewItem, editItem, removeItem
- [ ] `useDraftStore.js` — draft persistence (объединить с useDraft.js)
- [ ] Создать `store/selectors.js` — переиспользуемые составные селекторы
- [ ] Обновить все компоненты на новые сторы
**Файлы:** 5 новых сторов, 1 selectors, обновление ~15 компонентов
**Оценка:** L (крупный рефакторинг, фазы 2a-2d)

### 2.2 CSS Modules
**Проблема:** Глобальные CSS, 56 inline-стилей, риск конфликтов
**Решение:**
- [ ] Перейти на CSS Modules: `*.module.css` для каждого компонента
- [ ] Убрать inline-стили, перенести в модули
- [ ] Оставить `styles/tokens.css` для CSS-переменных (глобальный)
- [ ] Оставить `styles/reset.css` для базовых стилей
**Файлы:** 11 CSS → ~20 module.css файлов
**Оценка:** M-L

### 2.3 Централизация утилит
**Проблема:** localStorage, Supabase-вызовы, zone helpers — дублируются
**Решение:**
- [ ] `lib/storage.js` — get/set/remove с JSON parse/stringify, error handling
- [ ] `lib/api.js` — обёртка над Supabase с retry, error handling, toast
- [ ] `utils/zones.js` — zone helpers, format/color/area constants (из ZoneTechBlock, StepDesign)
- [ ] Supabase key → env variable (`VITE_SUPABASE_ANON_KEY`)
**Файлы:** 3 новых утилита, обновление 8-10 компонентов
**Оценка:** M

---

## ФАЗА 3: UX / Accessibility (P1-P2)

### 3.1 Accessibility (a11y)
**Проблема:** 3/10 по a11y, нет aria-атрибутов, icon buttons без label
**Решение:**
- [ ] `aria-hidden="true"` на декоративные SVG (App.jsx)
- [ ] `aria-label` на все icon-only кнопки (⎘, ✕, бургер, и т.д.)
- [ ] `role="dialog"` + `aria-modal` на модальные окна / drawers
- [ ] Связать `<label htmlFor>` со всеми input
- [ ] `aria-live="polite"` на Toast
- [ ] Keyboard navigation: focus trap в drawer, Escape для закрытия
- [ ] Skip-to-content link
**Файлы:** Header, KanbanBoard, StepDetails, Toast, App.jsx + все формы
**Оценка:** M

### 3.2 Price breakdown
**Проблема:** Пользователь видит только итоговую цену, не понимает из чего она складывается
**Решение:**
- [ ] Расширить `calcItemTotal()` → возвращать объект `{ base, extras, labels, print, pack, discount, urgent, total }`
- [ ] `PriceBreakdown.jsx` — компонент-таблица с раскладкой
- [ ] Показывать в StepSummary и StepItems (hover/expand)
- [ ] В PrintPreview — полная раскладка для клиента
**Файлы:** pricing.js, новый PriceBreakdown.jsx, StepSummary, StepItems, PrintPreview
**Оценка:** M

### 3.3 Улучшение wizard UX
**Проблема:** Edit item → назад на шаг 0; непоследовательная валидация
**Решение:**
- [ ] При "Редактировать" item — переход на шаг, где нужны изменения (не всегда 0)
- [ ] Inline-валидация на всех шагах (не только по клику)
- [ ] Help-текст / tooltips для техник нанесения
- [ ] Прогресс-индикатор заполненности каждого шага
- [ ] Подтверждение перед удалением item
**Файлы:** StepItems, ProgressBar, StepDesign, StepGarment, useStore
**Оценка:** M

---

## ФАЗА 4: TypeScript миграция (P1)

### 4.1 Постепенная миграция на TypeScript
**Проблема:** Нет типов → рантайм-ошибки, сложный рефакторинг, нет IDE autocomplete
**Решение (поэтапно):**
- [ ] **Этап A:** Добавить `tsconfig.json`, настроить Vite на `.tsx`, `allowJs: true`
- [ ] **Этап B:** Типы данных: `types/order.ts`, `types/catalog.ts`, `types/pricing.ts`, `types/auth.ts`
- [ ] **Этап C:** Утилиты → `.ts`: pricing.ts, mockup.ts, validate.ts, storage.ts
- [ ] **Этап D:** Сторы → `.ts`: useAuthStore, useToastStore, useOrdersStore
- [ ] **Этап E:** Компоненты → `.tsx` (от простых к сложным): Toast → Header → Steps → Editors
- [ ] **Этап F:** Strict mode: `noImplicitAny`, `strictNullChecks`
**Файлы:** Все (~40 файлов)
**Оценка:** L (многофазная миграция, 2-3 сессии)

---

## ФАЗА 5: Новый функционал (P2)

### 5.1 Загрузка артворка
**Проблема:** Зоны нанесения настраиваются, но макет/файл нельзя прикрепить
**Решение:**
- [ ] Supabase Storage bucket `artworks`
- [ ] Компонент `ArtworkUpload.jsx` — drag-drop, preview, crop
- [ ] Привязка файла к zone в `zonePrints`
- [ ] Отображение в PrintPreview и TechCard
**Оценка:** M

### 5.2 Уведомления о статусе
**Проблема:** Смена статуса заказа — никто не оповещён
**Решение:**
- [ ] Supabase Edge Function → webhook при смене статуса
- [ ] Email через Resend/Sendgrid (клиенту и менеджеру)
- [ ] Telegram bot (опционально) через Bot API
- [ ] In-app notifications (bell icon в header)
**Оценка:** M-L

### 5.3 Пагинация и поиск заказов
**Проблема:** Лимит 200 заказов, нет пагинации
**Решение:**
- [ ] Cursor-based pagination в useOrdersStore
- [ ] Server-side фильтрация (статус, дата, менеджер)
- [ ] Full-text search по order_number, client name
- [ ] Date range picker
**Оценка:** M

### 5.4 Bitrix CRM интеграция
**Проблема:** Deal ID хранится, но нет синхронизации
**Решение:**
- [ ] Supabase Edge Function ↔ Bitrix24 REST API
- [ ] Создание сделки при сохранении заказа
- [ ] Обновление стадии при смене статуса
- [ ] Webhook от Bitrix → обновление в PinheadOS
**Оценка:** L

---

## ФАЗА 6: DevOps & Качество (P2)

### 6.1 Pre-commit hooks
**Проблема:** Нет pre-commit → можно коммитнуть с lint-ошибками
**Решение:**
- [ ] Husky + lint-staged
- [ ] Pre-commit: ESLint + Prettier
- [ ] Commit-msg: conventional commits (commitlint)
**Оценка:** S

### 6.2 Мониторинг и логирование
**Проблема:** Ошибки в проде невидимы
**Решение:**
- [ ] Sentry для error tracking
- [ ] Structured logging (console.error → Sentry.captureException)
- [ ] Performance monitoring (LCP, FID, CLS)
**Оценка:** S-M

### 6.3 Storybook для компонентов
**Проблема:** Нет документации компонентов, сложно тестировать UI изолированно
**Решение:**
- [ ] Storybook 8 + React
- [ ] Stories для всех shared/layout компонентов
- [ ] Chromatic для visual review (опционально)
**Оценка:** M

---

## Дорожная карта

```
Неделя 1:  ФАЗА 1 — Надёжность
           1.1 Error Boundary (1 день)
           1.2 Тесты критического кода (2-3 дня)
           1.3 Input validation (1 день)

Неделя 2:  ФАЗА 3 — UX
           3.1 Accessibility (2 дня)
           3.2 Price breakdown (1 день)
           3.3 Wizard UX (2 дня)

Неделя 3:  ФАЗА 2 — Архитектура
           2.3 Централизация утилит (1 день)
           2.1 Разделение стора (3-4 дня)

Неделя 4:  ФАЗА 2 продолжение + ФАЗА 6
           2.2 CSS Modules (2-3 дня)
           6.1 Pre-commit hooks (0.5 дня)

Неделя 5-6: ФАЗА 4 — TypeScript
           Этапы A-F поэтапно

Неделя 7+: ФАЗА 5 — Новый функционал
           5.1 Artwork upload
           5.2 Уведомления
           5.3 Пагинация
           5.4 Bitrix интеграция
```

---

## Challenge Loop

### 1. Решает ли план проблему?
Да — покрывает все критические находки из аудита:
- Надёжность (ошибки, тесты, валидация) ✓
- Архитектура (стор, CSS, утилиты) ✓
- UX (a11y, price breakdown, wizard) ✓
- Типизация (TypeScript) ✓
- Новые фичи (artwork, уведомления, Bitrix) ✓

### 2. Лучшее ли это решение?
| Альтернатива | За | Против | Вердикт |
|-------------|-----|--------|---------|
| Полный rewrite на Next.js + TS | SSR, современный стек | Потеря 8k строк рабочего кода, 2+ месяца | ❌ Слишком дорого |
| Оставить как есть, только фичи | Быстро | Технический долг растёт, баги множатся | ❌ Рискованно |
| **Поэтапное улучшение** | Сохраняет рабочий код, управляемые риски | Медленнее полного rewrite | ✅ Оптимально |

### 3. Нет ли "кода ради кода"?
- CSS Modules можно отложить если нет реальных конфликтов → переместить в P3
- Storybook — nice-to-have, не блокирует ничего → P3
- TypeScript strict mode — делать после стабилизации, не раньше → Этап F отдельно

---

## Следующий шаг

Начать с **Фазы 1.1: Error Boundary** — наименьшие усилия, максимальный эффект на стабильность.
