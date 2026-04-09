# Backlog Progress Tracker

Source plan: `/Users/margolinilya/.claude/plans/parsed-cooking-finch.md`

## Completed (Sessions 1-3 — 2026-04-09)

### Wave 1 — Critical Path
- ✅ **Task 1** — useAuthStore useShallow + lazy-load PrintPreview, SkuEditor (#15-17)
- ✅ **Task 2** — Delete dead lib/api.ts (#2)

### Wave 2 — Store selectors
- ✅ **Task 4** — useDraft selector subscription with subscribeWithSelector (#18)
- ✅ **Task 5** — Combine Header/Dashboard/Toast subscriptions via useShallow (#19, #20, #29)
- ✅ **Task 6** — useShallow on bare user object selectors (#21)

### Wave 3 — Deduplication
- ✅ **Task 7** — Extract deadline helpers to utils/deadline.js (#3)
- ✅ **Task 8** — FLEX_MATRIX to data/prices.js, sizeOrder imported from helpers (#4, #5)
- ✅ **Task 9** — Extract calcExtrasCost — replace 5 inline reduces (#11)

### Wave 4 — Accessibility
- ✅ **Task 10** — Keyboard support in StepGarment (SKU, fabric, colors, extras) (#30)
- ✅ **Task 11** — useFocusTrap hook + OrderDrawer (#31)
- ✅ **Task 22** — `<main>` landmark + aria-live on validation errors (#38, #43 partial)

### Wave 5 — Mobile
- ✅ **Task 13** — Mobile table overflow (#49)
- ✅ **Task 14** — iOS zoom fix (inputs ≥16px), 44px touch targets, responsive drawer (#50-53)

### Wave 6 — UX & Copy
- ✅ **Task 15** — Translate Express/Admin + ROLE_LABELS in data/roles.js (#69, #70)
- ✅ **Task 16** — utils/i18n.js: pluralize + translateSupabaseError (#71, #72)
- ✅ **Task 17** — Empty/loading states in AdminPanel, Dashboard (#76 partial)
- ✅ **Task 18** — Imperative confirm() dialog replacing window.confirm in 5 places (#68, #78)

### Wave 7 — Validation & Cleanup
- ✅ **Task 19** — maxLength on forms, AdminPanel error toasts, PriceEditor clamps, qty max (#62-67)
- ✅ **Task 20** — Remove dead code (#9, #10, #13, #14, #28)
- ✅ **Task 21** — Extract App.jsx inline styles to App.module.css (partial #24)

### Wave 8 — Tests & Breakpoints
- ✅ **Task 23** — Standardize 600px → 768px breakpoint (#55)
- ✅ **Task 24** — Shared ConfirmDialog component + Host (#78)
- ✅ **Task 26** — Fix test descriptions + add rollback tests (#84, #85)

## Deferred / Not started

- ⏸ **Task 3** — Split SkuEditor (842 lines → 5 sub-components)
- ⏸ **Task 12** — Full aria-labels audit (PriceEditor has div-labels, bigger refactor)
- ⏸ **Task 21 rest** — Inline styles → CSS modules in KanbanBoard, Dashboard, StepDesign
- ⏸ **Task 25** — Expand E2E test scaffold (2 specs exist)
- ⏸ **Tasks 27-29** — TypeScript migration of stores/pricing + strictNullChecks
- ⏸ **Task 30** — Remove remaining !important usages (20+ instances)

## Verification status

- ✅ Lint: 0 errors
- ✅ Tests: 721/721 passing (+2 new rollback tests)
- ✅ Build: succeeds
- ✅ All commits use conventional commit format

## Stats

- **24/30 tasks completed** (80%)
- **~60/89 audit findings addressed** (~67%)
- **~29 commits across 3 sessions**
