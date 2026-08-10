-- Частичная приёмка материалов и единицы измерения (правки заказчика 10.08,
-- волны 3.3 и 3.7). Одна миграция, потому что обе правки трогают приёмку:
-- приход без единицы измерения — это число без смысла.
--
-- ── ЧАСТИЧНАЯ ПРИЁМКА ──
--
-- Документ: «Приход материала должен вноситься частями: пришло 60 из 100,
-- потом ещё 35 — видно, что осталось 5, и задача склада не закрыта».
--
-- Сегодня приёмка — одно поле `qty_received`, то есть один снимок. Второй
-- приход его перезаписывает, и «60, потом 35» превращается в «35».
--
-- РЕШЕНИЕ: журнал `erp_material_receipts`, а `qty_received` ОСТАЁТСЯ и
-- становится СУММОЙ, которую ведёт триггер. Это важнее, чем кажется: колонку
-- читают материальный гейт (`materialPending` → закрой и швейка), гейт отгрузки
-- (`isOrderReadyToShip`), автозакрытие закупки (`maybeCloseSupply`) и карточка
-- приёмки. Заменив колонку журналом, пришлось бы переписать все четыре — и
-- любая пропущенная точка остановила бы производство молча.
--
-- БЭКФИЛЛ идёт ПЕРВЫМ шагом. Без него первый же частичный приход пересчитает
-- сумму «с нуля» и обнулит уже принятое: материал перестанет быть принятым,
-- и закрой встанет. На проде такой материал ровно один из 52 (проверено), но
-- правило от этого не меняется — оно про порядок, а не про количество.
--
-- ГЕЙТ НЕ ТРОГАЕМ. `materialPending` смотрит на `accept_status`, а не на
-- количество, и частичная приёмка выражается существующим значением
-- `accepted_partial`. Поведение «недостача блокирует закрой» сохраняется
-- в точности: ни одна гейтовая функция этой миграцией не переписывается.
--
-- ── ЕДИНИЦЫ И ЦЕНА ──
--
-- `unit` — МЕТКА, а не коэффициент: пересчёт кг↔м в задачу не входит и был бы
-- враньём (плотность ткани у каждого артикула своя). `price_per_unit` — СНИМОК
-- цены выбранного поставщика: цена в справочнике меняется, а история закупки
-- меняться не должна. Итоговая сумма НЕ хранится — считается на лету; хранить
-- производную значит завести расхождение.
--
-- БЭКФИЛЛ `qty` (свободный текст) разбирает только однозначное: «100», «120 м»,
-- «40кг», «200м», «100 шт». «обязательно» и подобное остаётся человеку — молча
-- парсить свободный текст значит потерять данные.

-- ── 1. Единицы и цена ──

alter table public.erp_materials
  add column if not exists unit text,
  add column if not exists price_per_unit numeric;

comment on column public.erp_materials.unit is
  'Единица измерения: метка для человека (кг, м, шт, уп). НЕ коэффициент — пересчёта между единицами система не делает.';
comment on column public.erp_materials.price_per_unit is
  'Цена за единицу — снимок на момент выбора поставщика. Цена в справочнике может измениться позже и не должна переписывать историю закупки. Итоговая сумма не хранится: считается на лету.';

-- ── 2. Журнал приходов ──

create table if not exists public.erp_material_receipts (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.erp_materials(id) on delete cascade,
  qty numeric not null check (qty > 0),
  unit text,
  -- Что именно приехало: полностью по плану, недостача, пересорт
  accept_status text not null default 'accepted_full'
    check (accept_status in ('accepted_full','accepted_partial','shortage','mismatch','rejected')),
  invoice text,
  comment text,
  received_on date not null default current_date,
  author text,
  author_id uuid,
  created_at timestamptz not null default now(),
  -- Отклонение объясняется, как и в журнале этапов
  constraint erp_material_receipts_deviation_needs_comment check (
    accept_status in ('accepted_full','accepted_partial')
    or (comment is not null and length(btrim(comment)) > 0)
  )
);

create index if not exists erp_material_receipts_material_idx
  on public.erp_material_receipts (material_id, received_on desc);

alter table public.erp_material_receipts enable row level security;

drop policy if exists "erp_material_receipts_read" on public.erp_material_receipts;
create policy "erp_material_receipts_read" on public.erp_material_receipts
  for select to authenticated using (public.erp_is_member());

-- Пишет тот же, кто ведёт приёмку: право `material.receive` уже гейтит
-- `accept_*` и `qty_received` в страже материалов. Своего права не заводим.
drop policy if exists "erp_material_receipts_insert" on public.erp_material_receipts;
create policy "erp_material_receipts_insert" on public.erp_material_receipts
  for insert to authenticated with check (public.erp_has_permission('material.receive'));

-- Исправление ошибки склада — правка строки журнала, а не вторая строка
-- с минусом: «пришло −20» никто не читает как «ошиблись».
drop policy if exists "erp_material_receipts_update" on public.erp_material_receipts;
create policy "erp_material_receipts_update" on public.erp_material_receipts
  for update to authenticated
  using (public.erp_has_permission('material.receive'))
  with check (public.erp_has_permission('material.receive'));

drop policy if exists "erp_material_receipts_delete" on public.erp_material_receipts;
create policy "erp_material_receipts_delete" on public.erp_material_receipts
  for delete to authenticated using (public.erp_has_permission('material.receive'));

-- ── 3. Бэкфилл — ДО триггера ──
--
-- Уже принятое переносим синтетической строкой журнала, иначе первый пересчёт
-- обнулит сумму. Порядок здесь и есть содержание шага.

insert into public.erp_material_receipts
  (material_id, qty, unit, accept_status, comment, received_on, author)
select m.id,
       m.qty_received,
       m.unit,
       coalesce(m.accept_status, 'accepted_full'),
       'Перенос из карточки материала при вводе журнала приёмок',
       coalesce(m.received_at, current_date),
       coalesce(m.accepted_by, 'система')
  from public.erp_materials m
 where m.qty_received is not null
   and m.qty_received > 0
   and not exists (
     select 1 from public.erp_material_receipts r where r.material_id = m.id
   );

-- ── 4. Rollup: сумма журнала → карточка материала ──

create or replace function public.erp_material_receipts_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_material uuid := coalesce(new.material_id, old.material_id);
begin
  update public.erp_materials m
     set qty_received = (
           select sum(r.qty) from public.erp_material_receipts r
            where r.material_id = v_material
         ),
         -- Дата последнего прихода: карточка показывает «когда приняли»
         received_at = (
           select max(r.received_on) from public.erp_material_receipts r
            where r.material_id = v_material
         ),
         updated_at = now()
   where m.id = v_material;
  return null;
end $$;

drop trigger if exists erp_material_receipts_rollup_trg on public.erp_material_receipts;
create trigger erp_material_receipts_rollup_trg
  after insert or update or delete on public.erp_material_receipts
  for each row execute function public.erp_material_receipts_rollup();

-- Триггерная функция не должна быть вызываемой через REST: она пишет
-- `qty_received` в обход журнала, то есть ровно то, ради запрета чего журнал
-- и заведён. Правило общее для всех триггеров (20260803250000), и его
-- сторожит `permissionsCoverage.test.ts`.
revoke execute on function public.erp_material_receipts_rollup() from anon, authenticated, public;

comment on function public.erp_material_receipts_rollup() is
  'Сумма журнала приходов в erp_materials.qty_received. Колонка остаётся, потому что её читают материальный гейт, гейт отгрузки, автозакрытие закупки и карточка приёмки — переписывать все четыре ради журнала значило бы остановить производство на первой пропущенной точке.';

-- ── 5. Бэкфилл единиц из свободного текста ──
--
-- Разбираем ТОЛЬКО однозначное: число, при желании с единицей. Всё остальное
-- («обязательно») оставляем человеку: молча парсить свободный текст значит
-- потерять данные, а не привести их в порядок.

-- Группы в шаблоне ОБЯЗАТЕЛЬНО не захватывающие: `substring(x from '…(…)…')`
-- возвращает ПЕРВУЮ ГРУППУ, а не всё совпадение. С `([.,][0-9]+)?` разбор «100»
-- давал NULL — необязательная группа не совпала, и число молча терялось.
-- Поймано на проде: единицы проставились, количества — нет.
update public.erp_materials m
   set qty_expected = coalesce(
         m.qty_expected,
         replace(substring(btrim(m.qty) from '^[0-9]+(?:[.,][0-9]+)?'), ',', '.')::numeric),
       unit = coalesce(m.unit, nullif(btrim(substring(btrim(m.qty) from '[а-яА-Яa-zA-Z.]+$')), ''))
 where m.qty is not null
   and btrim(m.qty) ~ '^[0-9]+([.,][0-9]+)?\s*[а-яА-Яa-zA-Z.]*$';

-- Справочник единиц — подсказка поверх свободного ввода, как остальные.
-- CHECK на `kind` перечисляет виды поимённо, поэтому его надо расширить ДО
-- вставки: без этой строки insert падает на 23514, а не заводит подсказки.
alter table public.erp_dictionaries
  drop constraint if exists erp_dictionaries_kind_check;
alter table public.erp_dictionaries
  add constraint erp_dictionaries_kind_check
  check (kind in ('block_reason', 'problem_type', 'product_type', 'supplier', 'unit'));

insert into public.erp_dictionaries (kind, code, name, sort_order, active)
select 'unit', v.code, v.name, v.sort_order, true
  from (values
    ('кг',  'Килограммы', 10),
    ('м',   'Метры', 20),
    ('шт',  'Штуки', 30),
    ('уп',  'Упаковки', 40),
    ('рул', 'Рулоны', 50)
  ) as v(code, name, sort_order)
 where not exists (
   select 1 from public.erp_dictionaries d where d.kind = 'unit' and d.code = v.code
 );

-- Realtime НЕ публикуем: приходы обновляют карточку материала через rollup,
-- а `erp_materials` уже в публикации — экраны увидят новую сумму оттуда.
