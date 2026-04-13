# ADR-0007 — Piecework parallel-run policy перед cutover

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2
**Вводится:** W6 (создание `piecework_batches` + policy документация)

## Контекст

Payroll — «un-unfuckable» trust. 30-80 швей работают на сделке. Первая зарплата с ошибкой ломает доверие к системе, которое не восстановится. Devil's advocate ревью: «parallel-run без SOP = parallel theater».

В v3 плане `piecework_batches.status = parallel_review` + `paid_at` immutability trigger решают техническую часть. Этот ADR фиксирует **операционную часть**: кто, когда, как сверяет.

## Решение

**Cutover на автоматическую сделку происходит только после полного parallel-run цикла с drift < 1% против Excel.**

### Роли

- **Бухгалтер** (назначается до W6, имя в `docs/adr/0007-accountant.txt`) — ведёт текущий Excel и daily reconcile
- **Developer** (я) — поддерживает PinheadOS piecework
- **COO** — утверждает переход в `closed` status

### Процесс

1. **W6:** Создан `piecework_batches` схема, первый batch открывается в `status='open'`
2. **W7:** Бригадир-пилот начинает использовать мастер-экран (тестовый), piecework записывается в batch=open
3. **W8:** Батч переходит в `status='parallel_review'`. Начинается **daily reconcile**:
   - Каждый день в 18:00 бухгалтер экспортирует CSV из PinheadOS (`v_piecework_reconcile`)
   - Сверяет построчно с Excel
   - Расхождения логируются в `docs/adr/0007-drift-log.md`
4. **W11:** При drift < 1% суммарно за период → batch готов к закрытию
5. **W12:** COO утверждает → `UPDATE piecework_batches SET status='closed', closed_at=now(), closed_by=<COO_id>` → DB trigger проставляет `paid_at` на всех entries
6. **После закрытия:** payroll берётся из PinheadOS, Excel архивируется

### Decision tree при drift ≥ 1%

- **Drift 1-3%:** Причины разобрать построчно. Если все расхождения объяснимы (ручная коррекция в Excel, забытая запись) → фикс, повтор reconcile на следующий день.
- **Drift 3-10%:** Escalate COO. Возможный сценарий — extend parallel-run ещё на один batch period.
- **Drift > 10%:** STOP cutover. Возврат в development, отдельная дебаг-неделя.

### `v_piecework_reconcile` view

Создаётся в 20260505:

```sql
CREATE VIEW v_piecework_reconcile AS
SELECT
  w.full_name,
  pb.period_start, pb.period_end,
  SUM(CASE WHEN pe.entry_type = 'accrual' THEN pe.amount ELSE 0 END) AS accrual,
  SUM(CASE WHEN pe.entry_type = 'defect_penalty' THEN pe.amount ELSE 0 END) AS penalty,
  SUM(CASE WHEN pe.entry_type = 'bonus' THEN pe.amount ELSE 0 END) AS bonus,
  SUM(CASE WHEN pe.entry_type = 'manual_adjustment' THEN pe.amount ELSE 0 END) AS manual_adj,
  SUM(pe.amount) AS total
FROM piecework_entries pe
JOIN workers w ON w.id = pe.worker_id
JOIN piecework_batches pb ON pb.id = pe.batch_id
GROUP BY w.id, w.full_name, pb.id, pb.period_start, pb.period_end
ORDER BY w.full_name, pb.period_start;
```

Бухгалтер экспортирует `SELECT * FROM v_piecework_reconcile WHERE period_start = '...'` в CSV.

## Последствия

**Плюсы:**
- Trust-по умолчанию: ни одна зарплата не выплачивается из PinheadOS без сверки
- Decision tree покрывает 1/3/10% drift — нет неопределённости
- Role clarity: бухгалтер, developer, COO
- `paid_at` DB trigger гарантирует immutability после закрытия

**Минусы:**
- Добавляет ~5 минут/день работы бухгалтеру в W8-W12
- Если бухгалтер не назначен к W6 — блокер cutover
- Parallel-run может растянуться на 2+ batch'а если drift не сходится

**Правила:**
- Никаких ручных изменений `paid_at` кроме closure через `UPDATE piecework_batches`
- Drift log коммитится в git (без PII — только агрегаты и причины)
- COO имеет единственный authority для `status='closed'`

## Альтернативы

- **Cutover без parallel-run** — отвергнуто: ломает trust
- **Parallel-run на 1 день** — отвергнуто: недостаточно для случайных ошибок
- **Auto-close при drift < 1%** — отвергнуто: нужна human authority (COO)
- **Бухгалтер делает reconcile раз в неделю** — отвергнуто: слишком поздно ловить ошибки

## TODO (W6)

- [ ] Назначить бухгалтера (имя в `docs/adr/0007-accountant.txt`, gitignored если PII)
- [ ] Создать `v_piecework_reconcile` view в миграции 20260505
- [ ] Написать `scripts/export-piecework-csv.sh` для бухгалтера
- [ ] Создать `docs/adr/0007-drift-log.md` шаблон
- [ ] Получить подтверждение COO на процесс
