-- ═══════════════════════════════════════════
-- MIGRATION: Hide prices from manager role
-- Run in Supabase Dashboard → SQL Editor
-- ═══════════════════════════════════════════

-- 1. Drop old read policy (allows all authenticated to read everything)
DROP POLICY IF EXISTS "catalog_read_all" ON catalog_config;

-- 2. New policy: prices row visible only to admin/director/rop;
--    all other keys readable by any authenticated user
CREATE POLICY "catalog_read_with_price_guard" ON catalog_config
FOR SELECT USING (
  CASE
    WHEN key = 'prices' THEN
      EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid()
        AND role IN ('admin', 'director', 'rop')
      )
    ELSE
      auth.role() = 'authenticated'
  END
);

-- 3. Verify: should see catalog_read_with_price_guard + catalog_write_admins
SELECT policyname FROM pg_policies
WHERE tablename = 'catalog_config';
