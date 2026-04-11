# Pinhead Order Studio — Сводный аудит UI/UX (10.04.2026)

5 параллельных аудитов: UI/UX дизайн, Accessibility, Перформанс, Mobile, Design System.

---

## P0 — Критические проблемы

| # | Область | Проблема | Где |
|---|---------|----------|-----|
| 1 | A11y | **Drag-and-drop без клавиатурной альтернативы** — Kanban карточки и SKU drag-reorder недоступны без мыши | KanbanCard.jsx, SkuList.jsx |
| 2 | A11y | **Цветовые свотчи — выбор передаётся только цветом** — нет чекмарка/иконки для дальтоников | ColorPicker.jsx |
| 3 | UX | **Пустые состояния — просто текст** — Kanban (5×"Перетащите"), Analytics ("Нет данных"), Admin ("Заказов нет") — нет иконок, CTA, подсказок | KanbanBoard, Dashboard, AdminPanel |
| 4 | UX | **Express калькулятор — правая панель выглядит недоделанной** — серый "+" и текст без контекста | ExpressCalc.jsx |

## P1 — Важные улучшения

| # | Область | Проблема | Где |
|---|---------|----------|-----|
| 5 | Mobile | **Хедер без hamburger-меню** — 9 пунктов навигации overflow на 375px, нет индикатора скролла | Header.jsx, layout.css |
| 6 | Mobile | **PriceEditor неюзабелен на мобилке** — 8-колоночная матрица без адаптации | PriceEditor, editors.css |
| 7 | Mobile | ~~**SkuEditor таблицы overflow** — 11 колонок, нет мобильного layout~~ ✅ Закрыто в сессии 10: column hiding + auto layout + scoped rules | SkuEditor, editors.css |
| 8 | UX | **Красный цвет семантически перегружен** — кнопка ЭКСПРЕСС + ошибки + urgent badge — всё красное | Header, nav styles |
| 9 | UX | **PriceEditor — нет sticky headers/навигации** — 200+ строк скролла без якорей | PriceEditor.jsx |
| 10 | Perf | **Main bundle 939 KB** — wizard steps 2-5 не lazy-loaded | App.jsx |
| 11 | Design | **7+ вариантов кнопок** — нет единого Button компонента | Все CSS файлы |
| 12 | Design | **85 хардкод цветов в CSS + 45 в JSX** — токены не используются повсеместно | Все файлы |
| 13 | Design | **~120 хардкод spacing в px** — токены --space-* не применяются | Все CSS файлы |
| 14 | A11y | **Mobile status select без label** | KanbanCard.jsx |
| 15 | A11y | **Kanban context menu — нет role="menu", нет focus trap** | KanbanCard.jsx |
| 16 | A11y | **Нет видимых :focus-visible стилей** на кастомных элементах | Все CSS |

## P2 — Улучшения

| # | Область | Проблема | Где |
|---|---------|----------|-----|
| 17 | Design | **3 разных семейства input-стилей** — sku-edit-input, pe-input, default | editors.css |
| 18 | Design | **~15 static inline styles** остались в JSX | SkuEditor, ExtrasAccordion |
| 19 | Design | **~40 хардкод font-size** — не используют --type-* токены | Все CSS |
| 20 | Perf | **Recharts 393 KB** — Dashboard lazy, но тяжёлый. Альтернатива: Chart.js (~60 KB) | Dashboard.jsx |
| 21 | Perf | **CSS не code-split** — 123 KB грузится целиком | styles/ |
| 22 | Mobile | **Kanban горизонтальный скролл без affordance** — нет тени/индикатора | kanban.css |
| 23 | Mobile | **Express layout не стекается** — две колонки жмутся вместо stack | forms.css |
| 24 | A11y | **Toast без aria-live** — уведомления не анонсируются screen reader | Toast.jsx |
| 25 | A11y | **SizeTable add-form inputs без label** | SizeTable.jsx |
| 26 | A11y | **Shortcuts dialog не закрывается по Escape** | KanbanBoard.jsx |

---

## Что уже хорошо

- **Навигация** — хедер консистентный, активные табы контрастные
- **Типографика** — 3-font система (Barlow/Inter/Mono) работает
- **Store subscriptions** — useShallow везде, нет лишних рендеров
- **Lazy loading** — 7 из 8 роутов lazy (кроме wizard steps)
- **Focus trap** — OrderDrawer использует useFocusTrap
- **Keyboard support** — swatches, fabric cards, garment rows — tabIndex + onKeyDown
- **Skip-to-content** — ссылка есть
- **Touch targets** — 44px на основных элементах
- **Mobile SizeTable** — dual rendering (table/list) — хороший паттерн
- **Mobile Kanban** — select для статуса вместо drag — хороший fallback

---

## Рекомендуемый порядок работы

### Wave 1 — Quick wins (P0)
- Empty states с иконками и CTA
- Чекмарк на выбранных свотчах
- aria-label на mobile select

### Wave 2 — Mobile (P1)
- Hamburger-меню в хедере
- PriceEditor мобильная адаптация
- ~~SkuEditor мобильная адаптация~~ ✅ Сессия 10

### Wave 3 — Design system (P1)
- Button компонент (consolidate 7 вариантов)
- Миграция хардкод цветов → токены
- Spacing токены

### Wave 4 — Performance (P1)
- Lazy-load wizard steps 2-5
- Prefetch критичных chunks

### Wave 5 — A11y polish (P1-P2)
- Keyboard DnD альтернатива для Kanban
- Focus styles на кастомных элементах
- aria-live для Toast
