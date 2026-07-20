import { describe, it, expect } from 'vitest';
import {
  SUBCONTRACT_OP_TYPE_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
} from '../types';
import { materialsBlockStage } from './routes';
import type { ErpMaterial } from '../types';

const mat = (status: ErpMaterial['status']): ErpMaterial => ({
  id: 'm1', order_id: 'o1', item_id: null, kind: 'fabric', name: 'Ткань',
  source: 'purchase', supplier: null, qty: null, status,
  eta_date: null, received_at: null, notes: null,
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
    expect(materialsBlockStage([mat('not_needed')], 'cutting')).toBe(false);
    // контрольный случай: непринятый закупочный материал по-прежнему блокирует
    expect(materialsBlockStage([mat('pending')], 'cutting')).toBe(true);
  });
});
