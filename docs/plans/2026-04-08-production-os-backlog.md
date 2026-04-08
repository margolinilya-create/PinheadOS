# Production OS Backlog — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 48 backlog items from the 10-agent audit of the Production OS prototype.

**Architecture:** Bottom-up — shared code first (labels, utils, store fixes), then performance (CSS Modules, selectors), then a11y/mobile/security. Each task is self-contained and committable.

**Tech Stack:** React 19, Zustand 5, Vite 7, CSS Modules, Vitest

**Base path:** `prototypes/production-os/`

---

## Phase 1: Foundation — Shared Code & Store Fixes

### Task 1: Shared labels file (Backlog #11)

TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES duplicated in TaskCard, TaskDetail, KioskView, WorkInstructions, AndonBoard, BatchView.

**Files:**
- Create: `src/data/labels.js`
- Modify: `src/components/TaskCard.jsx` (remove lines 5-33, import from labels)
- Modify: all other components that duplicate these maps

**Step 1: Create shared labels file**

```javascript
// src/data/labels.js
export const TYPE_NAMES = {
  tee: 'Футболка',
  hoodie: 'Худи',
  sweat: 'Свитшот',
  longsleeve: 'Лонгслив',
  shorts: 'Шорты',
};

export const FABRIC_NAMES = {
  kulirnaya: 'Кулирка',
  'futher-350-petlya': 'Футер 350 Петля',
  'futher-350-nachers': 'Футер 350 Начёс',
  'futher-370-petlya': 'Футер 370 Петля',
  interlock: 'Интерлок',
};

export const ZONE_LABELS = {
  chest: 'Грудь',
  back: 'Спина',
  'left-sleeve': 'Лев. рукав',
  'right-sleeve': 'Прав. рукав',
  front: 'Лицевая',
};

export const TECH_NAMES = {
  screen: 'Шелкография',
  dtf: 'DTF',
  embroidery: 'Вышивка',
};
```

**Step 2: Replace in TaskCard.jsx**

Remove lines 5-33 (TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES constants). Add import:
```javascript
import { TYPE_NAMES, FABRIC_NAMES, ZONE_LABELS, TECH_NAMES } from '../data/labels';
```

**Step 3: Find and replace in all other components**

Search for `TYPE_NAMES` and `FABRIC_NAMES` in:
- `TaskDetail.jsx`
- `KioskView.jsx`
- `WorkInstructions.jsx`
- `AndonBoard.jsx`
- `BatchView.jsx`

Remove local declarations, add import from `../data/labels`.

**Step 4: Verify app runs**

Run: `cd prototypes/production-os && npm run dev` — open each page that uses labels, verify labels render correctly.

**Step 5: Commit**

```bash
git add prototypes/production-os/src/data/labels.js prototypes/production-os/src/components/TaskCard.jsx prototypes/production-os/src/components/TaskDetail.jsx prototypes/production-os/src/components/KioskView.jsx prototypes/production-os/src/components/WorkInstructions.jsx prototypes/production-os/src/components/AndonBoard.jsx prototypes/production-os/src/components/BatchView.jsx
git commit -m "refactor: extract shared labels to src/data/labels.js (backlog #11)"
```

---

### Task 2: Shared format utils (Backlog #14, #30)

`formatClock`/`formatDate` duplicated in AndonBoard, TVDashboard. Magic number `86400000` in 4 files.

**Files:**
- Create: `src/utils/format.js`
- Modify: `src/components/AndonBoard.jsx`, `src/components/TVDashboard.jsx`, `src/components/TaskCard.jsx`, other files with `86400000`

**Step 1: Create format utils**

```javascript
// src/utils/format.js
export const MS_PER_DAY = 86400000;

export function formatClock(date = new Date()) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDate(date = new Date()) {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatShortDate(date) {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}
```

**Step 2: Replace in AndonBoard.jsx and TVDashboard.jsx**

Remove local `formatClock`/`formatDate` functions, import from `../utils/format`.

**Step 3: Replace `86400000` everywhere**

Search for `86400000` in all files. Replace with `MS_PER_DAY` import.

In `TaskCard.jsx` line 41:
```javascript
import { MS_PER_DAY } from '../utils/format';
// ...
const diffDays = Math.round((due - today) / MS_PER_DAY);
```

**Step 4: Verify app runs**

**Step 5: Commit**

```bash
git commit -m "refactor: extract format utils and MS_PER_DAY constant (backlog #14, #30)"
```

---

### Task 3: Shared risk assessment (Backlog #13)

Duplicate risk assessment logic in CapacityBoard and DirectorView.

**Files:**
- Create: `src/utils/risk.js`
- Modify: `src/components/CapacityBoard.jsx`, `src/components/DirectorView.jsx`

**Step 1: Find the risk logic**

Read both CapacityBoard.jsx and DirectorView.jsx, find the risk assessment functions.

**Step 2: Extract to `src/utils/risk.js`**

Create shared `assessOrderRisk(order, tasks)` function.

**Step 3: Replace in both components**

Import from `../utils/risk`, remove local implementations.

**Step 4: Verify, commit**

```bash
git commit -m "refactor: extract shared assessOrderRisk (backlog #13)"
```

---

### Task 4: Store — UUID for IDs (Backlog #7, #39)

Module-level counters (`eventId++`, `commentId++`, `notifId++`) are race-condition prone. Also `taskId` in `tasks.js`.

**Files:**
- Modify: `src/store/useWorkshopStore.js` (lines 6-8, 44, 52, 63)

**Step 1: Replace counters with crypto.randomUUID()**

In `useWorkshopStore.js`:
- Remove lines 6-8 (`let eventId = 0; let commentId = 0; let notifId = 0;`)
- Line 44: `const evt = { id: crypto.randomUUID(), ...`
- Line 52: id in notification: `id: crypto.randomUUID(), ...`
- Line 63: id in comment: `id: crypto.randomUUID(), ...`

**Step 2: Verify app runs**

Open TaskDetail, add a comment, verify it appears with a UUID id.

**Step 3: Commit**

```bash
git commit -m "fix: replace module-level ID counters with crypto.randomUUID() (backlog #7, #39)"
```

---

### Task 5: Store — reportDefect event log (Backlog #5)

`reportDefect` doesn't write to event log.

**Files:**
- Modify: `src/store/useWorkshopStore.js` (line 96-101)

**Step 1: Add _addEvent call**

```javascript
reportDefect: (taskId, count, type, notes) => {
  set(state => ({
    defects: {
      ...state.defects,
      [taskId]: { count, type, notes, time: new Date().toISOString() },
    },
  }));
  get()._addEvent(taskId, 'defect', `Брак: ${count} шт — ${type}${notes ? '. ' + notes : ''}`);
},
```

**Step 2: Verify**

Open a task, report a defect, check the event log shows the entry.

**Step 3: Commit**

```bash
git commit -m "fix: reportDefect now writes to event log (backlog #5)"
```

---

### Task 6: Store — startTask guard (Backlog #6)

Can "start" a done task.

**Files:**
- Modify: `src/store/useWorkshopStore.js` (line 109)

**Step 1: Add guard**

```javascript
startTask: (taskId) => {
  const task = get().tasks.find(t => t.id === taskId);
  if (!task || task.status !== 'ready') return;
  // ... rest of logic
```

Move `const task = get().tasks.find(...)` above `set()`, use it for the guard and for the notification.

**Step 2: Commit**

```bash
git commit -m "fix: startTask guard — only ready tasks can be started (backlog #6)"
```

---

### Task 7: Store — unblockTask resume state (Backlog #21)

`unblockTask` sets status to `ready` instead of resuming to `in_progress` if it was in_progress before blocking.

**Files:**
- Modify: `src/store/useWorkshopStore.js`

**Step 1: Save previous status in blockTask**

In `blockTask`, save `previous_status` on the task:
```javascript
blockTask: (taskId, problemType, problemNote) => {
  set(state => ({
    tasks: state.tasks.map(t =>
      t.id === taskId
        ? { ...t, status: 'blocked', previous_status: t.status, problem_type: problemType, problem_note: problemNote || null }
        : t
    ),
    showProblemPicker: false,
  }));
  // ...
```

**Step 2: Restore in unblockTask**

```javascript
unblockTask: (taskId) => {
  set(state => ({
    tasks: state.tasks.map(t =>
      t.id === taskId
        ? { ...t, status: t.previous_status || 'ready', previous_status: null, problem_type: null, problem_note: null }
        : t
    ),
  }));
  get()._addEvent(taskId, 'unblocked', 'Проблема решена');
},
```

**Step 3: Commit**

```bash
git commit -m "fix: unblockTask resumes to previous status (backlog #21)"
```

---

### Task 8: Store — QC_ITEM_IDS single source of truth (Backlog #31)

QC_ITEM_IDS hardcoded in both the store (`isQCComplete`) and QCChecklist component.

**Files:**
- Create or add to: `src/data/workshops.js` — export `QC_ITEM_IDS`
- Modify: `src/store/useWorkshopStore.js` (line 92)
- Modify: `src/components/QCChecklist.jsx`

**Step 1: Add QC_ITEM_IDS to workshops.js**

```javascript
export const QC_ITEMS = [
  { id: 'print_quality', label: 'Качество печати' },
  { id: 'sizes_correct', label: 'Размеры соответствуют' },
  { id: 'labels_attached', label: 'Этикетки пришиты' },
  { id: 'no_defects', label: 'Нет дефектов' },
  { id: 'packaging_ok', label: 'Упаковка ОК' },
  { id: 'qty_match', label: 'Количество совпадает' },
];
export const QC_ITEM_IDS = QC_ITEMS.map(i => i.id);
```

**Step 2: Import in store and component, remove local definitions**

**Step 3: Commit**

```bash
git commit -m "refactor: QC_ITEMS single source of truth in workshops.js (backlog #31)"
```

---

### Task 9: Workers — assigned_to field (Backlog #22)

Workers not linked to tasks.

**Files:**
- Modify: `src/data/tasks.js` — add `assigned_to` field based on workshop
- Modify: `src/data/workers.js` — verify worker IDs match workshop codes

**Step 1: Add assigned_to in task generation**

For tasks with status `in_progress`, assign a worker from the matching workshop:
```javascript
assigned_to: status === 'in_progress' ? WORKERS.find(w => w.workshop === workshopCode)?.id || null : null,
```

**Step 2: Commit**

```bash
git commit -m "feat: add assigned_to field linking workers to tasks (backlog #22)"
```

---

### Task 10: Multi-item mock orders (Backlog #38)

No multi-item orders in mocks.

**Files:**
- Modify: `src/data/orders.js` — add 1-2 orders with 2+ items

**Step 1: Modify 1-2 existing orders to have multiple items**

Pick PH-1105 (already has screen+embroidery route) and add a second item to its `data.items[]`.

**Step 2: Verify app renders correctly with multi-item orders**

**Step 3: Commit**

```bash
git commit -m "feat: add multi-item mock orders for testing (backlog #38)"
```

---

## Phase 2: Performance

### Task 11: CSS Modules — extract inline styles (Backlog #1)

All 19 components have inline `<style>` tags that re-parse every render. Extract to CSS Modules.

**Files:**
- Create: `src/components/TaskCard.module.css` (from TaskCard.jsx lines 207-367)
- Create: `src/components/TaskDetail.module.css` (from TaskDetail.jsx lines 458-894)
- Create: `src/components/NavBar.module.css` (from NavBar.jsx lines 63-172)
- Create: CSS modules for all other components with inline styles
- Modify: each component to import and use the CSS module

**Step 1: Start with TaskCard.jsx**

Extract the `<style>` block (lines 207-367) to `TaskCard.module.css`. Since these use global class names (`.tc-card`), keep them as global selectors using `:global()` initially, then migrate to module syntax if time permits. Actually — these are all component-scoped with `tc-` prefix, so converting to CSS Modules is clean.

For each component:
1. Copy `<style>` content to `ComponentName.module.css`
2. Change class names to camelCase in the module
3. Import `import styles from './ComponentName.module.css'`
4. Replace `className="tc-card"` with `className={styles.card}`
5. Remove `<style>` block

**Important:** Do this one component at a time. Start with the biggest (TaskDetail, TaskCard, NavBar) then the rest.

**Step 2: Repeat for all components**

Components with inline styles: NavBar, TaskCard, TaskDetail, QCChecklist, OrderTimeline, HandoffDialog, NotificationBell, WorkshopSelector, KioskView, AndonBoard, TVDashboard, DirectorView, CapacityBoard, AnalyticsView, BatchView, WorkInstructions, QRScanner, WorkshopBoard, KanbanMock.

**Step 3: Verify each page renders correctly after extraction**

**Step 4: Commit per batch (3-4 components per commit)**

```bash
git commit -m "perf: extract inline styles to CSS Modules — TaskCard, TaskDetail, NavBar (backlog #1)"
```

---

### Task 12: Zustand selectors — fix double subscription (Backlog #8, #24)

`useWorkshopTasks()` subscribes twice (once for tasks, once for currentWorkshop). `useTasksByOrder` creates new array every render.

**Files:**
- Modify: `src/store/useWorkshopStore.js` (lines 190-199)

**Step 1: Fix useWorkshopTasks**

```javascript
import { useShallow } from 'zustand/react/shallow';

export function useWorkshopTasks() {
  return useWorkshopStore(useShallow(s => 
    s.tasks.filter(t => t.workshop_code === s.currentWorkshop)
  ));
}
```

**Step 2: Fix useTasksByOrder**

```javascript
export function useTasksByOrder(orderId) {
  return useWorkshopStore(useShallow(s =>
    s.tasks.filter(t => t.order_id === orderId).sort((a, b) => a.seq - b.seq)
  ));
}
```

**Step 3: Commit**

```bash
git commit -m "perf: fix double subscription in useWorkshopTasks, memoize useTasksByOrder (backlog #8, #24)"
```

---

### Task 13: TaskCard — subscribe only to own order (Backlog #9)

TaskCard subscribes to entire orders map.

**Files:**
- Modify: `src/components/TaskCard.jsx` (line 136)

**Step 1: Change selector**

```javascript
const order = useWorkshopStore(s => s.orders[task.order_id]);
```

Remove `const orders = useWorkshopStore(s => s.orders);` and `const order = orders[task.order_id];`.

**Step 2: Commit**

```bash
git commit -m "perf: TaskCard subscribes to own order only (backlog #9)"
```

---

### Task 14: TaskDetail — subscribe only to selected task (Backlog #25)

TaskDetail subscribes to entire tasks array.

**Files:**
- Modify: `src/components/TaskDetail.jsx`

**Step 1: Change selector**

```javascript
const task = useWorkshopStore(s => s.tasks.find(t => t.id === s.selectedTaskId));
```

Instead of subscribing to all tasks and then finding.

**Step 2: Commit**

```bash
git commit -m "perf: TaskDetail subscribes to selected task only (backlog #25)"
```

---

### Task 15: Extract Clock component (Backlog #10)

Clock with 1s interval re-renders entire tree in AndonBoard and TVDashboard.

**Files:**
- Create: `src/components/Clock.jsx`
- Modify: `src/components/AndonBoard.jsx`, `src/components/TVDashboard.jsx`

**Step 1: Create Clock component**

```jsx
import { useState, useEffect, memo } from 'react';
import { formatClock, formatDate } from '../utils/format';

const Clock = memo(function Clock({ showDate = false }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <span className="clock-time">{formatClock(now)}</span>
      {showDate && <span className="clock-date">{formatDate(now)}</span>}
    </>
  );
});

export default Clock;
```

**Step 2: Replace in AndonBoard and TVDashboard**

Remove local clock state/effect, use `<Clock />`.

**Step 3: Commit**

```bash
git commit -m "perf: extract Clock component to isolate 1s re-renders (backlog #10)"
```

---

### Task 16: Remove forceRefresh, fix setTimeout hack (Backlog #40, #41)

`forceRefresh` in TVDashboard is useless. `handleQuickDone` in TaskCard uses `setTimeout` hack.

**Files:**
- Modify: `src/components/TVDashboard.jsx` — remove `forceRefresh` state and effect
- Modify: `src/components/TaskCard.jsx` — chain `selectTask` + `openHandoff` in one action

**Step 1: Remove forceRefresh from TVDashboard**

**Step 2: Fix handleQuickDone in TaskCard**

Add a combined store action `selectAndHandoff(taskId)`:
```javascript
// In useWorkshopStore:
selectAndHandoff: (taskId) => set({ selectedTaskId: taskId, showHandoff: true, showProblemPicker: false }),
```

Replace `handleQuickDone` in TaskCard:
```javascript
function handleQuickDone(e) {
  e.stopPropagation();
  selectAndHandoff(task.id);
}
```

**Step 3: Commit**

```bash
git commit -m "perf: remove forceRefresh, fix setTimeout hack with combined action (backlog #40, #41)"
```

---

### Task 17: Lazy loading routes (Backlog #23)

No code splitting — all routes loaded eagerly.

**Files:**
- Modify: `src/App.jsx`

**Step 1: Wrap all route components with React.lazy**

```jsx
import { lazy, Suspense } from 'react';

const WorkshopBoard = lazy(() => import('./components/WorkshopBoard'));
const DirectorView = lazy(() => import('./components/DirectorView'));
const CapacityBoard = lazy(() => import('./components/CapacityBoard'));
// ... etc for all 11 routes

// Wrap <Routes> in <Suspense fallback={<div>...</div>}>
```

**Step 2: Commit**

```bash
git commit -m "perf: lazy load all route components (backlog #23)"
```

---

## Phase 3: Accessibility

### Task 18: Focus trap in modals (Backlog #2)

TaskDetail and HandoffDialog lack focus trap.

**Files:**
- Modify: `src/components/TaskDetail.jsx` — convert overlay to `<dialog>` or add focus trap
- Modify: `src/components/HandoffDialog.jsx` — same

**Step 1: Convert TaskDetail overlay to `<dialog>`**

Replace the backdrop `<div>` with `<dialog>` element:
- Add `ref` and call `dialogRef.current.showModal()` on mount
- `<dialog>` provides native focus trap and Escape to close
- Style the `<dialog>` backdrop with `::backdrop`

**Step 2: Same for HandoffDialog**

**Step 3: Verify Escape closes, Tab cycles within, focus returns on close**

**Step 4: Commit**

```bash
git commit -m "a11y: add focus trap via <dialog> element in TaskDetail, HandoffDialog (backlog #2)"
```

---

### Task 19: Keyboard support for TaskCard, QCChecklist (Backlog #3)

Div with onClick without keyboard support.

**Files:**
- Modify: `src/components/TaskCard.jsx` (line 166-168)
- Modify: `src/components/QCChecklist.jsx`

**Step 1: TaskCard — add keyboard support**

```jsx
<div
  className={...}
  onClick={() => selectTask(task.id)}
  role="button"
  tabIndex={0}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectTask(task.id); } }}
>
```

**Step 2: QCChecklist — convert divs to proper checkboxes**

Replace the div-with-role="checkbox" with native `<input type="checkbox">` wrapped in `<label>`.

**Step 3: Commit**

```bash
git commit -m "a11y: add keyboard support to TaskCard, native checkboxes in QCChecklist (backlog #3)"
```

---

### Task 20: Focus management for TaskDetail drawer (Backlog #4)

No focus management when opening/closing drawer.

**Files:**
- Modify: `src/components/TaskDetail.jsx`

**Step 1: If using `<dialog>` from Task 18, this is handled natively**

If not using dialog, add:
- `useRef` for the drawer container
- `useEffect` to focus the container on open
- Save `document.activeElement` before open, restore on close

**Step 2: Commit**

```bash
git commit -m "a11y: focus management for TaskDetail drawer (backlog #4)"
```

---

### Task 21: Aria labels and live regions (Backlog #15, #16)

Missing `aria-label` on filters in WorkshopBoard. Missing `aria-live` regions.

**Files:**
- Modify: `src/components/WorkshopBoard.jsx` — add `aria-label` to filter controls
- Modify: `src/components/WorkshopBoard.jsx` — add `aria-live="polite"` to task list
- Modify: `src/components/QCChecklist.jsx` — add `aria-live="polite"` to progress counter

**Step 1: Add aria-labels to WorkshopBoard filters**

**Step 2: Add aria-live to dynamic content regions**

**Step 3: Commit**

```bash
git commit -m "a11y: add aria-labels to filters, aria-live to dynamic regions (backlog #15, #16)"
```

---

### Task 22: Color-only status indicator (Backlog #17)

TaskCard left bar uses color only for status.

**Files:**
- Modify: `src/components/TaskCard.jsx`

**Step 1: Add a small text or icon indicator**

Add a visually-hidden `<span>` with status text next to the left bar, or add a small status icon/badge inside the card body:
```jsx
<span className="tc-status-badge" aria-label={statusLabel}>
  {statusIcon}
</span>
```

Status map: `blocked` → "Блок", `in_progress` → "В работе", `overdue` → "!" etc.

**Step 2: Commit**

```bash
git commit -m "a11y: add text/icon status indicator alongside color bar (backlog #17)"
```

---

### Task 23: prefers-reduced-motion and photo upload a11y (Backlog #36, #37)

No `prefers-reduced-motion` support. Photo upload label not keyboard-focusable.

**Files:**
- Modify: `src/styles/tokens.css` — add media query
- Modify: `src/components/TaskDetail.jsx` — fix photo upload button

**Step 1: Add to tokens.css**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

Note: this is the one valid use of `!important` — a11y media query override.

**Step 2: Fix photo upload**

Replace `<label>` with `<button>` that triggers a hidden file input via ref.

**Step 3: Commit**

```bash
git commit -m "a11y: prefers-reduced-motion + keyboard-accessible photo upload (backlog #36, #37)"
```

---

## Phase 4: Mobile

### Task 24: NavBar mobile overflow (Backlog #18)

NavBar overflows on 375px screens.

**Files:**
- Modify: NavBar component + its CSS module (after Task 11)

**Step 1: Add mobile breakpoint**

At `@media (max-width: 480px)`:
- Hide labels, show icons only
- Or collapse to horizontal scroll with smaller buttons
- Move "Дисплеи" group to overflow menu

**Step 2: Commit**

```bash
git commit -m "fix: NavBar responsive for 375px screens (backlog #18)"
```

---

### Task 25: Touch targets 44px minimum (Backlog #19, #35)

Quick buttons 36px < 44px minimum. KanbanMock detail close 28px.

**Files:**
- Modify: `src/components/TaskCard.jsx` (CSS) — `.tc-quick-btn` min-height to 44px
- Modify: `src/components/KanbanMock.jsx` — close button to 44px

**Step 1: Fix TaskCard quick button**

```css
.tc-quick-btn {
  min-height: 44px;
  min-width: 44px;
}
```

**Step 2: Fix KanbanMock close button**

```css
.close-btn {
  min-height: 44px;
  min-width: 44px;
}
```

**Step 3: Commit**

```bash
git commit -m "fix: touch targets minimum 44px (backlog #19, #35)"
```

---

### Task 26: Mobile typography and heatmap (Backlog #33, #34)

CapacityBoard heatmap unreadable on 375px. `--type-label: 11px` too small on mobile.

**Files:**
- Modify: `src/styles/tokens.css` — mobile override for `--type-label`
- Modify: `src/components/CapacityBoard.jsx` — responsive grid

**Step 1: Mobile font override**

In tokens.css:
```css
@media (max-width: 768px) {
  :root {
    --type-label: 12px;
  }
}
```

**Step 2: CapacityBoard responsive**

Add horizontal scroll wrapper or reduce columns for mobile.

**Step 3: Commit**

```bash
git commit -m "fix: mobile typography and CapacityBoard responsive (backlog #33, #34)"
```

---

## Phase 5: Security / Validation

### Task 27: Input validation (Backlog #26, #27, #28)

Defect count unbounded. Photos no size/count limit. Comments no max length.

**Files:**
- Modify: `src/store/useWorkshopStore.js`

**Step 1: Clamp defect count**

```javascript
reportDefect: (taskId, count, type, notes) => {
  const clampedCount = Math.max(0, Math.min(count, 9999));
  const clampedNotes = (notes || '').slice(0, 2000);
  // ...
```

**Step 2: Photo validation**

```javascript
addPhoto: (taskId, dataUrl, caption) => {
  const existing = get().photos[taskId] || [];
  if (existing.length >= 10) return;
  // Estimate size from base64 length (~1.37x overhead)
  if (dataUrl.length > 5 * 1024 * 1024 * 1.37) return;
  // ...
```

**Step 3: Comment max length**

```javascript
addComment: (taskId, text) => {
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) return;
  // ...
```

**Step 4: Commit**

```bash
git commit -m "fix: add input validation — defect bounds, photo limits, comment length (backlog #26-28)"
```

---

## Phase 6: Quality

### Task 28: Remove !important in WorkshopSelector (Backlog #29)

**Files:**
- Modify: `src/components/WorkshopSelector.jsx` (or its CSS module after Task 11)

**Step 1: Find and remove `!important`**

Increase specificity naturally or restructure CSS rules.

**Step 2: Commit**

```bash
git commit -m "fix: remove !important from WorkshopSelector CSS (backlog #29)"
```

---

### Task 29: Null/error handling for missing data (Backlog #32)

**Files:**
- Modify: components that access `order.data.items[0]` without checking

**Step 1: Add fallback UI**

Where components access `order?.data?.items?.[0]` — add a fallback rendering for when data is missing.

**Step 2: Commit**

```bash
git commit -m "fix: add null-safe fallbacks for missing order data (backlog #32)"
```

---

### Task 30: Split large components (Backlog #12)

7 components > 600 lines: TaskDetail (897), AnalyticsView (800), WorkInstructions (775), etc.

**This is a large refactoring task. Do after CSS modules extraction (Task 11) since line counts will change.**

**Files:**
- Modify: `src/components/TaskDetail.jsx` — extract sub-components: TaskDetailHeader, TaskDetailActions, TaskDetailComments, TaskDetailPhotos, TaskDetailEvents, TaskDetailDefects
- Modify: `src/components/AnalyticsView.jsx` — extract chart sub-components
- Modify: `src/components/WorkInstructions.jsx` — extract sections

**Step 1: TaskDetail — identify logical sections**

Read the component and identify 4-5 sections that can be extracted as children.

**Step 2: Extract one section at a time**

Create `src/components/task-detail/TaskComments.jsx`, etc.

**Step 3: Verify rendering unchanged**

**Step 4: Commit per component split**

```bash
git commit -m "refactor: split TaskDetail into sub-components (backlog #12)"
```

---

## Phase 7: UX Copy (Backlog #42-49)

### Task 31: Fix Russian labels

**Files:**
- Modify: `src/components/NavBar.jsx` — lines 6, 9 (Dashboard → Панель, Kanban → Канбан)
- Modify: `src/components/NavBar.jsx` — line 18 (TV → ТВ)
- Modify: `src/components/DirectorView.jsx` — "Control Tower" → "Центр управления", fix "задачи заблокировано" → "задачи заблокированы"
- Modify: `src/components/WorkshopBoard.jsx` — "Dashboard →" → "Панель →"
- Grep for "операция" and "оп." — standardize to "задача" / "задач"

**Step 1: NavBar labels**

```javascript
const NAV_LINKS = [
  { path: '/',             label: 'Цех' },
  { path: '/director',     label: 'Панель' },
  // ...
  { path: '/kanban',       label: 'Канбан' },
];
const DISPLAY_LINKS = [
  // ...
  { path: '/tv', label: 'ТВ' },
];
```

**Step 2: DirectorView, WorkshopBoard labels**

**Step 3: Standardize "операция"/"оп." to "задача"**

Search all files for these terms and replace consistently.

**Step 4: Commit**

```bash
git commit -m "fix: standardize Russian UI labels (backlog #42-49)"
```

---

## Phase 8: Data Normalization (optional, lower priority)

### Task 32: Normalize tasks to Map (Backlog #20)

Tasks stored as flat array — O(n) lookups every render.

**Files:**
- Modify: `src/store/useWorkshopStore.js` — change `tasks: [...]` to `tasks: {}` (Map by id)
- Modify: all components that use `tasks.filter()`, `tasks.find()`, `tasks.map()`

**This is a significant refactor.** Only do if performance is actually a problem. The current task count (~50) is small enough that O(n) is negligible.

**Decision: Skip unless specifically requested.**

---

## Execution Order Summary

| Order | Tasks | Backlog Items | Est. Complexity |
|-------|-------|---------------|-----------------|
| 1 | 1-3 | #11, #13, #14, #30 | Low — extract shared code |
| 2 | 4-8 | #5, #6, #7, #21, #31, #39 | Low — store fixes |
| 3 | 9-10 | #22, #38 | Low — data fixes |
| 4 | 11 | #1 | High — CSS Modules for 19 components |
| 5 | 12-17 | #8, #9, #10, #23-25, #40, #41 | Medium — performance |
| 6 | 18-23 | #2-4, #15-17, #36, #37 | Medium — a11y |
| 7 | 24-26 | #18, #19, #33-35 | Low — mobile |
| 8 | 27 | #26-28 | Low — validation |
| 9 | 28-29 | #29, #32 | Low — quality |
| 10 | 30 | #12 | High — component splitting |
| 11 | 31 | #42-49 | Low — copy fixes |
