# Выкатка правок 19.10, план A (производство) — S1, E1, C1

План — `docs/superpowers/plans/2026-10-19-erp-edits-19-10-a-production.md`, задача 9.
Правила — `docs/rules/pravila-pravok-19-10.md`. Сторож папки — `pinhead-react/src/erp/utils/rollout1910a.test.ts`
(тело каждой функции в `*_rollback.sql` = прежняя редакция, порядок и разделы этого файла).

| Код | Миграция | Что делает | Проба (ожидание) | Откат |
|---|---|---|---|---|
| S1 | `20261019090000_erp_attach_30mb_passport_optional` | бакет `erp-attachments` — 30 МБ (`31457280`); техпаспорт для «Готово к серии» необязателен | `erp_attach_30mb_passport.sql` → `PROBE_RESULT fails=0 total=8` | `20261019090000_erp_attach_30mb_passport_optional_rollback.sql` |
| E1 | `20261019100000_erp_embroidery_one_stage` | вышивка одной строкой: фаза программы → «Вышивка» (`erp_embroidery_program_finish`/`_skip`), страж запуска вышивки, непрозрачная фаза | `erp_embroidery_one_stage.sql` → `PROBE_RESULT fails=0 total=38` | `20261019100000_erp_embroidery_one_stage_rollback.sql` |
| C1 | `20261019110000_erp_cut_result_once` | сдача закроя: выпуск один раз, расход по рулонам, средний по материалу, страж рулонов | `erp_cut_result_once.sql` → `PROBE_RESULT fails=0 total=41` | `20261019110000_erp_cut_result_once_rollback.sql` (только `erp_stage_submit_report`) |

Применяет **владелец в SQL Editor** (MCP `execute_sql` виснет на `drop`/`delete`); контроллер — только SELECT
и запись в `APPLIED.json`. Пробы до этой выкатки не прогонялись ни разу, даже сухим прогоном, — первый
сухой прогон и есть их проверка.

## 1. Предусловия

1. K (`20261018160000`) и M (`20261018170000`) вехи 8 применены и записаны в `supabase/migrations/APPLIED.json`
   (сделано 18.10, коммит `8633c28`), окно наблюдения K закрыто. Неприменённых миграций после A — 3
   (сторож журнала держит ≤ 5; план B добавит 2).
2. **Глобальный лимит Storage проекта ≥ 30 МБ** (Dashboard → Storage → Settings → «Upload file size limit»).
   Из SQL его не видно; если он меньше, бакет на 30 МБ всё равно отвечает 413 на 20–30 МБ.
3. Перед E1 — SELECT «вышивка в работе при несданном крое». Должно быть **0 строк**; иначе каждую строку
   разобрать с производством до применения (после E1 такая строка не сдаст штуки, пока крой не закрыт):

   ```sql
   select o.title, o.bitrix_id, s.id as stage_id, s.status, pd.code as waits_for, p.status as dep_status
     from public.erp_item_stages s
     join public.erp_departments d  on d.id = s.department_id and d.code = 'embroidery'
     join public.erp_order_items i  on i.id = s.item_id
     join public.erp_orders o       on o.id = i.order_id
     join public.erp_item_stages p  on p.id = any (s.depends_on)
     join public.erp_departments pd on pd.id = p.department_id
    where s.result_kind is null
      and s.status = 'in_progress'
      and p.status not in ('done', 'skipped')
      and o.status = 'active';
   ```

## 2. Порядок

**S1 → E1 → C1, затем фронт.** Каждую миграцию:

1. **Сухой прогон.** Открыть файл пробы; сразу после строк `set local …` в начале вставить текст миграции
   целиком. Выполнить: проба заканчивается исключением `PROBE_RESULT fails=0 total=N` — оно же откатывает
   всё. Любое `fails>0` — стоп, миграцию не применять.
2. **Применение.** Текст миграции → Run. Затем `notify pgrst, 'reload schema';`.
3. **Журнал.** Контроллер SELECT-ом видит версию в `supabase_migrations.schema_migrations`, дописывает её
   в `supabase/migrations/APPLIED.json`, `cd pinhead-react && npm run migrations:verify` — зелёное, коммит.

S1 мягче прежнего (лимит выше, требование слабее) — её можно применять до фронта в любой момент. E1 и C1
прежний фронт переживает: старый маршрут создаёт две строки вышивки, и E1 их не трогает (фаза только
у одиночной строки); старая форма закроя шлёт размеры на рулонах, и C1 читает этот формат по-старому.
Фронт выкладывается после C1.

## 3. Откат

**По умолчанию — только фронт** (redeploy предыдущей сборки): сервер после S1/E1/C1 совместим с прежним
интерфейсом. Серверный откат — только по триггерам ниже и всегда ПОСЛЕ отката фронта.

- **S1** — `20261019090000_erp_attach_30mb_passport_optional_rollback.sql`: лимит 20 МБ и требование
  техпаспорта. Файлы больше 20 МБ, уже лежащие в бакете, остаются.
- **E1** — `20261019100000_erp_embroidery_one_stage_rollback.sql`: прежние `erp_stage_guard`,
  `erp_stage_completion_block`, `erp_stage_passthrough`, `erp_item_produced_qty`; снимает триггер
  `erp_item_stages_dep_gate` и функции E1. **Перед ним — SELECT одиночных строк вышивки** для ручного
  разбора: строки в фазе программы после отката станут прежней «программой» без второй строки «Вышивка»
  (её заводят конструктором маршрута), а уже ставшие «Вышивкой» останутся одной строкой:

  ```sql
  select o.title, o.bitrix_id, s.id as stage_id, s.status, s.result_kind
    from public.erp_item_stages s
    join public.erp_departments d on d.id = s.department_id and d.code = 'embroidery'
    join public.erp_order_items i on i.id = s.item_id
    join public.erp_orders o      on o.id = i.order_id
   where o.status = 'active'
     and s.status not in ('done', 'skipped')
     and not exists (select 1 from public.erp_item_stages n
                       join public.erp_departments nd on nd.id = n.department_id
                      where n.item_id = s.item_id and n.id <> s.id and nd.code = 'embroidery')
   order by o.title;
  ```

  Файл сам проверяет итог (`ROLLBACK_E1_OK` в сообщениях) и заканчивается `notify pgrst, 'reload schema'`.
- **C1** — `20261019110000_erp_cut_result_once_rollback.sql`: только `erp_stage_submit_report` прежним телом.
  Читатели (`erp_fabric_usage`, `erp_item_economics`, `erp_analytics_fabric_by_sku`) и страж рулонов
  остаются новыми — старые отчёты они читают по-старому.

Запись в `APPLIED.json` после серверного отката остаётся: журнал отражает факт применения, а откат
фиксируется записью в `docs/changelog/2026-10.md` и `SESSION-STATE.md`.

## 4. Триггеры отката

| Условие | Действие |
|---|---|
| `PROBE_RESULT fails>0` после применения (повторный прогон пробы на применённой базе) | откат миграции |
| `check_violation` (23514) на `done` строки программы двухстрочного заказа | срочная правка E1 (старые пары живут по `erp_stage_program_block`, фаза их не касается) |
| `erp_item_economics` = `null` по новым отчётам кроя | откат фронта, разбор C1 |
| новые «Ошибки интерфейса» ERP (`/admin`, вкладка) за 2 ч после выкладки | откат фронта |
| загрузки 20–30 МБ отвечают 413 | глобальный лимит Storage (предусловие 2), не откат |

## 5. Наследие: старые заказы с двумя строками вышивки

Пока есть открытые заказы с парой «программа + вышивка», живут `erp_stage_program_block` (сервер)
и `embroideryProgramBlock` (клиент, `utils/stageResult.ts`). Когда запрос ниже вернёт **0** — удалить оба
отдельной правкой (миграция + клиент одним коммитом):

```sql
select count(distinct s.item_id) as items_with_pair
  from public.erp_item_stages s
  join public.erp_departments d on d.id = s.department_id and d.code = 'embroidery'
  join public.erp_order_items i on i.id = s.item_id
  join public.erp_orders o      on o.id = i.order_id
 where o.status = 'active'
   and s.result_kind = 'embroidery_program'
   and exists (select 1 from public.erp_item_stages n
                 join public.erp_departments nd on nd.id = n.department_id
                where n.item_id = s.item_id and n.id <> s.id
                  and nd.code = 'embroidery' and n.result_kind is null);
```
