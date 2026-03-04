-- ═══════════════════════════════════════════
-- PINHEAD ORDER STUDIO — RLS Policies
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════

-- 1. Add role column to profiles if not exists
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'manager';
-- Roles: manager, rop, production, designer, director, admin

-- 2. Enable RLS on orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 3. Add created_by column if not exists
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS bitrix_deal TEXT;

-- 4. Manager sees own orders only
CREATE POLICY "manager_select_own" ON orders FOR SELECT
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'director', 'rop')
  )
);

-- 5. Production sees only approved/production
CREATE POLICY "production_select" ON orders FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role = 'production'
  )
  AND status IN ('approved', 'production')
);

-- 6. Insert — any authenticated user
CREATE POLICY "insert_orders" ON orders FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL);

-- 7. Update — own orders or admin/rop
CREATE POLICY "update_orders" ON orders FOR UPDATE
USING (
  created_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'director', 'rop')
  )
);

-- 8. Delete — admin only
CREATE POLICY "delete_orders" ON orders FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'director')
  )
);
