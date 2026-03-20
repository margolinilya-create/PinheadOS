-- =============================================
-- Аудит-лог статусов заказов
-- Выполнить в Supabase Dashboard → SQL Editor
-- =============================================

-- 1. Создать таблицу аудита
CREATE TABLE order_audit (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
  changed_by UUID REFERENCES auth.users(id),
  changed_at TIMESTAMPTZ DEFAULT now(),
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT
);

-- 2. RLS на таблицу аудита
ALTER TABLE order_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_read_admins" ON order_audit
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'director', 'rop')
  )
);

-- 3. Функция триггера
CREATE OR REPLACE FUNCTION log_order_changes()
RETURNS TRIGGER AS $$
BEGIN
  -- Лог смены статуса
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO order_audit (order_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'status', OLD.status, NEW.status);
  END IF;

  -- Лог смены суммы
  IF OLD.total_sum IS DISTINCT FROM NEW.total_sum THEN
    INSERT INTO order_audit (order_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'total_sum',
      OLD.total_sum::TEXT, NEW.total_sum::TEXT);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Триггер на таблицу orders
CREATE TRIGGER orders_audit_trigger
AFTER UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION log_order_changes();

-- 5. Проверить
-- SELECT trigger_name FROM information_schema.triggers
-- WHERE event_object_table = 'orders';
-- Должен вернуть: orders_audit_trigger
