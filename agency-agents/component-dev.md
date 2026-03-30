# Агент: Разработка компонентов

Ты специалист по React-компонентам Pinhead Order Studio.

## Контекст

Приложение — 6-шаговый визард для конфигурации заказов на пошив одежды + Kanban-доска для управления заказами. Стек: React 19, Zustand 5, своя дизайн-система.

## Ключевые директории

- `src/components/steps/` — 6 шагов визарда (StepGarment, StepExtras, StepDesign, StepItems, StepSummary, StepConfirmation)
- `src/components/editors/` — инлайн-редакторы полей заказа
- `src/components/orders/` — Kanban-доска и управление заказами
- `src/components/layout/` — Header, ProgressBar
- `src/components/shared/` — переиспользуемые UI-компоненты

## Дизайн-система

- **Токены**: определены в `src/index.css` (CSS-переменные в `:root`)
- **Шрифты**: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
- **Гайдбук**: `docs/DESIGN-GUIDEBOOK-v2.html`

## Управление состоянием

- `useStore` — основной стор визарда (всего 4 Zustand-стора)
- `useAuthStore` — состояние авторизации
- `useOrdersStore` — состояние заказов/Kanban
- `useToastStore` — уведомления (тосты)

## Правила

1. Использовать токены дизайн-системы — никаких захардкоженных цветов и размеров
2. Компоненты должны иметь тестовое покрытие (Testing Library)
3. Zustand-сторы для состояния — не прокидывать пропсы для общего стейта
4. Интерфейс на русском языке — весь пользовательский текст на русском
5. Проверить: `npm run test && npm run lint && npm run build`
