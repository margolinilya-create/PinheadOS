-- =============================================
-- redesign/v2 — Seed sections + create/seed operation_types
-- Migration: 20260502_seed_sections_and_ops.sql
-- Branch: redesign/v2
-- ADRs: 0001 (bounded contexts), 0002 (rate/minutes snapshot),
--       0005 (soft-delete convention)
--
-- Depends on: 20260501_production_foundation.sql (sections table,
--             auth_is_* predicates, tenant_single check pattern).
--
-- 1. Seeds 7 production sections (idempotent via ON CONFLICT)
-- 2. Creates operation_types table — the catalog of work units the
--    technologist assigns to tech cards. base_rate/base_minutes are
--    SNAPSHOTTED into order_tech_operations at approve-time (ADR-0002),
--    so edits here affect only NEW tech cards.
-- 3. Seeds ~28 base operations across all 7 sections so Tech Card Builder
--    (W3) has a working catalog on day one.
--
-- HOW TO APPLY: same as 20260501 — Dashboard SQL editor or supabase db push.
-- =============================================

-- ============ 1. Seed sections ============
-- Idempotent: ON CONFLICT (code) DO NOTHING so re-running is safe.
-- Sort order reflects the typical production flow (cut → print → sew → qc → pack).

INSERT INTO sections (code, name, icon, color, sort_order) VALUES
  ('cutting',    'Раскрой',     'scissors', '#64748b', 10),
  ('screenprint','Шелкография', 'printer',  '#0ea5e9', 20),
  ('embroidery', 'Вышивка',     'needle',   '#8b5cf6', 30),
  ('dtf',        'DTF',         'spray',    '#f59e0b', 40),
  ('sewing',     'Пошив',       'thread',   '#10b981', 50),
  ('qc',         'ОТК',         'check',    '#ef4444', 60),
  ('packing',    'Упаковка',    'box',      '#78716c', 70)
ON CONFLICT (code) DO NOTHING;

-- ============ 2. operation_types ============
-- The technologist's catalog of named work units. Rate is per unit
-- (piece / meter / minute — see unit column). A sewing op "sew_tshirt"
-- has unit='piece' and base_rate=120 means 120₽ per stitched tshirt.
--
-- This is a MUTABLE catalog (admin can edit rates over time). But
-- ADR-0002: once an op is assigned to an order_tech_operation via tech
-- card approval, the rate/minutes are frozen in the snapshot columns
-- of that row. Rate edits here affect only NEW assignments.

CREATE TABLE IF NOT EXISTS operation_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000001'::uuid,
  section_id uuid NOT NULL REFERENCES sections(id),
  code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  base_rate numeric(10, 2) NOT NULL DEFAULT 0,
  base_minutes int NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operation_types_code_uniq UNIQUE (code),
  CONSTRAINT operation_types_tenant_single CHECK (tenant_id = '00000000-0000-0000-0000-000000000001'::uuid),
  CONSTRAINT operation_types_unit_check CHECK (unit IN ('piece', 'meter', 'minute')),
  CONSTRAINT operation_types_rate_nonneg CHECK (base_rate >= 0),
  CONSTRAINT operation_types_minutes_nonneg CHECK (base_minutes >= 0)
);

COMMENT ON TABLE operation_types IS
  'Catalog of work units assignable via Tech Card Builder. Rate/minutes SNAPSHOTTED into order_tech_operations at approve-time. ADR-0002.';

COMMENT ON COLUMN operation_types.base_rate IS
  '₽ per unit at current time. Snapshot into order_tech_operations.rate on tech card approve. Edits here do not retroactively change existing orders.';

COMMENT ON COLUMN operation_types.base_minutes IS
  'Normative minutes per unit. Used for scheduling capacity math. Snapshotted alongside rate.';

CREATE INDEX IF NOT EXISTS operation_types_section_sort_idx
  ON operation_types (section_id, sort_order)
  WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE operation_types ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated user. Production staff need to see the catalog
-- (foreman viewing tasks, technologist building cards, payroll auditing).
CREATE POLICY operation_types_read_authenticated ON operation_types
  FOR SELECT
  USING (auth.uid() IS NOT NULL AND deleted_at IS NULL);

-- Write: admin, director, or technologist (sub_role). Technologist owns
-- the catalog day-to-day; admin/director for rate changes.
CREATE POLICY operation_types_write_admin_tech ON operation_types
  FOR ALL
  USING (auth_is_admin_or_director() OR auth_is_technologist())
  WITH CHECK (auth_is_admin_or_director() OR auth_is_technologist());

-- ============ 3. Seed operation_types ============
-- ~28 base ops across 7 sections. Rates are PLACEHOLDERS — admin must
-- adjust them in prod before parallel-run against Excel (ADR-0007).
-- unit='piece' for most; 'meter' for cutting fabric rolls; 'minute' for
-- setup/support ops where piece-rate doesn't fit.
--
-- Lookup sections by code so we don't hardcode uuids.

INSERT INTO operation_types (section_id, code, name, unit, base_rate, base_minutes, sort_order)
SELECT s.id, op.code, op.name, op.unit, op.base_rate, op.base_minutes, op.sort_order
FROM (VALUES
  -- Раскрой (cutting)
  ('cutting',     'cut_auto',          'Автоматический раскрой',    'meter',  15.00,  1, 10),
  ('cutting',     'cut_manual',        'Ручной раскрой',            'piece',  25.00,  3, 20),
  ('cutting',     'cut_layout',        'Раскладка лекал',           'minute',  8.00,  1, 30),

  -- Шелкография (screenprint)
  ('screenprint', 'sp_prepare_frame',  'Подготовка формы',          'piece', 300.00, 30, 10),
  ('screenprint', 'sp_mix_ink',        'Замес краски',              'piece', 150.00, 10, 20),
  ('screenprint', 'sp_print_1color',   'Печать 1 цвет',             'piece',  45.00,  1, 30),
  ('screenprint', 'sp_print_2color',   'Печать 2 цвета',            'piece',  85.00,  2, 40),
  ('screenprint', 'sp_print_multi',    'Печать 3+ цветов',          'piece', 140.00,  3, 50),
  ('screenprint', 'sp_cure',           'Сушка/полимеризация',       'piece',  10.00,  1, 60),

  -- Вышивка (embroidery)
  ('embroidery',  'emb_digitize',      'Оцифровка дизайна',         'piece', 800.00, 40, 10),
  ('embroidery',  'emb_hoop',          'Закрепление в пяльцы',      'piece',  20.00,  2, 20),
  ('embroidery',  'emb_stitch_small',  'Вышивка (до 5k стежков)',   'piece',  80.00,  5, 30),
  ('embroidery',  'emb_stitch_large',  'Вышивка (5k+ стежков)',     'piece', 160.00, 12, 40),

  -- DTF
  ('dtf',         'dtf_print',         'Печать DTF плёнки',         'meter', 180.00,  1, 10),
  ('dtf',         'dtf_powder',        'Нанесение порошка',         'piece',  12.00,  1, 20),
  ('dtf',         'dtf_press',         'Термоперенос',              'piece',  35.00,  1, 30),

  -- Пошив (sewing)
  ('sewing',      'sew_tshirt',        'Пошив футболки',            'piece', 120.00,  8, 10),
  ('sewing',      'sew_hoodie',        'Пошив худи',                'piece', 280.00, 18, 20),
  ('sewing',      'sew_pants',         'Пошив брюк',                'piece', 220.00, 15, 30),
  ('sewing',      'sew_shorts',        'Пошив шорт',                'piece', 150.00, 10, 40),
  ('sewing',      'sew_label',         'Пришивание этикетки',       'piece',   8.00,  1, 50),
  ('sewing',      'sew_overlock',      'Оверлок',                   'piece',  25.00,  2, 60),
  ('sewing',      'sew_topstitch',     'Отстрочка',                 'piece',  30.00,  2, 70),

  -- ОТК (qc)
  ('qc',          'qc_visual',         'Визуальный контроль',       'piece',  10.00,  1, 10),
  ('qc',          'qc_measure',        'Контроль размеров',         'piece',  15.00,  2, 20),
  ('qc',          'qc_final',          'Финальная приёмка',         'piece',  20.00,  2, 30),

  -- Упаковка (packing)
  ('packing',     'pack_fold',         'Складывание',               'piece',   5.00,  1, 10),
  ('packing',     'pack_polybag',      'Упаковка в пакет',          'piece',   7.00,  1, 20),
  ('packing',     'pack_carton',       'Комплектация в коробку',    'piece',  12.00,  2, 30),
  ('packing',     'pack_label',        'Маркировка',                'piece',   8.00,  1, 40)
) AS op(section_code, code, name, unit, base_rate, base_minutes, sort_order)
JOIN sections s ON s.code = op.section_code
ON CONFLICT (code) DO NOTHING;

-- ============ 4. Verification (manual) ============
--
-- SELECT s.code AS section, count(*) AS ops
-- FROM operation_types ot JOIN sections s ON s.id = ot.section_id
-- WHERE ot.deleted_at IS NULL
-- GROUP BY s.code ORDER BY s.code;
-- -- Expected: cutting=3, dtf=3, embroidery=4, packing=4, qc=3, screenprint=6, sewing=7
--
-- SELECT code, name, base_rate, unit FROM operation_types
-- WHERE deleted_at IS NULL ORDER BY section_id, sort_order;
-- -- Expected: 30 rows
