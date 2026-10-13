-- Добавляем ERP-таблицы в publication supabase_realtime, чтобы точечные подписки
-- realtimeSlice (erp_orders/materials/procurement/subcontracting/warehouse_ops/experimental)
-- действительно получали postgres_changes. Ранее вещали только erp_item_stages/erp_order_comments —
-- код подписывался, но БД не транслировала события (латентный момент прошлых волн).

alter publication supabase_realtime add table
  public.erp_orders,
  public.erp_order_items,
  public.erp_materials,
  public.erp_procurement_tasks,
  public.erp_subcontracting,
  public.erp_warehouse_ops,
  public.erp_experimental,
  public.erp_experimental_ops;
