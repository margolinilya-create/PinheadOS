-- РАЗРАБОТКА БЕЗ СДЕЛКИ (правка 14.09, расхождение №4 — было отложено).
--
-- Документ просил, чтобы разработку можно было вести «без сделки», а потом
-- привязать к заказу, и чтобы её переписка после привязки была видна из чата
-- сделки БЕЗ копирования сообщений. Вторая половина сделана ещё в PR 2 —
-- сообщение принадлежит ТРЕДУ, а тред анкерится на разработку, — и
-- `erp_chat_page` уже собирает треды заказа ОБЪЕДИНЕНИЕМ с тредами его
-- разработок. То есть привязка одной колонкой делает переписку видимой
-- по построению, и копировать нечего.
--
-- ЖИВАЯ БАЗА ПОКАЗАЛА ТРИ ВЕЩИ, И ДВЕ ИЗ НИХ СОКРАТИЛИ РАБОТУ:
--
--   1. Политики `erp_experimental` не ссылаются на `order_id` ВОВСЕ
--      (`erp_is_member()` на чтение, право на запись) — видимость разработки
--      от заказа не зависит, и снятие NOT NULL ничего не открывает.
--   2. Оба серверных потребителя уже написаны с оглядкой на отсутствие
--      заказа: `erp_dev_handoff_to_warehouse` при пустом `order_id` просто
--      выходит (складская задача приёмки ГП без заказа бессмысленна),
--      а `erp_experimental_task_send` отвечает внятным «у разработки
--      не указана позиция заказа» вместо падения по внешнему ключу.
--   3. А вот `erp_order_attachments.order_id` — NOT NULL, и это НАСТОЯЩЕЕ
--      препятствие: разработка без сделки не смогла бы держать собственный
--      техпакет. Лекала, техпаспорт и фото образца — ровно то, ради чего
--      разработка и ведётся, и автопубликация карточки модели копирует
--      в неё именно их.

-- ── 1. Сама разработка ────────────────────────────────────────────────────
alter table public.erp_experimental alter column order_id drop not null;

comment on column public.erp_experimental.order_id is
  'Сделка, к которой относится разработка. NULL — разработка «на полку»: её ведут без заказа и привязывают позже через erp_experimental_attach_order.';

-- ── 2. Файлы разработки ───────────────────────────────────────────────────
alter table public.erp_order_attachments alter column order_id drop not null;

/**
 * ВЛОЖЕНИЕ ОБЯЗАНО ПРИНАДЛЕЖАТЬ ХОТЬ ЧЕМУ-ТО. Снять NOT NULL и не поставить
 * это условие значило бы разрешить строку без единого якоря — файл, который
 * не покажет ни один экран и который уборка `storage-gc` посчитает ЖИВЫМ
 * (ключ-то в строке есть). То есть платный объект, невидимый и неудаляемый:
 * худший из возможных исходов.
 *
 * Существующие строки проверку проходят: `order_id` есть у всех 53.
 */
alter table public.erp_order_attachments
  add constraint erp_order_attachments_anchor_check
  check (order_id is not null or experimental_id is not null);

-- ── 3. Привязка к сделке ──────────────────────────────────────────────────
/**
 * ПРИВЯЗКА — ОТДЕЛЬНОЕ ДЕЙСТВИЕ СО СВОИМ ПРАВОМ, а не правка колонки через
 * общую UPDATE-политику. Она меняет то, к какой сделке относится работа:
 * после неё разработка попадает в гейт отгрузки заказа
 * (`erp_order_has_open_dev`), её переписка становится видна из чата сделки,
 * а завершение заводит складскую задачу приёмки ГП. Такое решение обязано
 * называться действием.
 *
 * ПОВТОРНАЯ ПРИВЯЗКА ЗАПРЕЩЕНА. Перенос разработки из одной сделки в другую —
 * другой вопрос: у неё уже могут быть этапы цехов, задача склада и переписка,
 * и «просто сменить order_id» оставило бы их у прежнего заказа. Пока такого
 * требования нет, честнее отказать, чем сделать половину.
 *
 * ФАЙЛЫ НЕ ПЕРЕПРИВЯЗЫВАЮТСЯ, и это записанное правило проекта: «файлы
 * финального пакета принадлежат РАЗРАБОТКЕ, а не позиции — лекала и техпаспорт
 * описывают модель, а не тот заказ, из которого она вышла». Они и дальше
 * видны в карточке разработки (эмбед по `experimental_id`), а в списке файлов
 * сделки им делать нечего.
 */
create or replace function public.erp_experimental_attach_order(
  p_dev uuid,
  p_order uuid,
  p_item uuid default null
)
returns public.erp_experimental
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_dev public.erp_experimental;
begin
  if not public.erp_has_permission('experimental.manage') then
    raise exception 'erp_experimental_attach_order: привязка разработки к сделке требует права experimental.manage'
      using errcode = '42501';
  end if;

  select * into v_dev from public.erp_experimental where id = p_dev;
  if v_dev.id is null then
    raise exception 'erp_experimental_attach_order: разработка не найдена'
      using errcode = 'P0002';
  end if;
  if v_dev.order_id is not null then
    raise exception 'erp_experimental_attach_order: разработка уже привязана к сделке'
      using errcode = '23505';
  end if;
  if p_order is null then
    raise exception 'erp_experimental_attach_order: сделка обязательна'
      using errcode = '22023';
  end if;

  /**
   * ПОЗИЦИЯ ПРОВЕРЯЕТСЯ НА ПРИНАДЛЕЖНОСТЬ СДЕЛКЕ. Без этого разработку можно
   * привязать к заказу A, указав позицию заказа B, — и `erp_experimental_task_send`
   * завёл бы этап в чужом заказе. Тот же довод, по которому `erp_chat_send`
   * проверяет, что контекст принадлежит своему заказу.
   */
  if p_item is not null and not exists (
    select 1 from public.erp_order_items i
     where i.id = p_item and i.order_id = p_order
  ) then
    raise exception 'erp_experimental_attach_order: позиция не принадлежит этой сделке'
      using errcode = '22023';
  end if;

  update public.erp_experimental
     set order_id = p_order,
         item_id = coalesce(p_item, item_id),
         updated_at = now()
   where id = p_dev
   returning * into v_dev;

  return v_dev;
end $$;

comment on function public.erp_experimental_attach_order(uuid, uuid, uuid) is
  'Привязать разработку «с полки» к сделке. Повторная привязка запрещена: перенос между сделками оставил бы этапы и задачи у прежнего заказа. Файлы не трогаются — они принадлежат разработке.';

revoke execute on function public.erp_experimental_attach_order(uuid, uuid, uuid) from public, anon;
grant execute on function public.erp_experimental_attach_order(uuid, uuid, uuid) to authenticated;
