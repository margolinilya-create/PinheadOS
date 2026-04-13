# ADR-0006 — Baseline KPI measurement методология

**Статус:** accepted
**Дата:** 2026-04-13
**Контекст ветки:** redesign/v2

## Контекст

Главная KPI проекта — «on-time delivery rate +5..+20 п.п. от baseline». Без измеренного baseline KPI не существует: «улучшение» нельзя доказать. Devil's advocate ревью указал: baseline из Bitrix-истории ненадёжен, т.к. исторически сделки не велись с plan-vs-fact дисциплиной.

Необходимо: зафиксировать **методику** baseline-замера в W1, чтобы через 3 месяца можно было честно сравнить.

## Решение

**Baseline замеряется в W1 по двум независимым источникам одновременно:**

### Источник 1 — Bitrix исторические данные (backward-looking)
- Период: последние 3 месяца
- Definition of «on-time»: `actual_ship_date <= promised_ship_date`
- Extraction script: `scripts/baseline-extract.js` вытаскивает сделки через Bitrix REST API (user webhook с read-only scope)
- Missing data handling: сделки без `actual_ship_date` ИЛИ без `promised_ship_date` исключаются из знаменателя (не считаем их on-time по умолчанию)
- Output: `docs/adr/0006-baseline-data.csv` + сводная цифра в этом ADR

### Источник 2 — Manual parallel capture (forward-looking, W1-W2)
- Два недели параллельно: на main работают менеджеры как обычно, одновременно вручную ведётся Google Sheet с полями: `order_id`, `promised_date`, `actual_ship_date`, `status`
- Эту таблицу ведёт один менеджер (доброволец) для 10-20 заказов
- Результат сравнивается с Bitrix extract → если drift > 5%, Bitrix baseline дискредитирован, используется manual
- Если manual недоступен — Bitrix с дисклеймером

## Baseline значение (заполняется W1)

> **Baseline on-time rate (3 месяца до 2026-04-13):** `TBD-W1`
>
> Методика: Bitrix extraction via `scripts/baseline-extract.js` + manual parallel capture W1-W2.
>
> Known limitations: `TBD-W1`
>
> Target after MVP: `baseline + 5..+20 п.п.`, middle `baseline + 10 п.п.`
>
> **Honest disclaimer:** software alone не даст +20 без shifts/inventory/skill matrix (phase 2).

## Последствия

**Плюсы:**
- KPI становится measurable, а не маркетинговым лозунгом
- Две источника снижают риск недостоверного baseline
- Честный disclaimer в ADR предотвращает over-promising

**Минусы:**
- Требует 1-2 недели параллельной ручной работы менеджера (договориться в W1)
- Bitrix API access (credentials, scopes) — блокер, нужен от owner проекта
- Если manual и Bitrix расходятся > 5% — нужно отдельное расследование

## Альтернативы

- **Только Bitrix** — отвергнуто: devil warning о недостоверности
- **Только manual** — отвергнуто: слишком мало данных для статистики
- **Пропустить baseline, мерить только delta** — отвергнуто: невозможно доказать улучшение
- **Agency / survey методология** — отвергнуто: избыточно для внутреннего проекта

## TODO (W1)

- [ ] Получить от owner Bitrix API credentials (read-only webhook)
- [ ] Написать `scripts/baseline-extract.js`
- [ ] Назначить менеджера-добровольца для manual capture
- [ ] Создать Google Sheet шаблон
- [ ] Прогнать extract, заполнить baseline значение в этом ADR
- [ ] Создать `docs/adr/0006-baseline-data.csv` (gitignore если содержит PII)
