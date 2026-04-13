# Architecture Decision Records (ADR)

Архитектурные решения PinheadOS, зафиксированные в момент принятия. Каждый ADR — одна страница: контекст, решение, последствия, альтернативы.

## Формат

```markdown
# ADR-NNNN — Заголовок решения

**Статус:** proposed / accepted / superseded / deprecated
**Дата:** YYYY-MM-DD
**Контекст ветки:** main / redesign/v2 / phase-2

## Контекст
Почему вопрос вообще возник. Какие силы давят.

## Решение
Что именно решили. Одно короткое утверждение.

## Последствия
Плюсы / минусы / что становится дороже / что становится возможным.

## Альтернативы
Что рассматривали и почему отвергли.
```

## Индекс

| ID | Решение | Статус | Введение |
|---|---|---|---|
| [0001](0001-seven-bounded-contexts-root-stores.md) | Seven bounded contexts как отдельные root stores | accepted | W1 |
| [0002](0002-rate-minutes-snapshot.md) | Rate & minutes snapshot на момент создания задания | accepted | W1 |
| [0003](0003-tenant-hook-day1.md) | Tenant_id column с day 1 (single-tenant runtime, multi-tenant ready) | accepted | W1 |
| [0004](0004-domain-events-outbox.md) | Domain events outbox вместо implicit triggers | accepted | W1 |
| [0005](0005-soft-delete-timestamp-convention.md) | Soft-delete через `deleted_at timestamptz` для новых таблиц | accepted | W1 |
| [0006](0006-baseline-kpi-measurement.md) | Baseline KPI методология для on-time delivery rate | accepted | W1 |
| [0007](0007-piecework-parallel-run-policy.md) | Piecework parallel-run policy перед cutover | accepted | W6 |
| [0008](0008-domain-events-dispatcher.md) | Domain events dispatcher via pg_cron polling | accepted | W1 |
| [0009](0009-main-redesign-v2-sync-strategy.md) | Weekly merge main → redesign/v2 sync strategy | accepted | Day-0 |

## ADR-queue (решаются по мере кодирования)

18 известных долгов (M:N foreman↔sections, approver/author split, QC right-of-reply, rush_flag RLS, /tv kiosk auth, empty/offline states, worker reassign, throughput vs fake utilization, baseline reliability, caching, connection pool, error boundaries, SLO alerting, `useShallow` lint, cutover decision tree, tenant-scoped RLS, stale bell links) — каждый получает ADR при первом кодировании, не раньше. Не блокируют старт, не прячутся.
