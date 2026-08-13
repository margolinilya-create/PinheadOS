import { describe, it, expect } from 'vitest';
import {
  SUBCONTRACT_OP_TYPE_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
} from '../types';
import { materialsBlockStage } from './routes';
import type { ErpMaterial } from '../types';

/** Строка цеха для материального гейта: настройка живёт в данных, а не в коде */
const CUT = { code: 'cutting', gate_material_kinds: ['fabric'] };

const mat = (status: ErpMaterial['status']): ErpMaterial => ({
  id: 'm1', order_id: 'o1', item_id: null, kind: 'fabric', name: 'Ткань',
  source: 'purchase', supplier: null, qty: null, status,
  eta_date: null, received_at: null, notes: null,
  qty_expected: null, qty_received: null, accept_status: null,
  accepted_at: null, accepted_by: null, accept_comment: null, responsible: null,
  // Поля появились позже фикстуры и молчали, пока tsc не подключили полностью
  role: null, color: null, article: null,
  fact_name: null, fact_color: null, fact_article: null,
  created_at: '', updated_at: '',
});

describe('Подряд: типы операций и источник материалов (правка 1)', () => {
  it('лейблы типа операции покрывают оба значения', () => {
    expect(SUBCONTRACT_OP_TYPE_LABELS.finished_product).toBe('Готовое изделие');
    expect(SUBCONTRACT_OP_TYPE_LABELS.operation).toBe('Отдельная операция');
    expect(Object.keys(SUBCONTRACT_OP_TYPE_LABELS)).toHaveLength(2);
  });

  it('лейблы источника материалов покрывают оба значения', () => {
    expect(SUBCONTRACT_MATERIAL_SOURCE_LABELS.pinhead).toBe('Материалы Pinhead');
    expect(SUBCONTRACT_MATERIAL_SOURCE_LABELS.contractor).toBe('Материалы подрядчика');
    expect(Object.keys(SUBCONTRACT_MATERIAL_SOURCE_LABELS)).toHaveLength(2);
  });

  it('материал подрядчика (not_needed) не блокирует закрой', () => {
    // При material_source=contractor материалы помечаются not_needed → закупка Pinhead не гейтит
    expect(materialsBlockStage([mat('not_needed')], CUT)).toBe(false);
    // контрольный случай: непринятый закупочный материал по-прежнему блокирует
    expect(materialsBlockStage([mat('pending')], CUT)).toBe(true);
  });
});
