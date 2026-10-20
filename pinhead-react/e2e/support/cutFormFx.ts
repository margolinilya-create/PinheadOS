import { buildStages } from './mockSupabase';

/**
 * ФОРМА СДАЧИ ЗАКРОЯ (правки 19.10): «Результат кроя» + «Расход ткани».
 *
 * Свой заказ, а не правка базовых четырёх: те держат визуальные эталоны.
 * Два материала (полотно и рибана) — ровно тот случай, ради которого
 * выпуск вводится один раз, а средний расход считается по материалу.
 * Схема отчёта участка — в данных (`result_detail`, `result_fields`),
 * поэтому закрою она дописывается патчем фикстуры участков.
 */
const CREATED = '2026-07-15T09:00:00Z';

export const CUT_DEPT_PATCH = {
  cutting: {
    result_detail: 'rolls',
    allows_over_plan: true,
    result_fields: [
      { code: 'cut', label: 'Скроено', unit: 'шт', required: true, target: 'qty_good' },
      { code: 'defect', label: 'Брак', unit: 'шт', required: false, target: 'qty_defect' },
    ],
  },
};

const roll = (id: string, materialId: string, seq: number, lengthM: number) => ({
  id, material_id: materialId, receipt_id: null, seq, label: `Рулон №${seq}`,
  qty: 20, unit: 'кг', status: 'in_stock', qty_left: 20, leftover_kind: null,
  price_per_unit: 700, width_cm: 180, density_gsm: 240,
  length_m: lengthM, length_source: 'supplier', length_left_m: lengthM, kg_per_m: 0.4, price_per_m: 280,
  created_at: CREATED,
});

const material = (id: string, name: string, rolls: unknown[]) => ({
  id, order_id: 'cut-fx', item_id: null, kind: 'fabric', name, source: 'purchase', qty: '60 кг',
  qty_expected: 60, qty_received: 60, unit: 'кг', price_per_unit: 700, color: 'чёрный',
  status: 'received', accept_status: 'accepted_full', eta_date: null, received_at: CREATED,
  notes: null, created_at: CREATED, updated_at: CREATED, rolls,
});

export const CUT_ORDER = {
  id: 'cut-fx', bitrix_id: '90311', title: 'Свитшоты закрой-тест',
  customer: 'ООО «Ромашка»', manager: 'Анна',
  launch_date: '2026-07-18', due_date: '2026-07-28', buffer_days: 1,
  priority: 0, status: 'active', shipped_status: 'not_shipped',
  delivered_at: null, shipped_at: null, shipped_by: null, notes: null,
  packaging: 'none', packaging_note: null, stickers: 'none', stickers_note: null,
  no_chestny_znak: false, created_by: null, created_at: CREATED, updated_at: CREATED,
  attachments: [],
  items: [{
    id: 'cut-fx-i1', order_id: 'cut-fx', product_type: 'Свитшот', variant: 'чёрные',
    qty: 100, production_type: 'sewing', branding_methods: [], branding_on: 'cut',
    notes: null, size_grid: [{ color: 'чёрный', sizes: { S: 50, M: 50 } }], sort_order: 10,
    created_at: CREATED, updated_at: CREATED, prints: [],
    stages: buildStages('cut-fx-i1', [
      { code: 'supply', status: 'done' },
      { code: 'cutting', status: 'in_progress', deps: [0] },
      { code: 'sewing', status: 'waiting', deps: [1] },
    ]),
  }],
  materials: [
    material('cut-fx-m1', 'Футер 3-нитка', [
      roll('cut-fx-r1', 'cut-fx-m1', 1, 50), roll('cut-fx-r2', 'cut-fx-m1', 2, 50),
    ]),
    material('cut-fx-m2', 'Рибана', [roll('cut-fx-r3', 'cut-fx-m2', 3, 10)]),
  ],
};
