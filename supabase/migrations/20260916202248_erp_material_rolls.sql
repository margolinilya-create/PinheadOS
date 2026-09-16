-- РУЛОНЫ ПРИНЯТОЙ ПАРТИИ (правка заказчика 16.09, п. 5).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. «Для тканей, которые закупаются и принимаются
-- в килограммах, этого недостаточно для дальнейшей аналитики закроя:
-- дополнительно необходимо фиксировать фактическое количество принятых
-- рулонов… После сохранения приёмки ERP должна создать внутри принятой партии
-- соответствующее количество рулонов: „Рулон №1", „Рулон №2", „Рулон №3".
-- На этапе приёмки не требуется обязательная разбивка общего веса по каждому
-- рулону».
--
-- ПОЧЕМУ ТАБЛИЦА, А НЕ СЧЁТЧИК `rolls_count` У ПРИЁМКИ. Рулон — СУЩНОСТЬ,
-- на которую дальше ссылается закрой: с какого рулона кроили, сколько ткани
-- с него ушло и сколько изделий каждого размера получилось (п. 4 того же
-- документа). Сослаться на число «5 рулонов» нечем.
--
-- ЧИСЛО РУЛОНОВ ПРИ ЭТОМ НЕ ХРАНИТСЯ НИГДЕ: это `count(*)` по таблице.
-- Колонка рядом означала бы второго писателя того же числа — ровно та
-- ошибка, на которой проект уже ловился с `qty_received` (девять материалов
-- «принято» при пустом журнале приходов).
--
-- НУМЕРАЦИЯ СКВОЗНАЯ ВНУТРИ МАТЕРИАЛА, а не внутри прихода. Документ:
-- «первая поставка — 40 кг / 2 рулона; вторая поставка — 60 кг / 3 рулона.
-- Вторая приёмка не перезаписывает первую, а добавляет новые рулоны. Итог
-- по закупке: принято 100 кг / 5 рулонов». То есть вторая партия даёт
-- «Рулон №3…№5», а не второй «Рулон №1»: в цеху эти номера произносят вслух,
-- и два разных рулона с одним номером — это перепутанная ткань.
--
-- ВЕС РУЛОНА НЕОБЯЗАТЕЛЕН И ЭТО РЕШЕНИЕ ДОКУМЕНТА, а не упрощение: склад
-- принимает партию общим весом, и «вес партии ÷ N» был бы выдуманным числом
-- в колонке, по которой потом считают расход. NULL честнее.

create table if not exists public.erp_material_rolls (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.erp_materials(id) on delete cascade,
  -- Каким приходом рулон заведён: связь «закупка → партия → рулон»
  receipt_id uuid references public.erp_material_receipts(id) on delete set null,
  seq int not null,
  -- То, что цех произносит вслух: «Рулон №3»
  label text not null,
  qty numeric check (qty is null or qty > 0),
  unit text,
  /**
   * `in_stock` — принят складом, `in_use` — с него кроят, `used` — израсходован.
   * Статус ведёт ТОЛЬКО отчёт закроя (п. 4); здесь колонка заводится сразу,
   * чтобы не менять таблицу второй миграцией через неделю.
   */
  status text not null default 'in_stock'
    check (status in ('in_stock', 'in_use', 'used')),
  created_at timestamptz not null default now(),
  unique (material_id, seq)
);

create index if not exists erp_material_rolls_material_idx
  on public.erp_material_rolls (material_id) where status <> 'used';

comment on table public.erp_material_rolls is
  'Рулоны принятой партии материала: склад заводит их приёмкой, закрой по ним отчитывается';

alter table public.erp_material_rolls enable row level security;

/**
 * Политики НА КОМАНДУ. Читает участник производства — рулоны выбирает
 * закройщик, а не только склад. Пишет приёмка (`material.receive`), и это
 * зеркало политики `erp_material_receipts`: рулон появляется тем же
 * действием, что и приход.
 *
 * UPDATE пока не открыт никому: статус рулона начнёт писать отчёт закроя,
 * и право под него заводится ТОГДА ЖЕ, ЧЕМ ГЕЙТ В ИНТЕРФЕЙСЕ — одним
 * коммитом, как требует правило раздела. Открыть его заранее значило бы
 * оставить дыру «на будущее».
 */
create policy erp_material_rolls_read on public.erp_material_rolls
  for select to authenticated
  using (public.erp_is_member());

create policy erp_material_rolls_insert on public.erp_material_rolls
  for insert to authenticated
  with check (public.erp_has_permission('material.receive'));

-- ── Признак «единица учитывается рулонами» ─────────────────────────────────
/**
 * Свойство живёт у ЕДИНИЦЫ в справочнике, а не списком в коде.
 *
 * На бою в `erp_materials.unit` уже разнобой — «кг» и «Килограммы», код и имя
 * одного значения, — поэтому клиент сверяется со справочником по обоим
 * (`utils/materialUnit.ts`). Новая единица («бухта», «погонный метр»)
 * заводится в админке галочкой, а не правкой кода: то же правило, по которому
 * живут `gate_material_kinds` и `result_fields`.
 */
update public.erp_dictionaries
   set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('rolls', true)
 where kind = 'unit' and lower(btrim(code)) in ('кг', 'kg');

/** Серверное зеркало клиентского правила — для гейта внутри RPC */
create or replace function public.erp_unit_tracks_rolls(p_unit text)
returns boolean
language sql
stable
set search_path to 'public'
as $$
  select case
    when coalesce(btrim(p_unit), '') = '' then false
    when exists (
      select 1 from public.erp_dictionaries d
       where d.kind = 'unit'
         and (lower(btrim(d.code)) = lower(btrim(p_unit))
              or lower(btrim(d.name)) = lower(btrim(p_unit)))
    ) then exists (
      select 1 from public.erp_dictionaries d
       where d.kind = 'unit'
         and (lower(btrim(d.code)) = lower(btrim(p_unit))
              or lower(btrim(d.name)) = lower(btrim(p_unit)))
         and (d.meta->>'rolls') = 'true'
    )
    -- Единицы нет в справочнике: её набрали руками. Тот же короткий список
    -- синонимов, что у клиента, — и только он
    else lower(btrim(replace(p_unit, '.', '')))
         in ('кг', 'килограмм', 'килограммы', 'килограммов', 'kg')
  end;
$$;

comment on function public.erp_unit_tracks_rolls(text) is
  'Учитывается ли материал в этой единице рулонами — зеркало utils/materialUnit.ts';

revoke execute on function public.erp_unit_tracks_rolls(text) from public, anon;
grant execute on function public.erp_unit_tracks_rolls(text) to authenticated, service_role;
