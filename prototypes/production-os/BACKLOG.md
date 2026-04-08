# Production OS — Backlog (по результатам аудита 10 агентов)

## Critical

| # | Категория | Проблема | Файл(ы) | Фикс |
|---|-----------|----------|---------|------|
| 1 | Performance | Inline `<style>` перепарсиваются каждый рендер | Все 19 компонентов | Вынести в CSS Modules |
| 2 | A11y | Нет focus trap в модалках | TaskDetail, HandoffDialog | `useFocusTrap` или `<dialog>` |
| 3 | A11y | TaskCard/QCChecklist — div с onClick без keyboard support | TaskCard, QCChecklist | `role="button" tabIndex={0} onKeyDown` |
| 4 | A11y | Нет focus management при открытии/закрытии drawer | TaskDetail | `useRef` + focus restore |
| 5 | State | `reportDefect` не пишет в event log | useWorkshopStore | Добавить `_addEvent` |
| 6 | State | `startTask` нет guard — можно "начать" done-задачу | useWorkshopStore | Guard: `if (status !== 'ready') return` |
| 7 | Data | Module-level counters (`eventId++`) — race condition | useWorkshopStore | Заменить на `crypto.randomUUID()` |

## High

| # | Категория | Проблема | Файл(ы) | Фикс |
|---|-----------|----------|---------|------|
| 8 | Performance | `useWorkshopTasks` — двойная подписка | useWorkshopStore | Один селектор с `useShallow` |
| 9 | Performance | TaskCard подписан на ВСЮ карту orders | TaskCard | `s => s.orders[task.order_id]` |
| 10 | Performance | Clock 1s ре-рендерит всё дерево | AndonBoard, TVDashboard | Extract `<Clock />` + `React.memo` children |
| 11 | Quality | TYPE_NAMES/FABRIC_NAMES дублированы в 6 файлах | TaskCard, TaskDetail, KioskView, WorkInstructions, AndonBoard, BatchView | Shared `src/data/labels.js` |
| 12 | Quality | 7 компонентов > 600 строк | TaskDetail (897), AnalyticsView (800), WorkInstructions (775), etc. | Split на sub-components |
| 13 | Quality | Duplicate risk assessment logic | CapacityBoard, DirectorView | Shared `assessOrderRisk()` |
| 14 | Quality | Duplicate `formatClock`/`formatDate` | AndonBoard, TVDashboard | Shared `src/utils/format.js` |
| 15 | A11y | Нет `aria-label` на фильтрах | WorkshopBoard | Добавить aria-labels |
| 16 | A11y | Нет `aria-live` regions | WorkshopBoard, QCChecklist | `aria-live="polite"` |
| 17 | A11y | Color-only status на left bar | TaskCard | Добавить текст/иконку |
| 18 | Mobile | NavBar overflow на 375px | NavBar | Icons-only на mobile или bottom sheet |
| 19 | Mobile | Quick buttons 36px < 44px minimum | TaskCard | `min-height: 44px` |
| 20 | Data | Tasks = flat array, O(n) на каждый рендер | useWorkshopStore | Normalize: Map по id |
| 21 | Data | `unblockTask` → ready вместо in_progress | useWorkshopStore | Resume to previous state |
| 22 | Data | Workers не привязаны к задачам | workers.js, tasks.js | Добавить `assigned_to` |
| 23 | Bundle | Нет code-splitting (React.lazy) | App.jsx | Lazy load все роуты |
| 24 | State | `useTasksByOrder` — новый массив каждый рендер | useWorkshopStore | `useShallow` + memoize |
| 25 | State | TaskDetail подписан на весь tasks[] | TaskDetail | `s.tasks.find(t => t.id === s.selectedTaskId)` |

## Medium

| # | Категория | Проблема | Фикс |
|---|-----------|----------|------|
| 26 | Security | Defect count без bounds validation | Clamp в store action |
| 27 | Security | Фото без лимита размера/количества | `file.size < 5MB`, max 10 per task |
| 28 | Security | Комментарии без max length | Truncate 2000 chars |
| 29 | Quality | `!important` в WorkshopSelector | Убрать, переписать CSS |
| 30 | Quality | `86400000` magic number в 4 файлах | `const MS_PER_DAY` |
| 31 | Quality | QC_ITEM_IDS hardcoded в store и в компоненте | Single source of truth |
| 32 | Quality | Нет null/error handling при missing data | Fallback UI + error boundaries |
| 33 | Mobile | CapacityBoard heatmap нечитаем на 375px | Responsive grid fix |
| 34 | Mobile | `--type-label: 11px` мелко для mobile | `12px` на `< 768px` |
| 35 | Mobile | KanbanMock detail close 28px | `44px` |
| 36 | A11y | Нет `prefers-reduced-motion` | Media query в tokens.css |
| 37 | A11y | Photo upload label без keyboard focus | `<button>` + ref |
| 38 | Data | Нет multi-item orders в моках | Добавить 1-2 заказа с 2+ items |
| 39 | Data | `completeTask` — post-set `_addEvent` может дать duplicate ID | UUID вместо counter |
| 40 | Performance | `forceRefresh` в TVDashboard бесполезен | Удалить |
| 41 | Performance | `handleQuickDone` использует setTimeout hack | Chain actions в одном store action |

## UX Copy (русский)

| # | Файл | Было | Должно быть |
|---|------|------|-------------|
| 42 | NavBar | "Dashboard" | "Панель" |
| 43 | NavBar | "Kanban" | "Канбан" |
| 44 | NavBar | "TV" | "ТВ" |
| 45 | DirectorView | "Control Tower" | "Центр управления" |
| 46 | WorkshopBoard | "Dashboard →" | "Панель →" |
| 47 | DirectorView | "задачи заблокировано" | "задачи заблокированы" |
| 48 | Mixed | "операция" vs "задача" | Стандартизировать "задача" |
| 49 | Mixed | "оп." vs "опер." | Стандартизировать одну форму |

## Production Readiness (для интеграции в Pinhead OS)

**Критический путь (2-3 недели):**
1. Supabase tables: workshop_tasks, task_events, task_comments, task_photos, workshops
2. DB trigger: order.status → approved → generate tasks
3. useWorkshopStore → Supabase CRUD + Realtime
4. Auth: profiles.workshop_code + user attribution
5. Bridge: OrderTimeline → KanbanBoard OrderDrawer
6. Tests: unit + e2e для task lifecycle
7. Routes в основном App.jsx с RoleGuard + lazy loading
8. Admin-configurable: workshops, route templates, QC items
