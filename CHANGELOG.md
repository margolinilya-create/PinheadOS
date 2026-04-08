# PINHEAD Order Studio — Changelog

---

## [08.04.2026] — Сессия 4

### UI/UX аудит и фиксы
- Контраст текста WCAG AA: #999→#666 (5.7:1 на белом)
- Design tokens: type scale, spacing scale, z-index scale в :root
- Touch targets: 44px minimum на мобильном (zone-param, zone-fx, zone-colors)
- Mobile responsive: auth.css, express.css, editors.css (были без @media)
- Zone cards: div→button с aria-pressed и focus-visible
- Autofocus на формах (AuthScreen email, StepDetails имя)
- Hardcoded #fff→var(--white) в kanban, forms-buttons, editors
- z-index конфликты устранены (9999/10000→токены --z-toast/--z-modal)

### Стандартизация хедеров
- Новый компонент PageHeader: ← Назад, title, badge, actions, tabs
- Dashboard и AdminPanel переведены на PageHeader
- Нумерация шагов исправлена: 01-05 (было 01,03,04,05,06)

### Удалено
- Шаблоны заказов (useTemplatesStore) — не нужны

### Стратегический разворот
- Цель проекта: синхронизация продаж↔производства (Bitrix24 + Pinhead + 1С)
- Спроектирована 4-фазная архитектура интеграции

---
Тестов: 723 unit + 3 E2E ✅ | Коммитов за сессию: 8

---

## [07.04.2026] — Сессия 3

### Новый функционал
- Комментарии к заказу (order_comments в Supabase)
- Пагинация заказов: 50 за раз + «Загрузить ещё»
- Папка с макетами: путь к файлам + кнопка копирования
- SVG мокап изделия в PrintPreview
- OrderDrawer: мульти-позиции, контакты, менеджер, артворк
- Keyboard shortcuts в Kanban (/, n, ?, 1-5)
- Кнопки «ПЕЧАТЬ» и «СКАЧАТЬ PDF» в PrintPreview

### UX улучшения
- Блокировка навигации (useBlocker) — «Заказ не сохранён»
- Бирки в аккордеон на шаге Дизайн
- editItem → сразу на Дизайн (не Изделие)
- Дедлайн: min=сегодня, предупреждение < 3 дней
- Галочки заполненности шагов в прогресс-баре
- Мобильная оптимизация: свотчи, размеры, фильтры
- Топ менеджеров по managerName (не по клиенту)

### Качество
- Store audit: rollback/toast во всех async функциях
- useShallow в 7 компонентах (16 селекторов)
- memo() на KanbanCard и OrderDrawer
- Dashboard lazy — бандл −26% (1537→1142 KB)
- 24 новых теста (comments, templates, ErrorBoundary)
- 3 Playwright E2E теста

### Инфраструктура
- 15 Claude Code скиллов + 5 агентов
- Playwright MCP для браузерного тестирования
- E2E Test Plan: 56 сценариев

---
Тестов: 733→723 (удалены templates) + 3 E2E ✅ | Коммитов: 25

---

## [06.04.2026] — Сессия 1–2

### Исправления багов
- saveOrder возвращает null при ошибке Supabase
- updateOrder: rollback при ошибке + null
- deleteOrder: подтверждение + ожидание ответа сервера

### Новый функционал
- Кнопка «Повторить заказ» — дублирует и открывает в визарде
- Топ артикулов в аналитике
- Toast при загрузке каталогов из офлайн-кэша

### UX улучшения
- Визард 6→5 шагов (обработки в аккордеон)

### Документация
- PINHEAD-PROJECT-MASTER.md — единый мастер-документ

---
Тестов: 722 ✅ | Коммитов: 9
