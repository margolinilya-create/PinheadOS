# ADR-0005 — Soft-delete через `deleted_at timestamptz` для новых таблиц

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2

## Контекст

Существующий `profiles` использует `active bool` для soft-delete (см. `supabase/migrations/20260410120000_soft_delete_profiles.sql`). Для новых таблиц (`orders`, `workers`, `operation_types`) нужно выбрать конвенцию.

`active bool` vs `deleted_at timestamptz`:
- `active bool` проще для запросов (`where active = true`)
- `deleted_at timestamptz` хранит момент удаления → поддерживает «корзину на 30 дней» из плана §7
- `deleted_at timestamptz` позволяет сортировку «недавно удалённые»
- Смешивание двух конвенций в одном коде создаёт когнитивную нагрузку

## Решение

**Новые таблицы** (`orders`, `workers`, `operation_types`, `sections`, `order_tech_operations`, и т.д.) используют:

```sql
deleted_at timestamptz default null
```

**Existing `profiles`** остаётся с `active bool` — не мигрируем ради консистентности, чтобы не ломать существующие тесты и flows (ProfileStatus state machine завязан на `active`).

В app-коде hook `useDeletedFilter()` абстрагирует разницу: для profiles проверяет `active=true`, для остальных — `deleted_at IS NULL`.

## Последствия

**Плюсы:**
- Поддержка 30-дневной корзины (§7 плана) — очевидна
- Сортировка по дате удаления
- Консистентность всех **новых** таблиц
- CHECK constraint: `deleted_at IS NULL OR deleted_at > created_at`

**Минусы:**
- Двойная конвенция: `profiles.active` vs `orders.deleted_at` → требует документирования
- `useDeletedFilter` hook — дополнительный слой, легко забыть
- Миграция `profiles` в будущем требует отдельного ADR

**Правила:**
- Все новые таблицы — `deleted_at`
- `profiles` — `active` (legacy)
- Все SELECT-запросы в новых слайсах обязательно фильтруют `deleted_at IS NULL`
- В корзину попадают записи с `deleted_at IS NOT NULL AND deleted_at > now() - interval '30 days'`
- Cleanup cron удаляет `deleted_at < now() - interval '30 days'`

## Альтернативы

- **Унифицировать всё на `active bool`** — отвергнуто: 30-дневная корзина требует timestamp
- **Мигрировать `profiles` на `deleted_at`** — отвергнуто: риск регрессии ProfileStatus тестов, не стоит в MVP
- **Hard delete** — отвергнуто: audit, restore, compliance
