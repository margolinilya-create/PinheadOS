# pinhead-react 10-Agent Audit Backlog

> **Date:** 2026-04-09
> **Scope:** `pinhead-react/src/` (~120 files, ~17,500 lines)
> **Agents:** Performance, Accessibility, Security, Code Quality, State Management, Mobile, UX/Copy, Testing, TypeScript, Architecture
> **Raw findings:** ~300+ across 10 agents, deduplicated to **89 unique items** below

---

## Summary

| Phase | Items | Critical | High | Medium | Low |
|-------|-------|----------|------|--------|-----|
| 1. Foundation (duplication, dead code) | 14 | 1 | 5 | 6 | 2 |
| 2. Performance (selectors, lazy, re-renders) | 15 | 1 | 6 | 6 | 2 |
| 3. Accessibility | 18 | 2 | 6 | 7 | 3 |
| 4. Mobile & Responsive | 12 | 2 | 4 | 5 | 1 |
| 5. Security & Validation | 8 | 0 | 0 | 5 | 3 |
| 6. UX & Russian Copy | 14 | 1 | 4 | 7 | 2 |
| 7. Testing | 8 | 1 | 3 | 3 | 1 |
| **Total** | **89** | **8** | **28** | **39** | **14** |

---

## Phase 1: Foundation — Duplication, Dead Code, Structure

### #1 — critical — SkuEditor is 842-line god component
`SkuEditor.jsx` manages 5 CRUD domains (SKU, fabrics, trims, extras, hardware), 15+ state vars, 2 modals, Excel import/export — all in one file. Split into tab sub-components.
*Agents: CodeQuality, Architecture*

### #2 — high — `lib/api.ts` is dead code
`supaQuery` is never imported anywhere. Every file calls `supabase.from()` directly. Delete or actually adopt as the API layer.
*Agents: CodeQuality, Architecture, Testing*

### #3 — high — Duplicated deadline logic
`getDeadlineInfo()` in KanbanBoard.jsx:12-23 and `getDeadlineColor()`+`getDeadlineLabel()` in Dashboard.jsx:93-109 compute the same thing. Magic number `86400000` repeated 4 times. Extract to shared util.
*Agents: CodeQuality*

### #4 — high — Duplicated `sizeOrder` function
`StepGarment.jsx:274` defines its own `sizeOrder()` + `SIZE_ORDER_MAP` while the canonical version exists in `store/slices/helpers.js:8-15`. Import instead.
*Agents: CodeQuality*

### #5 — high — Duplicated FLEX_MATRIX
`pricing.js:62-67` and `PriceEditor.jsx:17-22` contain identical flex matrix data. Single source of truth needed.
*Agents: CodeQuality*

### #6 — high — Duplicated zone tech summary functions
`getZoneParams()` in PrintPreview.jsx:9-32 and `getZoneTechSummary()` in StepSummary.jsx:22-46 do nearly the same thing. Extract to shared util.
*Agents: CodeQuality*

### #7 — medium — 4 components call Supabase directly (bypass any abstraction)
AdminPanel.jsx (profiles CRUD), SkuEditor.jsx (catalog config), PriceEditor.jsx (prices), StepGarment.jsx (SKU reorder). Components should not contain data-access logic.
*Agents: Architecture*

### #8 — medium — Direct localStorage calls bypass `lib/storage.ts`
SkuEditor.jsx uses raw `localStorage.getItem/setItem` in 10+ places. StepSummary.jsx:234 calls `localStorage.removeItem('pinhead_draft')`. Defeats the storage abstraction.
*Agents: Architecture, CodeQuality*

### #9 — medium — `EXTRAS_ICONS` in data/extras.js:45-68 never used
22 SVG icon strings exported but never imported anywhere.
*Agents: CodeQuality*

### #10 — medium — `getVolumeDiscount()` in pricing.js:293 is deprecated dead code
Always returns 0, only imported in tests.
*Agents: CodeQuality*

### #11 — medium — Duplicated extras cost calculation pattern
`extras.reduce(...)` pattern repeated in StepGarment.jsx:585, StepSummary.jsx:291, StepSummary.jsx:402, ExpressCalc.jsx:175.
*Agents: CodeQuality*

### #12 — medium — Zone key naming inconsistent across codebase
constants.js uses `chest/back/left-sleeve/right-sleeve`, SKU catalog uses `front/back/sleeve-l/sleeve-r`, StepDesign uses `ALL_ZONES = ['front', 'back', 'sleeve-l', 'sleeve-r', 'hood']`. ZONE_LABELS maps both old and new.
*Agents: CodeQuality*

### #13 — low — `Agentation` import in App.jsx:4 adds dev-only dependency to production bundle
*Agents: CodeQuality*

### #14 — low — Duplicated Pinhead logo SVG in 3+ places
ExpressCalc.jsx:297-308, TechCard.jsx, PrintPreview.jsx all render inline SVG logo.
*Agents: CodeQuality*

---

## Phase 2: Performance — Selectors, Lazy Loading, Re-renders

### #15 — critical — `useAuthStore()` with no selector in App.jsx:61
Subscribes to entire auth store. Any change re-renders the entire app tree (Header, Routes, Toast, all children). Must use `useShallow`.
*Agents: Performance, StateManagement*

### #16 — high — SkuEditor not lazy loaded (App.jsx:18)
842-line admin-only component eagerly imported. PriceEditor and ExpressCalc are lazy but SkuEditor is not.
*Agents: Performance, Architecture*

### #17 — high — PrintPreview not lazy loaded (App.jsx:17)
381-line print-only page eagerly imported.
*Agents: Performance, Architecture*

### #18 — high — `useDraft()` subscribes to entire store (useDraft.js:59)
Fires on every single state change. Should use selector to only trigger on draft-relevant fields.
*Agents: Performance*

### #19 — high — Header runs `calcTotal(s)` on every store change (Header.jsx:12)
Non-trivial pricing computation runs on every keystroke in any form field. Return value is primitive so re-render only when total changes, but computation itself is expensive.
*Agents: Performance*

### #20 — high — Double subscription in Dashboard.jsx:464-466
Three separate store calls; `orders` returns array that changes reference on every fetch.
*Agents: Performance*

### #21 — high — `useAuthStore(s => s.user)` returns object without useShallow
KanbanBoard.jsx:157, TechCard.jsx:20 — `user` object reference changes on every `set()` call.
*Agents: StateManagement*

### #22 — medium — All 5 wizard steps eagerly imported (App.jsx:11-15)
Only one step visible at a time. Steps 2-5 could be lazy (~1500 lines saved from initial bundle).
*Agents: Performance*

### #23 — medium — AuthScreen eagerly imported (App.jsx:16)
Only shown for unauthenticated users.
*Agents: Performance*

### #24 — medium — 30+ inline style objects in KanbanBoard OrderDrawer (KanbanBoard.jsx:179-351)
New object references per render. Move to CSS Module.
*Agents: Performance*

### #25 — medium — `calcTotal`/`getUnitPrice`/`getTotalQty` selectors pass full state
Header.jsx:12, StepGarment.jsx:298,547, ZoneTechBlock.jsx:23-24 — computation runs on every store change.
*Agents: Performance*

### #26 — medium — StepGarment inline IIFE extras section (StepGarment.jsx:584-640)
Computes `totalExtrasCost` and filters on every render. Extract to memoized child.
*Agents: Performance*

### #27 — medium — KanbanBoard totals computed on every render (KanbanBoard.jsx:436-437)
`orders.reduce(...)` not memoized.
*Agents: Performance*

### #28 — low — Unused `useMemo` in ZoneMockup.jsx:141-146
Computes chip text but result is never assigned or used.
*Agents: Performance*

### #29 — low — Double subscription in Toast.jsx:5-6
Two store calls could be one `useShallow`.
*Agents: Performance, StateManagement*

---

## Phase 3: Accessibility

### #30 — critical — StepGarment core interactions keyboard-inaccessible
SKU rows (line 124), fabric options (line 192), color swatches (line 250), extras items (lines 612, 625) — all `<div onClick>` with no `role`, `tabIndex`, or `onKeyDown`. These are the main wizard flow.
*Agents: Accessibility*

### #31 — critical — No focus trap or focus restoration in OrderDrawer (KanbanBoard.jsx:182-361)
Modal overlay allows Tab to escape to background. Focus not returned on close.
*Agents: Accessibility*

### #32 — high — Keyboard shortcuts modal lacks dialog semantics (KanbanBoard.jsx:620-636)
No `role="dialog"`, `aria-modal`, focus trap.
*Agents: Accessibility*

### #33 — high — Multiple clickable elements without keyboard support
LabelConfigurator.jsx:32, StepItems.jsx:71, ExpressCalc.jsx:368/380/387/424, Header.jsx:36, TechCard.jsx:372, Dashboard.jsx:262. All `<div/span onClick>` without keyboard handling.
*Agents: Accessibility*

### #34 — high — Password toggle buttons have no aria-label (AuthScreen.jsx:79,102)
Emoji-only buttons not reliably read by screen readers.
*Agents: Accessibility*

### #35 — high — Icon-only buttons lack aria-label throughout
Search clear (StepGarment.jsx:104), edit/delete (StepItems.jsx:82-83), comment submit arrow (KanbanBoard.jsx:322).
*Agents: Accessibility*

### #36 — high — `<label>` elements not associated with inputs
AuthScreen.jsx:72-73,91-101, LabelConfigurator.jsx:62-86, PriceEditor.jsx (hundreds of inputs), SkuEditor.jsx:558-580 — all missing `htmlFor`/`id` pairing.
*Agents: Accessibility*

### #37 — high — Color-only status indicators
KanbanBoard card bars (line 61) and stats dots (line 548), Dashboard production bars (line 381) use only color. No text alternative.
*Agents: Accessibility*

### #38 — medium — No `<main>` landmark (App.jsx)
App uses `<header>` but no `<main>` for primary content area.
*Agents: Accessibility*

### #39 — medium — Missing `aria-live` on dynamic content
Validation errors (StepGarment.jsx:643, StepDetails.jsx:73, StepSummary.jsx:426), auth errors (AuthScreen.jsx:67) not announced dynamically.
*Agents: Accessibility*

### #40 — medium — Search/textarea inputs have only placeholder, no label
StepGarment.jsx:96 (SKU search), StepDesign.jsx:171 (notes textarea), KanbanBoard.jsx:298 (comment), TechCard.jsx:398 (comment).
*Agents: Accessibility*

### #41 — medium — Role selection buttons no fieldset/legend (StepDetails.jsx:54-60)
Group of buttons acting as radio selection with no ARIA grouping.
*Agents: Accessibility*

### #42 — medium — SVG mockups via dangerouslySetInnerHTML not accessible
5 locations (StepItems, StepGarment, StepSummary, ZoneMockup, TechCard) — no `role="img"` or `aria-label` on container.
*Agents: Accessibility*

### #43 — medium — QR code alt text not descriptive (TechCard.jsx:201)
`alt="QR"` should be `alt="QR-код заказа {order.order_number}"`.
*Agents: Accessibility*

### #44 — medium — Heading hierarchy issues
KanbanBoard, PrintPreview, TechCard have no headings. PriceEditor jumps to `<h3>` with no `<h2>`.
*Agents: Accessibility*

### #45 — low — No autofocus on first field in StepGarment
CLAUDE.md rule: "autofocus on first field of form".
*Agents: Accessibility*

### #46 — low — `prefers-reduced-motion` not supported
No media query to disable animations for users who prefer reduced motion.
*Agents: Accessibility*

### #47 — low — StepDetails autofocus may cause scroll issues on mobile (StepDetails.jsx:68)
*Agents: UX*

---

## Phase 4: Mobile & Responsive

### #48 — critical — Kanban board minimum width 1200-1400px, no mobile alternative
5 columns with `min-width: 240-280px` each. Only swipe on mobile, no tab-based switching.
*Agents: Mobile*

### #49 — critical — SKU/Price editor tables overflow on mobile
`.sku-ed-table` and `.pe-matrix-table` have no `overflow-x: auto` wrapper. Will overflow at 375px.
*Agents: Mobile*

### #50 — high — Touch targets below 44px minimum
`.qty-btn` 28px (garment.css:246), `.kb-card-actions button` 26px (kanban.css:59), `.sku-search-clear` ~20px, `.btn-icon` 30px, `.summary-edit-btn` ~24px, `.sku-del-btn` ~20px, `.kb-card-menu-btn` ~18px.
*Agents: Mobile*

### #51 — high — `--type-caption: 9px` used in 30+ locations
Illegible on mobile. No mobile override. Also `.bx-tag` at 7px (kanban.css:49).
*Agents: Mobile*

### #52 — high — iOS auto-zoom on inputs with font-size < 16px
Many component overrides bring font-size below 16px: `.exp-field select` 13px, `.sku-edit-input` 12px, `.pe-matrix-input` 11px. iOS zooms on focus.
*Agents: Mobile*

### #53 — high — KanbanBoard detail panel `style={{ width: 380 }}` exceeds 375px screen
KanbanBoard.jsx:184 — fixed inline width overflows on mobile.
*Agents: Mobile*

### #54 — medium — `.dash-metrics-6` grid 6 columns with no mobile override
Remains 6 columns on all screens (editors.css:346).
*Agents: Mobile*

### #55 — medium — Inconsistent breakpoints: 768px, 600px (only garment.css), 480px
Three different breakpoint sets across the project.
*Agents: Mobile*

### #56 — medium — Header burger menu has no backdrop to close by tapping outside
Header.module.css:98-101.
*Agents: Mobile*

### #57 — medium — ProgressBar hides step labels at 480px, shows only tiny unlabeled circles
ProgressBar.module.css:46-49.
*Agents: Mobile*

### #58 — medium — `.garment-mock` fixed 260x300px may overflow with padding on 375px
garment.css:85.
*Agents: Mobile*

### #59 — low — No tablet-landscape breakpoint between 768px and 1280px
*Agents: Mobile*

---

## Phase 5: Security & Validation

### #60 — medium — `dangerouslySetInnerHTML` with SVG in 5 locations
Sanitized via `sanitizeHex()` but could be eliminated entirely with JSX SVG rendering.
*Agents: Security*

### #61 — medium — Photo upload no MIME validation (TechCard.jsx:55-68)
Only HTML `accept="image/*"` attribute, trivially bypassed. Base64 stored in JSONB (performance concern too).
*Agents: Security*

### #62 — medium — `messenger` and `bitrixDeal` fields unsanitized (StepDetails.jsx:93,97)
No `sanitizeText()` or `maxLength`, unlike all other fields on the form.
*Agents: Security*

### #63 — medium — Comment text no length limit (TechCard.jsx:398, useCommentsStore.js:27)
No `maxLength` on input, no truncation in store.
*Agents: Security*

### #64 — medium — PriceEditor number inputs no min/max bounds
Users could set negative prices or astronomical values.
*Agents: Security*

### #65 — low — Quantity inputs no upper bound (StepGarment.jsx:328,399,430)
Could enter 999999999.
*Agents: Security*

### #66 — low — Auth form inputs no maxLength (AuthScreen.jsx)
*Agents: Security*

### #67 — low — AdminPanel Supabase CRUD ignores errors (AdminPanel.jsx:37-51)
No error checking, no toast, optimistic state update without rollback.
*Agents: Security, Architecture, StateManagement*

---

## Phase 6: UX & Russian Copy

### #68 — critical — AdminPanel status change via dropdown has NO confirmation (AdminPanel.jsx:140)
Status changes immediately without any confirmation dialog.
*Agents: UX*

### #69 — high — Nav buttons "Express" and "Admin" in English (Header.jsx:58,84)
Should be "Экспресс" and "Админ".
*Agents: UX*

### #70 — high — Role labels display raw English everywhere
RolePreviewBar.jsx:6-12, AdminPanel.jsx:188 show "admin", "director", "manager" etc. instead of Russian.
*Agents: UX*

### #71 — high — Wrong noun-number agreement ("заказов" always genitive plural)
KanbanBoard.jsx:538, AdminPanel.jsx:78, Dashboard.jsx:379,388 — need proper Russian pluralization.
*Agents: UX*

### #72 — high — Supabase auth errors displayed in English (useAuthStore.js:71,86)
`error.message` from Supabase is English ("Invalid login credentials"). Should map to Russian.
*Agents: UX*

### #73 — medium — Mixed English/Russian UI text
"EXPRESS КАЛЬКУЛЯТОР" (ExpressCalc.jsx:305), "Fit" column (SkuEditor.jsx:540), "Flex" tech (ExpressCalc.jsx:27, StepDesign.jsx:13), raw English fit values in summaries.
*Agents: UX*

### #74 — medium — "СКАЧАТЬ PDF" button actually calls window.print() (PrintPreview.jsx:97-98)
Misleading — users expect file download.
*Agents: UX*

### #75 — medium — Missing loading states
AdminPanel orders tab, Dashboard, SkuEditor catalog fetch — no loading indicators.
*Agents: UX*

### #76 — medium — Missing empty states
AdminPanel orders table empty, Dashboard "Последние заказы" empty, Dashboard chart empty — all show blank content.
*Agents: UX*

### #77 — medium — Terminology inconsistent
"Клиент" vs "Имя / Компания", "Обработки" vs "Доп. обработки", "Зоны нанесения" vs "Нанесение", "Этикетки" vs "Бирки".
*Agents: UX*

### #78 — medium — All confirm() dialogs are native browser, not styled
StepItems, AdminPanel (x2), KanbanBoard, PriceEditor, SkuEditor use `window.confirm()` while the app has a styled modal for unsaved changes.
*Agents: UX*

### #79 — medium — KanbanBoard OrderDrawer status buttons no confirmation (KanbanBoard.jsx:333)
Any status change happens immediately. Only drag-to-done has confirmation.
*Agents: UX*

### #80 — low — "Срочный срок" is tautological (StepDetails.jsx:104)
Should be "Близкий дедлайн — уточните с производством".
*Agents: UX*

### #81 — low — Fire-and-forget Supabase call with `.then(() => {})` (StepGarment.jsx:74-77)
SKU reorder upsert silently discards errors.
*Agents: Architecture*

---

## Phase 7: Testing

### #82 — critical — E2E coverage 3/56 scenarios (5%)
Only partial wizard happy path and 5 visual screenshots. Auth (0/11), Kanban (0/17), Analytics (0/6), Admin (0/2) completely uncovered.
*Agents: Testing*

### #83 — high — No tests for `lib/catalogs.js`
Cache invalidation, TTL expiry, Supabase error handling untested.
*Agents: Testing*

### #84 — high — `deleteOrder` test misrepresents behavior (useOrdersStore.test.js:131)
Says "removes order optimistically" but implementation is non-optimistic. No test for failed-delete-keeps-order.
*Agents: Testing*

### #85 — high — `updateStatus` rollback never tested (useOrdersStore.test.js:177)
Implementation has rollback logic but it's completely untested.
*Agents: Testing*

### #86 — medium — KanbanBoard tests check only rendering, no interactions
15 tests verify element presence. No tests for status change, drag-drop, drawer, delete, keyboard shortcuts.
*Agents: Testing*

### #87 — medium — Dashboard tests don't verify metric calculations
Labels checked but "Ср. чек", "Конверсия" values never asserted.
*Agents: Testing*

### #88 — medium — No negative/NaN edge cases in pricing tests
`screenLookup` with qty=0, `calcTotal` with `usdRate: NaN` untested.
*Agents: Testing*

### #89 — low — 3 test files orphaned in src/ root
`multiItem.test.js`, `pricing-extended.test.js`, `sticky-layers.test.js` should be colocated.
*Agents: Testing*

---

## TypeScript (cross-cutting, not phased)

> These are systemic issues noted by Agent 9. They affect all code but are tracked separately as a migration decision.

- `tsconfig.json` has `strict: false`, `checkJs: false` — types not enforced
- All 5 Zustand stores completely untyped (`create()` with no generic)
- `types/` directory exists with good definitions but imported by almost nothing
- `utils/pricing.js` (418 lines, core engine) has zero type annotations
- All 25+ components have untyped props (no interface, no PropTypes)
- Supabase client not typed with `createClient<Database>()` 
- ~95% of codebase is untyped JavaScript

**Recommendation:** Incremental migration — start with stores (highest ROI), then pricing engine, then Supabase client types.

---

## Execution Priority

| Priority | Phase | Items | Rationale |
|----------|-------|-------|-----------|
| P0 | 1,2 | #1, #2, #15, #16, #17 | God component, dead code, perf critical path |
| P1 | 2 | #18, #19, #20, #21 | Store selector fixes (easy wins, big impact) |
| P2 | 3 | #30, #31, #33, #36 | Core a11y: keyboard nav, focus trap, labels |
| P3 | 1 | #3, #4, #5, #6, #11 | Deduplication (reduces maintenance burden) |
| P4 | 4 | #48, #49, #50, #52 | Mobile: table overflow, touch targets, iOS zoom |
| P5 | 6 | #68, #69, #70, #71, #72 | UX: confirmations, Russian text |
| P6 | 5 | #62, #63, #64, #67 | Input validation & error handling |
| P7 | 7 | #82, #84, #85 | Testing: E2E coverage, rollback tests |
| P8 | -- | TypeScript migration | Incremental, not blocking |
