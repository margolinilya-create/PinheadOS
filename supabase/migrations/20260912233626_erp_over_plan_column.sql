-- «ПЛЮСЫ» ПОЯВЛЯЮТСЯ ТОЛЬКО НА ЗАКРОЕ
-- (правка заказчика 12.09, вторая порция, п. 4).
--
-- Документ: «дополнительное количество сверх тиража („плюсы") формируется
-- только на этапе закроя. Именно фактическое количество, переданное закроем,
-- задаёт максимальный объём, который может дальше двигаться по
-- производственным этапам… Если заказ 100 шт и закрой сдал 100 шт,
-- на вышивке, шелкографии, швейке, ВТО и других последующих этапах нельзя
-- указать 101 и более».
--
-- ЧТО БЫЛО. Правка 12.09 (первая порция, п. 5) сняла потолок факта ЦЕЛИКОМ
-- и ВЕЗДЕ: и из `erp_clamp_done`, и из этого триггера. Требование было
-- «не ограничивать фактический результат количеством заказа», и исполнено
-- оно было буквально — на всех участках сразу. На боевой базе 12.09 уже есть
-- этап ВЫШИВКИ с qty_done = 105 при тираже 100.
--
-- ПРАВО НА ПРЕВЫШЕНИЕ — СВОЙСТВО УЧАСТКА В ДАННЫХ, а не константа
-- `code = 'cutting'` в коде: рядом уже живут `gate_material_kinds`
-- и `result_fields`, и правило проекта прямо запрещает держать в коде
-- константы вида «ткань → закрой».
--
-- ПОЧЕМУ ИСКЛЮЧЕНИЕ, А НЕ ОБРЕЗКА. Молчаливый clamp — ровно тот дефект,
-- который 12.09 записан в CLAUDE.md: «сервер возвращает 100 там, где цех
-- сдал 105, а вызывающий видит „сохранилось" и не понимает, почему число
-- не то». Отказ называет причину, и клиент до него не доводит: форма отчёта
-- проверяет то же правило (`utils/stageOverPlan`) и объясняет его человеку
-- ДО отправки.
--
-- ПОЧЕМУ ЗДЕСЬ, А НЕ В `erp_clamp_done`. Этот триггер — ПОСЛЕДНЕЕ слово для
-- любой записи `qty_done`, включая прямой UPDATE клиента мимо RPC; правку
-- одного `erp_clamp_done` можно было бы обойти через REST. Тот же урок
-- 12.09: «одну и ту же величину могут резать ДВА места».

alter table public.erp_departments
  add column if not exists allows_over_plan boolean not null default false;

comment on column public.erp_departments.allows_over_plan is
  'Участку разрешено сдавать БОЛЬШЕ, чем пришло на вход: «плюсы» к тиражу (правка 12.09, п. 4). Включён у закроя; у остальных факт не может превысить переданное предыдущим этапом. Правится в админке.';

update public.erp_departments set allows_over_plan = true where code = 'cutting';

-- ── Потолок этапа ─────────────────────────────────────────────────────────
-- Зеркало клиентского `stageInputQty`: вход этапа — МИНИМУМ по
-- предшественникам (параллельные ветки нанесения обрабатывают одни и те же
-- единицы, и сумма дала бы 200 при тираже 100), у закрытого предшественника
-- факт не ниже тиража (`stageFactQty`), без предшественников — тираж позиции.
create or replace function public.erp_stage_input_qty(p_stage_id uuid)
returns int
language sql stable security definer set search_path to 'public' as $$
  with me as (
    select s.depends_on, greatest(coalesce(i.qty, 0), 0) as total
      from erp_item_stages s
      join erp_order_items i on i.id = s.item_id
     where s.id = p_stage_id
  )
  -- Предшественников нет — join не даёт строк, `min` пуст, и `coalesce`
  -- отдаёт тираж позиции. Отдельной ветки на этот случай не нужно.
  select coalesce(
    (select min(case
                  when p.status in ('done', 'skipped')
                    then greatest(coalesce(p.qty_done, 0), me.total)
                  else greatest(coalesce(p.qty_done, 0), 0)
                end)
       from me
       join erp_item_stages p on p.id = any (me.depends_on)),
    (select total from me))
$$;

comment on function public.erp_stage_input_qty(uuid) is
  'Сколько единиц пришло на вход этапа: минимум по предшественникам, у закрытого факт не ниже тиража, без предшественников — тираж позиции. Зеркало клиентского utils/stageInput.stageInputQty; расхождение половин сторожит stageOverPlan.test.ts.';

revoke execute on function public.erp_stage_input_qty(uuid) from public, anon;
grant execute on function public.erp_stage_input_qty(uuid) to authenticated;
