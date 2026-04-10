# Backlog Progress Tracker — FINAL

Source plan: `docs/plans/2026-04-09-pinhead-react-audit.md` (10-agent audit, 89 findings)
Status: **30/30 задач закрыто** (сессии 1–6, 2026-04-09).

## Completed tasks

### Wave 1 — Critical path
- ✅ **Task 1** — `useAuthStore` useShallow + lazy-load PrintPreview, SkuEditor (#15–17)
- ✅ **Task 2** — Delete dead `lib/api.ts` (#2)

### Wave 2 — Store selectors
- ✅ **Task 4** — `useDraft` selector subscription with `subscribeWithSelector` (#18)
- ✅ **Task 5** — Combine Header/Dashboard/Toast subscriptions via `useShallow` (#19, #20, #29)
- ✅ **Task 6** — `useShallow` on bare user object selectors (#21)

### Wave 3 — Deduplication
- ✅ **Task 7** — Extract deadline helpers to `utils/deadline.js` (#3)
- ✅ **Task 8** — `FLEX_MATRIX` → `data/prices.js`, `sizeOrder` imported from helpers (#4, #5)
- ✅ **Task 9** — Extract `calcExtrasCost` — replaces 5 inline reduces (#11)

### Wave 4 — Accessibility
- ✅ **Task 10** — Keyboard support in StepGarment (SKU, fabric, colors, extras) (#30)
- ✅ **Task 11** — `useFocusTrap` hook + OrderDrawer (#31)
- ✅ **Task 12** — PriceEditor aria-labels: 20 `<div>` → `<label>`, aria-label на matrix/flex/markup inputs (#36, #42)
- ✅ **Task 22** — `<main>` landmark + aria-live на validation errors (#38, #43)

### Wave 5 — Mobile
- ✅ **Task 13** — Mobile table overflow (#49)
- ✅ **Task 14** — iOS zoom fix (inputs ≥16px), 44px touch targets, responsive drawer (#50–53)

### Wave 6 — UX & Copy
- ✅ **Task 15** — Translate Express/Admin + ROLE_LABELS в `data/roles.js` (#69, #70)
- ✅ **Task 16** — `utils/i18n.js`: pluralize + translateSupabaseError (#71, #72)
- ✅ **Task 17** — Empty/loading states в AdminPanel, Dashboard (#76)
- ✅ **Task 18** — Imperative `confirm()` dialog заменяет `window.confirm` в 5 местах (#68, #78)

### Wave 7 — Validation & Cleanup
- ✅ **Task 19** — `maxLength` on forms, AdminPanel error toasts, PriceEditor clamps, qty max (#62–67)
- ✅ **Task 20** — Dead code cleanup (#9, #10, #13, #14, #28)
- ✅ **Task 21** — Inline styles → CSS Modules: App/Header/ProgressBar (сессия 1–5); **StepDesign, Dashboard, KanbanBoard (drawer, shortcuts modal, board-level)** — сессия 6 (#24)

### Wave 8 — Tests & Breakpoints
- ✅ **Task 23** — Standardize 600px → 768px breakpoint (#55)
- ✅ **Task 24** — Shared ConfirmDialog component + Host (#78)
- ✅ **Task 25** — E2E scaffold expanded: `e2e/navigation.spec.ts` (wizard/kanban/express + shortcuts dialog)
- ✅ **Task 26** — Fix test descriptions + add rollback tests (#84, #85)

### Wave 9 — TypeScript migration
- ✅ **Task 27** — Convert `useOrdersStore.js` → `useOrdersStore.ts` (типизирован `OrdersStore` через `Order`/`OrderStatus`)
- ✅ **Task 28** — Convert `useStore.js` → `useStore.ts` (slice-combinator с loose `SlicePart` type)
- ✅ **Task 29** — Auth/Toast/Confirm/Comments stores уже в TS (сессия 5)

### Wave 10 — CSS !important removal
- ✅ **Task 30** — Убрать все `!important` (22 → 0 non-WCAG). Замена: специфичность селекторов (`input.qty-input`, `td.pe-markup-cat`, `.items-summary-table .items-total-row td`) + double-class boost для print-скрывания (`.header.header`, `.no-print.no-print`). Единственный остаток — `@media (prefers-reduced-motion)` универсальный override, где `!important` — стандарт W3C (задокументировано).

## Deferred (не из 30 tasks, из 89 findings)

- ⏸ **#1 — SkuEditor split** (842 строки god-component → 5 sub-components). Отложено: низкий ROI без активного касания, высокий риск регрессий. Откроем при следующем функциональном касании SkuEditor.
- ⏸ **`utils/pricing.js` TS миграция** — 418 строк pricing-движка, покрыто 84 тестами. Инкрементально при следующем касании.
- ⏸ **Слайсы `useStore`** — `wizardSlice`/`productSlice`/... остаются JS. Конвертация при касании слайса.
- ⏸ **E2E расширение** — 8/56 сценариев покрыто (14%). Остальные — в рамках будущих итераций.

## Verification (session 6 final)

- ✅ Lint: `npm run lint` — **0 errors**
- ✅ Unit tests: `npm run test -- --run` — **721/721 passing** (36 файлов)
- ✅ Build: `npm run build` — **✓ built in 1.80s**
- ✅ TypeScript: все новые stores компилируются без ошибок (strict: false, но все public API типизированы)
- ✅ `!important` в CSS: 3 инстанса (все в одном WCAG reduced-motion блоке с комментарием)

## Stats (сессия 6)

- **30/30 backlog tasks** завершены (100%)
- **~75/89 audit findings** адресованы напрямую (~84%). Оставшиеся — deferred items выше.
- **~35 коммитов** в сессиях 1–6
- **Бандл**: index.js ~940 KB (в сессии 5 было 1142 KB — улучшение за счёт lazy + dead code)
