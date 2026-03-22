# PINHEAD Order Studio

## Проект
CRM для приёма заказов на кастомную одежду. React 19 + Vite + Zustand + Supabase + TypeScript

## Стек
- Frontend: React 19, React Router 7, Zustand 5
- Backend: Supabase (PostgreSQL + Auth + RLS)
- Тесты: Vitest + Testing Library (708 тестов)
- CI/CD: GitHub Actions → Vercel
- URL: https://pinhead-os.vercel.app

## Структура src/
- components/ — UI компоненты (steps/, editors/, orders/, layout/, shared/)
- store/ — Zustand store + 8 слайсов в store/slices/
- utils/pricing.js — движок ценообразования (ГЛАВНЫЙ файл)
- lib/ — supabase.js, catalogs.js, api.ts, storage.ts
- types/ — TypeScript типы (order, catalog, pricing, auth)
- data/ — fallback данные (prices.js, skuCatalog.js, extras.js)

## Ключевые правила
- Цены: getPrices() → store → localStorage → DEFAULT_PRICES
- Каталоги: Supabase catalog_config → fallback на data/*.js
- Черновик: localStorage 'pinhead_draft'
- Роли: admin > director > rop > manager > production > designer
- RLS: manager видит только свои заказы

## Не трогать
- utils/pricing.js — только через тесты pricing.test.js
- store/slices/ — изменять осторожно, 708 тестов
- supabase-rls.sql — применять только через SQL Editor

## Тесты
```bash
npm run test     # все 708 тестов
npm run lint     # 0 ошибок обязательно
npm run build    # успешный билд обязательно
```

## Design System
- Design Guidebook: docs/DESIGN-GUIDEBOOK-v2.html
- Токены: src/index.css (:root)
- Шрифты: Barlow Condensed (заголовки) / Inter (текст) / Roboto Mono (числа)
