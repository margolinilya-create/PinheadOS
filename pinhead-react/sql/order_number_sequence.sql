-- Выполнить в Supabase SQL Editor
-- Решает race condition: два менеджера одновременно → уникальные номера

CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_order_number()
RETURNS TEXT AS $$
  SELECT 'PH-' || LPAD(nextval('order_number_seq')::TEXT, 4, '0');
$$ LANGUAGE sql;
