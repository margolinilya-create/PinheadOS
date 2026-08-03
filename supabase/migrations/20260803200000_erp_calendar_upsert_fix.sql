-- Постановка задачи в план не работала: upsert падал на 42P10.
--
-- Найдено живым прогоном против прода. `planStage` делает
-- `.upsert(row, { onConflict: 'stage_id,work_date' })`, PostgREST превращает это
-- в `ON CONFLICT (stage_id, work_date)`, а индекс был ЧАСТИЧНЫЙ:
--
--   create unique index … on (stage_id, work_date) where stage_id is not null;
--
-- Postgres выводит целевой индекс из списка колонок и частичный индекс так найти
-- НЕ МОЖЕТ: чтобы он подошёл, в ON CONFLICT нужен ещё и предикат
-- (`… where stage_id is not null`), а PostgREST его не отправляет и отправить
-- не умеет. Ошибка возникала на КАЖДОМ вызове, а не только при повторной
-- постановке: спецификация ON CONFLICT проверяется при планировании запроса,
-- до того как выяснится, есть ли конфликт вообще.
--
-- Почему не поймали раньше: тесты слайса ходят в мок стора, а e2e поднимает
-- фронт с мок-ключами — ни один прогон не доходил до настоящего PostgREST.
-- Тот же урок, что с ключом Storage: инвариант чужого API проверяется только
-- вызовом этого API.
--
-- Почему предикат можно снять без последствий. Он защищал строки без этапа
-- (`stage_id is null`) — задача на цех целиком, не привязанная к этапу. В обычном
-- уникальном индексе Postgres считает NULL-ы РАЗНЫМИ (`nulls distinct` — умолчание),
-- поэтому таких строк по-прежнему может быть сколько угодно на одну дату.
-- Ограничение «одна задача на этап в день» сохраняется дословно.

drop index if exists public.erp_calendar_stage_date_idx;

create unique index if not exists erp_calendar_stage_date_idx
  on public.erp_calendar_slots (stage_id, work_date);

comment on index public.erp_calendar_stage_date_idx is
  'Одна задача плана на этап в день. НЕ частичный: частичный индекс невыводим из ON CONFLICT (stage_id, work_date), который шлёт PostgREST. NULL-ы Postgres считает разными, поэтому строки без stage_id не ограничены.';
