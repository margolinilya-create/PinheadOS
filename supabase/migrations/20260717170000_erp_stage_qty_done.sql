-- Частичная готовность этапа: накопительный qty_done («300/500»).
-- Колонка есть в phase1-схеме; ADD COLUMN IF NOT EXISTS — идемпотентно и недеструктивно.
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-17.

alter table public.erp_item_stages
  add column if not exists qty_done int not null default 0;
