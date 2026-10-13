-- Страж заказа переходит с перечисления ОХРАНЯЕМЫХ колонок на перечисление
-- ИСКЛЮЧЕНИЙ (код-ревью 23.09, находка 1).
--
-- ЧТО БЫЛО НЕ ТАК. `erp_order_guard` перечислял охраняемые колонки поимённо:
-- восемнадцать под `order.manage` и четыре отгрузочных под `warehouse.manage`.
-- Сверка перечня со схемой `erp_orders` показала четыре колонки, которых
-- в нём нет вовсе:
--
--   purchase_required · delivered_at · tz_order_id · tz_number
--
-- Единственным гейтом для них оставалась политика `erp_orders_update`,
-- а она стоит на `erp_is_member()` — на любом активном и одобренном
-- сотруднике. То есть рабочий цеха мог через REST переписать у ЛЮБОГО заказа
-- отметку о сдаче и признак «закупка не требуется», минуя `order.manage`.
-- Поля живые: `purchase_required` читается в `orderWriteSlice` как
-- `needsPurchase` и через `utils/routes` вырезает из маршрута этап закупки,
-- `delivered_at` подписан «Сдан» в истории заказа.
--
-- ЭТО ТОТ САМЫЙ СЛУЧАЙ, О КОТОРОМ ПРЕДУПРЕЖДАЛА МИГРАЦИЯ 12.09.
-- `20260912135420_erp_drop_is_demo` писала дословно: «поимённый список
-- `v_fields` и ветка отгрузки обязаны остаться дословно, иначе колонка,
-- выпавшая из перечисления, перестанет охраняться вообще ничем». Предупреждение
-- было верным, но защищало только от правки САМОГО списка — а колонки
-- добавлялись в таблицу отдельными миграциями, и список за ними не шёл.
-- Поэтому чинится не список, а ПРИНЦИП: перечисление исключений делает новую
-- колонку защищённой по умолчанию, и следующая правка схемы не открывает дыру
-- молча.
--
-- ПОЧЕМУ ЭТО НЕ ЛОМАЕТ ЦЕХ. Правило проекта требует ставить страж и клиентский
-- гейт одним коммитом, чтобы не вышло «кнопка есть, действие падает». Здесь
-- клиентская часть не нужна, и это проверено: интерфейс эти четыре колонки
-- НЕ ПИШЕТ вовсе — `purchase_required` только читается при построении
-- маршрута, `delivered_at` только отображается, `tz_*` в ERP не используются
-- (их заполнит будущий мост ТЗ→ERP, и он пойдёт под `order.manage`).
--
-- Автоматика отгрузки тоже не задета: `erp_order_shipments_rollup` пишет
-- `shipped_status`, а это колонка ветки отгрузки, разрешённой
-- `warehouse.manage`, — ровно как и раньше.
--
-- ЧТО ТЕПЕРЬ ОХРАНЯЕТСЯ СТРОЖЕ, ЧЕМ БЫЛО: `id`, `order_number`, `created_at`.
-- Они не были ни в одном из двух списков, то есть не охранялись ничем.
-- Менять их не должен никто, и теперь для этого нужен `order.manage`.
--
-- `updated_at` из сравнения исключён: его проставляет соседний триггер
-- `erp_orders_touch`, и присланное клиентом значение не должно считаться
-- содержательной правкой.

create or replace function public.erp_order_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ship boolean;
  v_rest boolean;
begin
  -- Пустой `auth.uid()` — это service_role: он и так минует RLS, и запирать
  -- починку через SQL нельзя (правило проекта)
  if (select auth.uid()) is null then
    return new;
  end if;

  -- ── Отгрузка и закрытие заказа ──
  -- Единственная ветка, которую ведёт не менеджер: склад отгружает и закрывает
  v_ship :=
       new.status          is distinct from old.status
    or new.shipped_status  is distinct from old.shipped_status
    or new.shipped_at      is distinct from old.shipped_at
    or new.shipped_by      is distinct from old.shipped_by;

  /**
   * ВСЁ ОСТАЛЬНОЕ — одним сравнением, без перечисления колонок.
   *
   * `to_jsonb(new) - 'колонка'` убирает из снимка строки поля отгрузки
   * и служебное `updated_at`; если после этого снимки различаются, значит
   * изменилось что-то, чего в ветке отгрузки нет, — и это правка заказа.
   *
   * Тот же приём уже работает в `erp_order_item_guard`, где узкая ветка
   * стоимости сборки сравнивает `to_jsonb(new)` минус свои четыре поля.
   */
  v_rest := (to_jsonb(new) - 'status' - 'shipped_status' - 'shipped_at'
              - 'shipped_by' - 'updated_at')
        is distinct from
            (to_jsonb(old) - 'status' - 'shipped_status' - 'shipped_at'
              - 'shipped_by' - 'updated_at');

  if v_rest and not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_guard: правка полей заказа требует права order.manage'
      using errcode = '42501';
  end if;

  if v_ship
     and not (public.erp_has_permission('warehouse.manage')
              or public.erp_has_permission('order.manage')) then
    raise exception 'erp_order_guard: отгрузка и закрытие заказа требуют права warehouse.manage или order.manage'
      using errcode = '42501';
  end if;

  return new;
end $function$;
