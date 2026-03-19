-- ═══════════════════════════════════════════
-- PINHEAD ORDER STUDIO — App Config Table
-- Run this in Supabase SQL Editor
-- ═══════════════════════════════════════════

-- Generic key-value config table for prices, catalog order, etc.
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE app_config ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read configs
CREATE POLICY "config_select" ON app_config FOR SELECT
USING (auth.uid() IS NOT NULL);

-- Only admin/director can insert/update/delete configs
CREATE POLICY "config_modify" ON app_config FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid()
    AND role IN ('admin', 'director')
  )
);
