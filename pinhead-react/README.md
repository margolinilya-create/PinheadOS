# PinheadOS — pinhead-react

ERP/CRM для типографии (печать на одежде). SPA на React 19; два раздела
с переключением в шапке: **🏭 Производство** (ERP, по умолчанию) и
**✏️ ТЗ** (Order Studio, за флагом `VITE_FEATURE_ORDER_STUDIO`).

**URL:** https://pinhead-os.vercel.app

## Стек

React 19 · Vite 7 · Zustand 5 · react-router-dom 7 · Supabase (БД, auth,
storage, edge-функции) · Chart.js · Vitest + Testing Library · Playwright ·
ESLint 9 + Husky. TypeScript `strict`; компоненты `.jsx`, стор и утилиты `.ts`.

## Быстрый старт

```bash
npm ci                     # Node 24 (см. .nvmrc)
cp .env.example .env       # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm run dev                # http://localhost:5173

npm run test               # unit (Vitest)
npm run e2e                # Playwright — .env не нужен, ключи фиктивные в конфиге
npm run lint               # ESLint, потолок предупреждений — ратчет
npm run typecheck          # tsc --noEmit
npm run build              # production
```

## Где что

- `src/erp/` — Производство: экраны, стор (`store/useErpStore.ts` + слайсы),
  чистая логика в `utils/`.
- `src/components/`, `src/store/` — Order Studio: визард, каталоги, канбан.
- `src/lib/` — клиент Supabase, storage, отчёты об ошибках.
- `../supabase/migrations/` — схема; журнал прода — `APPLIED.json`.

Контекст и правила — `CLAUDE.md` (корень и здесь), `docs/rules/INDEX.md`,
карта подсистем — `docs/rules/react/INDEX.md`, changelog —
`docs/changelog/INDEX.md`.
