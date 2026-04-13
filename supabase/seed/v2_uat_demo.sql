-- redesign/v2 — demo seed for UAT
-- Idempotent: re-running deletes existing demo rows by tag and re-inserts.
-- Tag: data->>'_demo_seed' = 'v2-uat-1'

-- ============ Clean previous demo (if any) ============
DELETE FROM piecework_entries WHERE worker_id IN (
  SELECT id FROM workers WHERE full_name LIKE '[demo] %'
);
DELETE FROM piecework_batches WHERE notes LIKE '[demo] %';
DELETE FROM order_tech_operations WHERE order_id IN (
  SELECT id FROM orders WHERE data->>'_demo_seed' = 'v2-uat-1'
);
DELETE FROM order_tech_cards WHERE order_id IN (
  SELECT id FROM orders WHERE data->>'_demo_seed' = 'v2-uat-1'
);
DELETE FROM workers WHERE full_name LIKE '[demo] %';
DELETE FROM orders WHERE data->>'_demo_seed' = 'v2-uat-1';
DELETE FROM profiles WHERE name = '[demo] Технолог';

-- ============ Demo profile (referenced by approved_by) ============
INSERT INTO profiles (id, name, role, email, approved)
VALUES ('11111111-1111-1111-1111-111111111111', '[demo] Технолог', 'admin', 'demo@pinhead.local', true);

-- ============ Workers (5 across sections) ============
WITH section_ids AS (
  SELECT id, code FROM sections
)
INSERT INTO workers (full_name, section_id, hourly_rate)
SELECT name, (SELECT id FROM section_ids WHERE code = sec), rate
FROM (VALUES
  ('[demo] Иванова Анна',     'sewing',      350),
  ('[demo] Петров Сергей',    'cutting',     300),
  ('[demo] Сидорова Мария',   'screenprint', 320),
  ('[demo] Кузнецов Дмитрий', 'embroidery',  340),
  ('[demo] Орлова Елена',     'qc',          280)
) AS t(name, sec, rate);

-- ============ Orders (3) ============
INSERT INTO orders (status, data, total_qty, total_sum, notes)
VALUES
  ('production', '{"_demo_seed":"v2-uat-1","items":["футболка classic"]}'::jsonb, 50, 75000, '[demo] Заказ 1'),
  ('approved',   '{"_demo_seed":"v2-uat-1","items":["худи"]}'::jsonb,             30, 96000, '[demo] Заказ 2'),
  ('review',     '{"_demo_seed":"v2-uat-1","items":["шорты"]}'::jsonb,            100, 60000, '[demo] Заказ 3');

-- ============ Tech cards (2 — for orders 1 and 2) ============
WITH ords AS (
  SELECT id, row_number() OVER (ORDER BY created_at DESC) AS rn
  FROM orders WHERE data->>'_demo_seed' = 'v2-uat-1'
)
INSERT INTO order_tech_cards (order_id, status, approved_at, approved_by)
SELECT id, 'approved', now(), '11111111-1111-1111-1111-111111111111'::uuid
FROM ords
WHERE rn IN (2, 3);  -- skip the most recent (review-status order)

-- ============ Tech operations for the two approved cards ============
-- Card 1 (order #2 by rn, "approved" status): worn-out classic flow
WITH card1 AS (
  SELECT tc.id AS tech_card_id, tc.order_id
  FROM order_tech_cards tc
  JOIN orders o ON o.id = tc.order_id
  WHERE o.data->>'_demo_seed' = 'v2-uat-1' AND o.notes = '[demo] Заказ 2'
  LIMIT 1
), op_cut_auto AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'cut_auto'
), op_sew_hoodie AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'sew_hoodie'
), op_sp_print AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'sp_print_2color'
), op_qc_visual AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'qc_visual'
)
INSERT INTO order_tech_operations
  (tech_card_id, order_id, operation_type_id, section_id, qty, rate_snapshot, minutes_snapshot, name_snapshot, unit_snapshot, sort_order)
SELECT
  c.tech_card_id, c.order_id, op.id, op.section_id, qty,
  op.base_rate, op.base_minutes, op.name, op.unit, sort_order
FROM card1 c
CROSS JOIN LATERAL (
  SELECT * FROM op_cut_auto UNION ALL SELECT * FROM op_sp_print
  UNION ALL SELECT * FROM op_sew_hoodie UNION ALL SELECT * FROM op_qc_visual
) op
JOIN (VALUES
  ((SELECT id FROM op_cut_auto),   60, 10),
  ((SELECT id FROM op_sp_print),   30, 20),
  ((SELECT id FROM op_sew_hoodie), 30, 30),
  ((SELECT id FROM op_qc_visual),  30, 40)
) AS qs(op_id, qty, sort_order) ON op.id = qs.op_id;

-- Card 2 (order #3 by rn, "production" status): t-shirt run
WITH card2 AS (
  SELECT tc.id AS tech_card_id, tc.order_id
  FROM order_tech_cards tc
  JOIN orders o ON o.id = tc.order_id
  WHERE o.data->>'_demo_seed' = 'v2-uat-1' AND o.notes = '[demo] Заказ 1'
  LIMIT 1
), op_cut_manual AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'cut_manual'
), op_sew_tshirt AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'sew_tshirt'
), op_dtf_press AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'dtf_press'
), op_pack_fold AS (
  SELECT id, section_id, name, base_rate, base_minutes, unit FROM operation_types WHERE code = 'pack_fold'
)
INSERT INTO order_tech_operations
  (tech_card_id, order_id, operation_type_id, section_id, qty, rate_snapshot, minutes_snapshot, name_snapshot, unit_snapshot, sort_order)
SELECT
  c.tech_card_id, c.order_id, op.id, op.section_id, qty,
  op.base_rate, op.base_minutes, op.name, op.unit, sort_order
FROM card2 c
CROSS JOIN LATERAL (
  SELECT * FROM op_cut_manual UNION ALL SELECT * FROM op_sew_tshirt
  UNION ALL SELECT * FROM op_dtf_press UNION ALL SELECT * FROM op_pack_fold
) op
JOIN (VALUES
  ((SELECT id FROM op_cut_manual), 50, 10),
  ((SELECT id FROM op_dtf_press),  50, 20),
  ((SELECT id FROM op_sew_tshirt), 50, 30),
  ((SELECT id FROM op_pack_fold),  50, 40)
) AS qs(op_id, qty, sort_order) ON op.id = qs.op_id;

-- ============ Piecework batch (current month, open) ============
INSERT INTO piecework_batches (period_start, period_end, status, notes)
VALUES (
  date_trunc('month', now())::date,
  (date_trunc('month', now()) + interval '1 month - 1 day')::date,
  'open',
  '[demo] UAT period'
);

-- ============ A few piecework accruals ============
WITH b AS (
  SELECT id FROM piecework_batches WHERE notes = '[demo] UAT period' LIMIT 1
), w AS (
  SELECT id, full_name FROM workers WHERE full_name LIKE '[demo] %'
), op AS (
  SELECT id, name_snapshot, rate_snapshot, unit_snapshot
  FROM order_tech_operations
  WHERE deleted_at IS NULL
  LIMIT 4
)
INSERT INTO piecework_entries
  (batch_id, worker_id, tech_operation_id, entry_type, qty, rate, amount, reason)
SELECT
  (SELECT id FROM b),
  (SELECT id FROM w WHERE full_name = src.worker_name LIMIT 1),
  src.op_id,
  'accrual',
  src.qty,
  src.rate,
  src.qty * src.rate,
  NULL
FROM (
  SELECT
    '[demo] Иванова Анна' AS worker_name,
    (SELECT id FROM op WHERE name_snapshot LIKE '%футболк%' OR name_snapshot LIKE '%худи%' LIMIT 1) AS op_id,
    25 AS qty, 120::numeric AS rate
  UNION ALL
  SELECT
    '[demo] Петров Сергей',
    (SELECT id FROM op WHERE name_snapshot LIKE '%раскрой%' OR name_snapshot LIKE '%cut%' LIMIT 1),
    20, 25::numeric
  UNION ALL
  SELECT
    '[demo] Сидорова Мария',
    (SELECT id FROM op WHERE name_snapshot LIKE '%печат%' OR name_snapshot LIKE '%DTF%' OR name_snapshot LIKE '%dtf%' LIMIT 1),
    15, 85::numeric
) src
WHERE src.op_id IS NOT NULL;

-- ============ Verification ============
SELECT
  (SELECT count(*) FROM orders WHERE data->>'_demo_seed' = 'v2-uat-1') AS demo_orders,
  (SELECT count(*) FROM workers WHERE full_name LIKE '[demo] %') AS demo_workers,
  (SELECT count(*) FROM order_tech_cards) AS tech_cards,
  (SELECT count(*) FROM order_tech_operations) AS tech_ops,
  (SELECT count(*) FROM piecework_batches WHERE notes LIKE '[demo] %') AS demo_batches,
  (SELECT count(*) FROM piecework_entries) AS entries;
