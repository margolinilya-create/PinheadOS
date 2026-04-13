# ADR-0003 — Tenant_id column с day 1 (single-tenant runtime, multi-tenant ready)

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2

## Контекст

Направление продукта через 12 месяцев — SaaS для других типографий (multi-tenant). Архитектурный ревьюер указал: добавить `tenant_id` в месяц 9 означает переписать все RLS policies, индексы, edge functions, materialized views, storage buckets. Делать это на зрелой кодовой базе с полными данными = многонедельный рефакторинг с риском регрессий.

Альтернатива — заложить `tenant_id` колонку сейчас (добавление колонки с default стоит нулей), и перейти на tenant-scoped RLS в месяц 9 простым изменением RLS policies + снятием default.

## Решение

Каждая **новая** таблица получает с day 1:

```sql
tenant_id uuid not null default '00000000-0000-0000-0000-000000000001'
CHECK (tenant_id = '00000000-0000-0000-0000-000000000001')  -- honest pin
```

RLS policies **пока не scoped** по `tenant_id` (single-tenant runtime). Это документированный middle-ground, защищённый CHECK constraint — случайная запись с другим UUID отклоняется на уровне БД.

В месяце 9:
1. Удалить CHECK constraint
2. Добавить `tenant_id = auth_current_tenant()` в каждый RLS policy
3. Backfill нулевым не нужен — все записи уже имеют default
4. Storage bucket пути префиксим `/${tenant_id}/...`

## Последствия

**Плюсы:**
- Zero-cost в месяце 1-8 (просто колонка с default)
- Не ломает single-tenant runtime (RLS игнорирует `tenant_id`)
- Retrofit в месяц 9 = локальное изменение RLS (не трогает данные)
- CHECK constraint защищает от случайного drift
- `tenant_single` CHECK снимается в одной миграции `20270101_multi_tenant_enablement.sql`

**Минусы:**
- Код в edge functions и RLS не использует `tenant_id` → при multi-tenant retrofit потребуется найти все места и добавить scoping (grep-работа)
- Existing `orders`, `profiles`, `app_config` **не** получают `tenant_id` в v2 (только новые production-таблицы). Retrofit existing — отдельная задача в месяце 9

**Правила:**
- Все новые миграции включают `tenant_id uuid not null default '...'` и CHECK
- Existing таблицы (`orders`, `profiles`, `app_config`, `catalog_config`) не трогаем

## Альтернативы

- **Не закладывать tenant_id вообще** — отвергнуто: дорогой retrofit в мес 9
- **Включить tenant-scoped RLS сразу** — отвергнуто: удваивает W1-W4 усилия, нет второго tenant для тестирования
- **Schema-per-tenant** — отвергнуто: слишком сложно для одного dev'а
