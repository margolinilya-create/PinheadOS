# ADR-0004 — Domain events outbox вместо implicit triggers

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2

## Контекст

Status-переходы `order_tech_operations` (pending → in_progress → done → qc_passed) должны триггерить несколько побочных эффектов: создание `piecework_entries`, запись в `notifications`, realtime fan-out на подписчиков, запись в `order_audit`. Имплементация «каждый эффект — отдельный trigger на основной таблице» ведёт к:

- Write amplification (4-5 trigger'ов на каждую операцию → audit взрывается)
- Отсутствию idempotency (retry из edge function создаёт дубли)
- Связке Execution↔Payroll через implicit triggers (плохо для DDD)
- Refresh storm materialized views при частых insert'ах

## Решение

Все побочные эффекты идут через **outbox таблицу `domain_events`**:

```sql
CREATE TABLE domain_events (
  id uuid primary key,
  tenant_id uuid not null default '...',
  event_type text not null,  -- task_completed | qc_passed | rework_created | ...
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  processed_at timestamptz  -- dispatcher маркирует обработанные
) PARTITION BY RANGE (created_at);
```

Consumer'ы читают `domain_events where processed_at is null` и обрабатывают batches. Dispatcher implementation — см. [ADR-0008](0008-domain-events-dispatcher.md).

Producer'ы (edge functions, app-level при approve tech card) пишут в `domain_events` в той же транзакции, что и основные данные. `idempotency_key` защищает от retry-дублей.

## Последствия

**Плюсы:**
- Единая точка наблюдения всех производственных событий
- Idempotent дlivery (retry-safe)
- Decoupling bounded contexts: Payroll не знает про Execution, читает только `domain_events`
- Audit log и notifications — consumer'ы, не trigger'ы
- Multi-tenant retrofit: `domain_events` уже scoped по `tenant_id`
- Partitioning по месяцам решает write amplification

**Минусы:**
- Дополнительная таблица + dispatcher complexity
- Задержка обработки (cron polling ~10 сек, см. ADR-0008) — не real-time
- Единая точка отказа: если dispatcher упал, всё тормозит

**Правила:**
- Любое производственное side-effect идёт через событие
- Event schema = `{event_type, aggregate_id, payload}` — минимально стабильный контракт
- `processed_at` маркирует успешную обработку; retry на записях старше 5 мин

## Альтернативы

- **Implicit triggers** — отвергнуто: write amplification + связки
- **PostgreSQL LISTEN/NOTIFY** — отвергнуто: нет persistence, потери при рестарте
- **RabbitMQ / Kafka** — отвергнуто: overkill для single-dev SaaS
- **Trigger-per-insert на mv-refresh** — отвергнуто: refresh storm
