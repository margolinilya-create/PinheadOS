# Выкатка вехи 5в «Дизайн» 2.0 — база

Фронт вехи 5в (Э1–Э8) миграций не требует: работает на нынешней схеме. Ниже — то, что
закрывает права на сервере и готовит следующие этапы. **ERP не затрагивается** ни одним файлом.

## P — «Мои раскладки» (`20261026090000_order_templates_layouts`)

Что: `order_templates` — revoke у `anon` (там было всё, включая TRUNCATE, обходящий RLS),
UPDATE и TRUNCATE у `authenticated`; CHECK имени (1…60, без пробелов по краям) и данных
(`kind = 'layout'`, `v = 1`, 1…20 нанесений, ≤ 16 КБ); политики — свои строки И продажи
или руководство продаж (`sales_is_seller()` / `sales_is_lead()`).

Порядок: **независим от фронта** — боевой фронт таблицу не читает (0 строк на 26.10).

1. Сухой прогон — `1-dryrun-P.sql` в SQL Editor целиком. Ожидание:
   `ERROR: PROBE_RESULT fails=0 total=23`. Прогон 26.10 через MCP (транзакция откатилась,
   в базе ничего не изменилось) — `fails=0 total=23`.
2. Применение — `supabase/migrations/20261026090000_order_templates_layouts.sql` в SQL Editor.
3. Проба после — `supabase/probes/order_templates.sql` (то же ожидание).
4. Запись в `supabase/migrations/APPLIED.json` (порядок — `supabase/migrations/README.md`).

Откат: `20261026090000_order_templates_layouts_rollback.sql` (права anon не возвращает).
Триггер отката: «Мои раскладки» у продавца отвечают «permission denied» — сначала проверить
признак `is_sales` и `approved` у человека в `/sales-staff`.

## Смоук Storage `copy` («Повторить заказ», Э8)

Права копии судит storage-api по политикам `order-artworks` (SQL-пробой не проверить).
После выкладки фронта, под продавцом:
1. свой заказ с логотипом → «ТЗ и цена» → «Повторить заказ» → в новом черновике логотип на холсте;
2. в DevTools: `supabase.storage.from('order-artworks').copy('<путь своего файла>', 'orders/<чужой черновик>/logo/x.png')`
   → ошибка; то же в свой заказ не в черновике → ошибка.
