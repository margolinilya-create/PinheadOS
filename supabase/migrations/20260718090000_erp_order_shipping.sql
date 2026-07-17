-- Отгрузка заказа: действие «Отгрузить» на стадии «Готов к отгрузке».
-- Дата отгрузки + кто отгрузил (uuid профиля; в dev-режиме null).
-- Только аддитивно. Смена status/shipped_status логируется существующим
-- триггером erp_orders_audit (erp_log_order_changes).
-- Применено к pinhead-os-v2 через MCP apply_migration 2026-07-17.

alter table public.erp_orders
  add column if not exists shipped_at timestamptz,
  add column if not exists shipped_by uuid;
