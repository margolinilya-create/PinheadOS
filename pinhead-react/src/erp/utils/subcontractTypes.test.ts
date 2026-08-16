import { describe, it, expect } from 'vitest';
import {
  SUBCONTRACT_OP_TYPE_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
} from '../types';
import { buildItemRoute, materialsBlockStage } from './routes';
import type { ErpMaterial } from '../types';

/** Строка цеха для материального гейта: настройка живёт в данных, а не в коде */
const CUT = { code: 'cutting', gate_material_kinds: ['fabric'] };

const mat = (status: ErpMaterial['status']): ErpMaterial => ({
  id: 'm1', order_id: 'o1', item_id: null, kind: 'fabric', name: 'Ткань',
  source: 'purchase', supplier: null, qty: null, status,
  eta_date: null, received_at: null, notes: null,
  qty_expected: null, qty_received: null, accept_status: null,
  accepted_at: null, accepted_by: null, accept_comment: null,
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

  /**
   * Значений три: смешанный вариант документ называет прямо («часть материалов
   * наша, часть подрядчика»), и он же добавлен в CHECK миграцией 20260816130000.
   * Лейбл обязан быть у каждого — подпись, взятая по несуществующему ключу,
   * рисует в таблице `undefined` и ничего при этом не роняет.
   */
  it('лейблы источника материалов покрывают все три значения', () => {
    expect(SUBCONTRACT_MATERIAL_SOURCE_LABELS.pinhead).toBe('Материалы Pinhead');
    expect(SUBCONTRACT_MATERIAL_SOURCE_LABELS.contractor).toBe('Материалы подрядчика');
    expect(SUBCONTRACT_MATERIAL_SOURCE_LABELS.mixed).toBe('Материалы смешанно');
    expect(Object.keys(SUBCONTRACT_MATERIAL_SOURCE_LABELS)).toHaveLength(3);
  });

  /**
   * `mixed` ведёт себя как `pinhead`, а не как `contractor`: раз хоть часть
   * материалов наша, закупку из маршрута вырезать нельзя. Сравнение в
   * `buildItemRoute` идёт именно с `'contractor'` — проверяем это значением,
   * потому что вариант `!== 'pinhead'` выглядел бы так же и был бы неверен.
   */
  it('смешанные материалы оставляют закупку в маршруте', () => {
    const codes = (materialSource: string | null) => buildItemRoute({
      productionType: 'outsource', brandingMethods: [], brandingOn: 'cut', materialSource,
    }).map((s) => s.departmentCode);
    expect(codes('mixed')).toContain('supply');
    expect(codes('pinhead')).toContain('supply');
    expect(codes('contractor')).not.toContain('supply');
  });

  it('материал подрядчика (not_needed) не блокирует закрой', () => {
    // При material_source=contractor материалы помечаются not_needed → закупка Pinhead не гейтит
    expect(materialsBlockStage([mat('not_needed')], CUT)).toBe(false);
    // контрольный случай: непринятый закупочный материал по-прежнему блокирует
    expect(materialsBlockStage([mat('pending')], CUT)).toBe(true);
  });
});
