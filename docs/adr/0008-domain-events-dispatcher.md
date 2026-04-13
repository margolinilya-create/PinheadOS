# ADR-0008 — Domain events dispatcher via pg_cron polling

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2

## Контекст

[ADR-0004](0004-domain-events-outbox.md) ввёл таблицу `domain_events` как outbox. Нужен механизм который:
1. Читает необработанные события
2. Выполняет побочные эффекты (создание notifications, запись audit, fan-out realtime)
3. Маркирует события как обработанные
4. Реентерабелен (retry-safe)
5. Восстанавливается при крашах

Второй архитектурный ревьюер указал на противоречие в v3 плане: одновременно упоминались «trigger на `domain_events` insert» для mv-refresh и «cron edge function» — это два разных механизма. Trigger-per-insert создаёт refresh storm при 200+ events/час.

## Решение

**Единственный dispatcher mechanism — `pg_cron` + edge function polling каждые 10 секунд.**

### Изменения схемы (миграция 20260501)

```sql
-- domain_events уже создана; добавляем колонку processed_at
ALTER TABLE domain_events ADD COLUMN processed_at timestamptz;
CREATE INDEX ON domain_events (processed_at) WHERE processed_at IS NULL;
```

### Edge function `domain-events-dispatcher`

```
supabase/functions/domain-events-dispatcher/index.ts
```

Тело (pseudo):
```ts
// Cron: every 10 seconds
const events = await sb.from('domain_events')
  .select('*')
  .is('processed_at', null)
  .or('created_at.lt.' + fiveMinutesAgo)  // retry crashed events
  .order('created_at')
  .limit(500);

for (const batch of groupBy(events, 'event_type')) {
  switch (batch.type) {
    case 'task_completed':
      await emitNotification('status_change', batch);
      await emitAudit('operation_finish', batch);
      break;
    case 'qc_rejected':
      await emitNotification('defect', batch);
      await emitAudit('defect_found', batch);
      break;
    case 'piecework_accrued':
      // consumer уже обработал in transaction, dispatcher только audit
      await emitAudit('piecework_accrual', batch);
      break;
    // ...
  }
}

// Mark processed
await sb.from('domain_events')
  .update({ processed_at: now() })
  .in('id', events.map(e => e.id));
```

### Scheduling

```sql
-- В миграции 20260501:
SELECT cron.schedule(
  'dispatch-domain-events',
  '*/10 * * * * *',  -- каждые 10 секунд
  $$ SELECT net.http_post(
       url := 'https://<project-ref>.supabase.co/functions/v1/domain-events-dispatcher',
       headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.service_role_key'))
     ) $$
);
```

### Crash recovery

- Событие с `processed_at IS NULL AND created_at < now() - interval '5 min'` = предполагаемый краш consumer'а
- Следующий cron-запуск повторно обработает
- `idempotency_key` на consumer-сайде защищает от дублей

### TV Dashboard materialized view (phase 2, месяц 4)

Не связан с dispatcher. Отдельный cron `*/60 * * * * *` (раз в минуту) вызывает `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_tv_dashboard_stats`. Не реагирует на события индивидуально.

## Последствия

**Плюсы:**
- Единственный dispatcher → нет контракта противоречий
- 10-секундная задержка приемлема для notifications/audit
- Batch processing снижает overhead по сравнению с trigger-per-insert
- Crash recovery встроен через `processed_at + created_at` окно
- Materialized view refresh отделён от dispatcher → нет refresh storm

**Минусы:**
- 10-секундная latency — не мгновенно (UI bell может задерживаться)
- Single point of failure (если cron упал — notifications не доставляются)
- Нагрузка на dispatcher растёт с количеством events: при > 5000 events/час нужен батч > 500 или параллелизация

**Правила:**
- Любой consumer должен быть idempotent (использовать `idempotency_key`)
- Dispatcher не должен падать на одном bad event — try/catch per event, лог ошибок в отдельную таблицу
- Мониторинг: alert если `count(*) where processed_at is null` > 1000

## Альтернативы

- **Trigger per insert** — отвергнуто: refresh storm
- **LISTEN/NOTIFY** — отвергнуто: нет persistence, потери при reconnect
- **Supabase Realtime как outbox consumer** — отвергнуто: Realtime для UI, не для app logic
- **External queue (SQS, etc.)** — отвергнуто: избыточно, ещё один сервис

## TODO (W1)

- [ ] Миграция 20260501: создать `domain_events.processed_at` колонку + индекс
- [ ] Создать edge function `domain-events-dispatcher` stub с pseudo-logic
- [ ] Setup `pg_cron` расписание (требует Supabase extension)
- [ ] Написать unit test для dispatcher на fake events
- [ ] Decide: где хранится `service_role_key` для HTTP вызова (Supabase Vault)
