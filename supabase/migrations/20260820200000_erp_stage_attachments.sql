-- Файлы подрядного этапа (документ 20.08, «Как настраивается подрядный этап»).
--
-- ЧТО ПРОСИТ ДОКУМЕНТ. Внутри этапа «Подряд» перечислены девять полей, и
-- последнее — «ТЗ / файлы». Их отдают подрядчику вместе с изделиями: схема
-- узла, раскладка нанесения, образец шва. Восемь полей заведены 20.08,
-- девятого не было вовсе.
--
-- ПОЧЕМУ НЕ ФАЙЛЫ ПОЗИЦИИ. Соблазн обойтись видом `tech` велик, но у файла
-- подрядного этапа другой адресат и другая судьба: он уезжает наружу вместе
-- с партией, и в одной позиции подрядных этапов бывает несколько — сублимация
-- полотна и варка готового. Свалить их в общую кучу значит отдать подрядчику
-- чужую схему, а это хуже, чем никакой.
--
-- ПОЧЕМУ НЕ `erp_tz_documents`. Там живут ТЗ, и по ним считается гейт цехов
-- (`utils/tz`): файл, приложенный к подрядному этапу, стал бы для гейта
-- техническим заданием и открыл бы цехам работу без ТЗ.

alter table public.erp_order_attachments
  add column if not exists stage_id uuid
    references public.erp_item_stages(id) on delete cascade;

create index if not exists erp_att_stage_idx
  on public.erp_order_attachments (stage_id)
  where stage_id is not null;

comment on column public.erp_order_attachments.stage_id is
  'Этап маршрута, к которому относится файл (вид `subcontract`): ТЗ и схемы, уезжающие подрядчику вместе с партией.';

alter table public.erp_order_attachments
  drop constraint if exists erp_order_attachments_kind_check;
alter table public.erp_order_attachments
  add constraint erp_order_attachments_kind_check
  check (kind in ('preview', 'attachment', 'packaging', 'tech', 'purchase',
                  'purchase_list', 'subcontract',
                  'dev_pattern', 'dev_passport', 'dev_photo'));

-- Снять файл этапа может тот, кто ведёт подряд: `order.manage` — то же право,
-- под которым правится сам маршрут. Общий DELETE вложений остаётся у админа.
drop policy if exists erp_att_delete_stage on public.erp_order_attachments;
create policy erp_att_delete_stage on public.erp_order_attachments
  for delete to authenticated
  using (
    stage_id is not null
    and kind = 'subcontract'
    and public.erp_has_permission('order.manage')
  );
