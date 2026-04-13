# ADR-0002 — Rate & minutes snapshot на момент создания задания

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2

## Контекст

Сделка (`piecework_entries`) считается как `qty × rate` на момент выполнения задания. Если `operation_types.base_rate` изменится между созданием задания и его выполнением, возникнут споры: по какому тарифу платить? По тому, что был при назначении, или по текущему?

Payroll — «un-unfuckable» trust. Швея должна видеть свой тариф в момент назначения задания и быть уверена, что он не изменится под ней.

## Решение

При создании `order_tech_operations` (триггер approve tech card) **копируем** актуальные значения из `operation_types` и `sku_tech_templates` в столбцы:

- `order_tech_operations.rate_snapshot numeric not null`
- `order_tech_operations.minutes_snapshot numeric not null`

Все дальнейшие расчёты сделки используют **только эти snapshot'ы**, не lookup в `operation_types`.

Изменение `operation_types.base_rate` влияет **только на новые задания**, созданные после изменения. Существующие snapshot'ы не трогаются.

## Последствия

**Плюсы:**
- Нулевая неопределённость: тариф задания = тариф на момент создания
- Event-sourcing hygiene: исторические данные неизменяемы
- Параллельно с `paid_at` immutability (DB trigger, 20260510) гарантирует корректность payroll
- Упрощает audit: `piecework_entries.amount = rate_snapshot × qty` проверяется CHECK constraint

**Минусы:**
- Денормализация: те же значения хранятся в двух местах (`operation_types` и `snapshot`)
- Массовое изменение тарифов (например, индексация) требует явного flow «создать новые задания» или ручной коррекции

**Правила:**
- Admin при изменении `operation_types.base_rate` видит alert: «это повлияет только на новые задания»
- Если нужно массовое обновление — процедура через ручные `piecework_entries.entry_type='manual_adjustment'` с причиной

## Альтернативы

- **Lookup в момент расчёта** — отвергнуто: ретроактивные изменения ломают trust
- **Версионирование `operation_types`** — отвергнуто: слишком сложно для MVP, snapshot проще
- **Denormalize только rate, не minutes** — отвергнуто: minutes тоже участвуют в отчётах, нужна immutability
