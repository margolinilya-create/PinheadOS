-- Правки ПМ (волна 3), правка 8: обработка просроченных этапов. Красная рамка — факт
-- просрочки; отдельно фиксируем реакцию: комментарий причины задержки + время подтверждения.

alter table public.erp_item_stages
  add column overdue_comment text,
  add column overdue_ack_at timestamptz;
