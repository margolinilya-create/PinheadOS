-- Security-разбор 10.08: отгрузка заказа не охранялась на сервере вовсе.
--
-- ЧТО НАШЛОСЬ. Политика UPDATE на `erp_orders` открыта любому участнику ERP
-- (`erp_is_member()`), а разбор по колонкам делает триггер `erp_order_guard` —
-- и в его списке НЕ БЫЛО ни `status`, ни `shipped_status`, ни `shipped_at`,
-- ни `shipped_by`. То есть рабочий цеха одним REST-запросом выставлял заказу
-- `status = 'done_on_time'`, `shipped_status = 'shipped'` — заказ закрывался
-- и уходил в архив, хотя ни один этап мог быть не закрыт.
--
-- ЧЕМ ЭТО ХУЖЕ ОБЫЧНОЙ ДЫРЫ. Проверка готовности `isOrderReadyToShip` живёт
-- ТОЛЬКО в клиенте. Вместе с ней обходилась и вся машинерия аварийного снятия,
-- построенная в этот же день: снятие гейта отгрузки требует `bypass.manage`,
-- обязательной причины и оставляет запись в `erp_bypasses` с автором и датой.
-- Прямой запрос не требовал ничего и следа не оставлял — то есть существовал
-- бесшумный путь ровно вокруг того механизма, который для этого и заводили.
--
-- ПОЧЕМУ ДВА ПРАВА. Отгрузку делает кладовщик с карточки упаковки
-- (`warehouse.manage`), а закрыть заказ может менеджер из списка заказов
-- (`order.manage`). Интерфейс показывает действие им обоим — страж повторяет
-- ровно это, не строже и не мягче.
--
-- КЛИЕНТ ПРАВИТСЯ ТЕМ ЖЕ КОММИТОМ: кнопка «Отгрузить» в списке заказов
-- показывалась по одной лишь ГОТОВНОСТИ заказа, без права. Признак «готов
-- к отгрузке» остался виден всем — цеху полезно знать, что заказ дособран, —
-- а кнопка ушла под право.
--
-- Тело функции взято ДОСЛОВНО из действующей версии, добавлен только блок
-- отгрузки: правило проекта про подлинный текст уже спасало сегодня стража
-- этапов от потери шести охраняемых колонок.

create or replace function public.erp_order_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fields boolean;
  v_ship boolean;
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.is_demo is distinct from old.is_demo and not public.is_admin() then
    raise exception 'erp_order_guard: пометка «тестовый» доступна только администратору'
      using errcode = '42501';
  end if;

  v_fields :=
       new.bitrix_id       is distinct from old.bitrix_id
    or new.title           is distinct from old.title
    or new.customer        is distinct from old.customer
    or new.manager         is distinct from old.manager
    or new.launch_date     is distinct from old.launch_date
    or new.due_date        is distinct from old.due_date
    or new.buffer_days     is distinct from old.buffer_days
    or new.priority        is distinct from old.priority
    or new.notes           is distinct from old.notes
    or new.packaging       is distinct from old.packaging
    or new.packaging_note  is distinct from old.packaging_note
    or new.stickers        is distinct from old.stickers
    or new.stickers_note   is distinct from old.stickers_note
    or new.no_chestny_znak is distinct from old.no_chestny_znak
    or new.tz_required     is distinct from old.tz_required
    or new.created_by      is distinct from old.created_by;

  if v_fields and not public.erp_has_permission('order.manage') then
    raise exception 'erp_order_guard: правка полей заказа требует права order.manage'
      using errcode = '42501';
  end if;

  -- ── Отгрузка и закрытие заказа ──
  -- Колонки ниже не охранялись вовсе; см. заголовок миграции.
  v_ship :=
       new.status          is distinct from old.status
    or new.shipped_status  is distinct from old.shipped_status
    or new.shipped_at      is distinct from old.shipped_at
    or new.shipped_by      is distinct from old.shipped_by;

  if v_ship
     and not (public.erp_has_permission('warehouse.manage')
              or public.erp_has_permission('order.manage')) then
    raise exception 'erp_order_guard: отгрузка и закрытие заказа требуют права warehouse.manage или order.manage'
      using errcode = '42501';
  end if;

  return new;
end $$;

comment on function public.erp_order_guard() is
  'Разбирает изменение заказа по колонкам: поля заказа — под order.manage, пометка «тестовый» — только админ, отгрузка и закрытие (status/shipped_*) — под warehouse.manage либо order.manage. До 10.08 колонки отгрузки не охранялись вовсе: любой участник закрывал заказ через REST в обход проверки готовности и аварийного снятия.';
