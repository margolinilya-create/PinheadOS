-- Два индекса, избыточных по ПРЕФИКСУ составного (обзор 26.09, сессия 69).
--
-- Advisor `unused_index` 26.09 насчитал 86 неиспользуемых индексов; решение
-- владельца — большинство пересмотреть в октябре по накопленной статистике,
-- а те, что избыточны независимо от статистики, снять сейчас. Избыточен
-- индекс, чьи колонки — префикс другого индекса той же таблицы: планировщик
-- берёт составной и для запроса по первой колонке.
--
-- Сверка с живой базой перед дропом (pg_stat_user_indexes, 26.09):
--   erp_orders_status_idx (status)            — 0 чтений;
--   erp_orders_status_due_idx (status, due_date) — 1850 чтений, покрывает;
--   erp_calendar_slots_stage_idx (stage_id)   — 0 чтений;
--   erp_calendar_stage_date_idx (stage_id, work_date), unique — покрывает,
--   в том числе внешний ключ erp_calendar_slots.stage_id (префикс считается).
--
-- Третий кандидат из разведки — erp_warehouse_tasks_order_idx — НЕ снят:
-- «покрывающий» erp_warehouse_tasks_order_type_idx частичный
-- (where stage_id is null and material_id is null) и запросы по order_id
-- не обслуживает; у самого индекса 76 042 чтения. Разведка по тексту миграций
-- этого не видела — условие частичности стоит в другой миграции.

drop index if exists public.erp_orders_status_idx;
drop index if exists public.erp_calendar_slots_stage_idx;
