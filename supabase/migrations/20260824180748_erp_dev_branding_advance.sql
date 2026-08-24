-- Автовыход из «Нанесений» в «Пошив» на канбане ЭКС.
-- Правка заказчика 24.08, п. 4.3.
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Если выбрано несколько видов нанесения, этап считается
-- завершённым только после закрытия всех выбранных работ. После того как все
-- выбранные нанесения закрыты в соответствующих цехах, карточка АВТОМАТИЧЕСКИ
-- переходит в колонку "Пошив"… То есть ручное перемещение используется для
-- входа в Нанесения, а выход из Нанесений в Пошив происходит автоматически».
--
-- ЕДИНСТВЕННОЕ ИСКЛЮЧЕНИЕ ИЗ П. 4.2. Тот пункт требует, чтобы карточку двигал
-- человек; этот — чтобы ровно один переход случался сам. Оба исполняются, потому
-- что переход ЗАПИСЫВАЕТ ту же самую колонку `board_stage`: карточка не
-- «возвращается к расчёту» (тогда она могла бы уехать куда угодно), а получает
-- ровно то значение, которое назвал документ.
--
-- ПОЧЕМУ СЕРВЕР, А НЕ КЛИЕНТ. Нанесения закрывает ЦЕХ на своём экране, а не
-- технолог на доске ЭКС. Клиентский переход сработал бы только у того, у кого
-- в этот момент открыта доска, то есть почти никогда, и карточка застревала бы
-- в «Нанесениях» до случайного захода технолога.
--
-- ПОЧЕМУ SECURITY DEFINER. Цепочка такая: цех закрывает ЭТАП → триггер
-- `erp_experimental_task_sync` закрывает связанную ЗАДАЧУ → срабатывает этот
-- триггер. RLS `erp_experimental_update` требует `experimental.manage`, которого
-- у рабочего нет вовсе, — с `invoker` переход падал бы 42501 внутри чужой
-- транзакции и ронял бы цеху закрытие этапа. Права при этом не расширяются:
-- функция не принимает аргументов, пишет ОДНУ колонку и только когда карточка
-- уже стоит в «Нанесениях».

-- ── 1. Перечень типов задач-нанесений ────────────────────────────────────────
--
-- Отдельной функцией, а не литералом внутри триггера: тот же перечень живёт
-- на клиенте (`DEV_BRANDING_TASK_TYPES`), и сторож `devBranding.test.ts`
-- сверяет их дословно. Разойдись половины — карточка либо застрянет
-- в «Нанесениях» навсегда, либо уедет в «Пошив» с незакрытой работой.
--
-- `sublimation` здесь есть, хотя выбор при входе предлагает четыре вида:
-- автопереход обязан учитывать ВСЕ нанесения, иначе задача, заведённая руками,
-- повиснет незамеченной.
create or replace function public.erp_dev_branding_task_types()
returns text[]
language sql immutable set search_path = public as $$
  select array['silkscreen', 'dtf', 'embroidery', 'dtg', 'sublimation']::text[]
$$;

revoke execute on function public.erp_dev_branding_task_types() from public, anon;
grant execute on function public.erp_dev_branding_task_types() to authenticated;

comment on function public.erp_dev_branding_task_types() is
  'Типы задач разработки, составляющие шаг «Нанесения». Дословное зеркало DEV_BRANDING_TASK_TYPES в utils/experimentalBoard.';

-- ── 2. Переход «Нанесения» → «Пошив» ─────────────────────────────────────────
create or replace function public.erp_dev_branding_advance()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- Не нанесение — этот переход не про него
  if not (new.task_type = any (public.erp_dev_branding_task_types())) then
    return new;
  end if;
  -- Задача не закрылась (или уже была закрыта) — считать нечего
  if new.status not in ('done', 'cancelled')
     or old.status is not distinct from new.status then
    return new;
  end if;

  /**
   * ПЕРЕХОД ТОЛЬКО ИЗ «НАНЕСЕНИЙ». Условие не педантизм: запоздалая задача
   * нанесения, закрытая цехом уже после того, как технолог увёл карточку
   * в «Финальный этап», утащила бы её назад в «Пошив» — то есть отменила бы
   * решение человека. `board_stage is null` тоже не трогаем: такая карточка
   * ещё считается расчётом, и он сам покажет следующий шаг.
   */
  update public.erp_experimental e
     set board_stage = 'sewing'
   where e.id = new.experimental_id
     and e.board_stage = 'branding'
     and e.outcome is null
     -- Все выбранные нанесения закрыты: «этап считается завершённым только
     -- после закрытия ВСЕХ выбранных работ»
     and not exists (
       select 1 from public.erp_experimental_tasks t
        where t.experimental_id = new.experimental_id
          and t.task_type = any (public.erp_dev_branding_task_types())
          and t.status not in ('done', 'cancelled'));

  return new;
end $$;

-- Обход `20260812160000` закрыл для REST триггерные функции, которые были
-- на тот момент; у заведённой позже обязан быть СВОЙ отзыв. Отзывать нужно
-- `from public, anon`: право приходит от PUBLIC, и `anon` наследует его.
revoke execute on function public.erp_dev_branding_advance() from public, anon, authenticated;

drop trigger if exists erp_dev_branding_advance on public.erp_experimental_tasks;
create trigger erp_dev_branding_advance
  after update of status on public.erp_experimental_tasks
  for each row execute function public.erp_dev_branding_advance();

comment on function public.erp_dev_branding_advance() is
  'Канбан ЭКС: закрылось последнее нанесение — карточка переходит из «Нанесений» в «Пошив» (п. 4.3). Единственный автоматический переход; остальные делает человек (п. 4.2).';
