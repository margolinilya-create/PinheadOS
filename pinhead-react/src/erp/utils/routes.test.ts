import { describe, it, expect } from 'vitest';
import { buildRoute, isStageReady, materialsBlockCutting } from './routes';
import type { ErpMaterial, StageStatus } from '../types';

/** Хелпер: находит этап по коду цеха */
function stage(route: ReturnType<typeof buildRoute>, code: string) {
  const s = route.find((r) => r.departmentCode === code);
  if (!s) throw new Error(`stage ${code} not found in route`);
  return s;
}

describe('buildRoute — типы производства (лист «Маршруты»)', () => {
  it('Пошив: закуп → закрой → швейка → ВТО', () => {
    const route = buildRoute({ productionType: 'sewing', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting', 'sewing', 'vto']);
  });

  it('Готовое изделие: только закуп', () => {
    const route = buildRoute({ productionType: 'ready_garment', brandingMethods: [], brandingOn: 'finished' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply']);
  });

  it('Крой: закуп → закрой', () => {
    const route = buildRoute({ productionType: 'cut', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting']);
  });

  it('Без изделий: этапов производства нет', () => {
    const route = buildRoute({ productionType: 'no_product', brandingMethods: [], brandingOn: 'cut' });
    expect(route).toEqual([]);
  });

  it('Подряд: только закуп', () => {
    const route = buildRoute({ productionType: 'outsource', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply']);
  });

  it('Образцы: закуп → эксперим. → закрой → швейка → ВТО', () => {
    const route = buildRoute({ productionType: 'samples', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(
      ['supply', 'experimental', 'cutting', 'sewing', 'vto'],
    );
  });
});

describe('buildRoute — нанесения', () => {
  it('Пошив + шелкография на крое: печать между закроем и швейкой', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['silkscreen'], brandingOn: 'cut',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(
      ['supply', 'cutting', 'silkscreen', 'sewing', 'vto'],
    );
    // печать зависит от закроя, швейка — от печати
    expect(stage(route, 'silkscreen').dependsOnCodes).toEqual(['cutting']);
    expect(stage(route, 'sewing').dependsOnCodes).toContain('silkscreen');
  });

  it('параллельные ветки: вышивка + шелкография обе зависят от закроя', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['embroidery', 'silkscreen'], brandingOn: 'cut',
    });
    expect(stage(route, 'embroidery').dependsOnCodes).toEqual(['cutting']);
    expect(stage(route, 'silkscreen').dependsOnCodes).toEqual(['cutting']);
    // швейка ждёт обе ветки
    expect(stage(route, 'sewing').dependsOnCodes.sort()).toEqual(['embroidery', 'silkscreen']);
  });

  it('ДТФ и термоперенос — один цех (дедуп)', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['dtf', 'heat_transfer'], brandingOn: 'cut',
    });
    expect(route.filter((r) => r.departmentCode === 'dtf')).toHaveLength(1);
  });

  it('нанесение на готовом: после ВТО', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['embroidery'], brandingOn: 'finished',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(
      ['supply', 'cutting', 'sewing', 'vto', 'embroidery'],
    );
    expect(stage(route, 'embroidery').dependsOnCodes).toEqual(['vto']);
  });

  it('готовое изделие + вышивка: вышивка после закупа', () => {
    const route = buildRoute({
      productionType: 'ready_garment', brandingMethods: ['embroidery'], brandingOn: 'finished',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'embroidery']);
    expect(stage(route, 'embroidery').dependsOnCodes).toEqual(['supply']);
  });

  it('без изделий + ДТФ: только цех нанесения, без зависимостей', () => {
    const route = buildRoute({
      productionType: 'no_product', brandingMethods: ['dtf'], brandingOn: 'cut',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(['dtf']);
    expect(stage(route, 'dtf').dependsOnCodes).toEqual([]);
  });

  it('«прочие» нанесения не создают этап (нет цеха)', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['other'], brandingOn: 'cut',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting', 'sewing', 'vto']);
  });
});

describe('isStageReady — вычисление готовности', () => {
  const mkStage = (id: string, status: StageStatus, depends: string[] = []) => ({
    id, item_id: 'i1', department_id: 'd1', depends_on: depends,
    status, qty_done: 0, qty_rework: 0,
    planned_start: null, planned_end: null, started_at: null, finished_at: null,
    assignee: null, block_reason: null, notes: null, sort_order: 0,
    created_at: '', updated_at: '',
  });

  it('этап без зависимостей готов', () => {
    expect(isStageReady(mkStage('a', 'waiting'), [mkStage('a', 'waiting')], [])).toBe(true);
  });

  it('этап ждёт незавершённую зависимость', () => {
    const dep = mkStage('a', 'in_progress');
    const st = mkStage('b', 'waiting', ['a']);
    expect(isStageReady(st, [dep, st], [])).toBe(false);
  });

  it('этап готов когда зависимость done', () => {
    const dep = mkStage('a', 'done');
    const st = mkStage('b', 'waiting', ['a']);
    expect(isStageReady(st, [dep, st], [])).toBe(true);
  });

  it('skipped-зависимость не блокирует', () => {
    const dep = mkStage('a', 'skipped');
    const st = mkStage('b', 'waiting', ['a']);
    expect(isStageReady(st, [dep, st], [])).toBe(true);
  });
});

describe('materialsBlockCutting — материалы гейтят закрой', () => {
  const mkMat = (status: string, kind = 'fabric'): ErpMaterial => ({
    id: 'm1', order_id: 'o1', item_id: null,
    kind: kind as ErpMaterial['kind'], name: 'Кулирка',
    source: 'purchase', qty: null,
    status: status as ErpMaterial['status'],
    eta_date: null, received_at: null, notes: null,
    created_at: '', updated_at: '',
  });

  it('не пришедшая ткань блокирует', () => {
    expect(materialsBlockCutting([mkMat('ordered')])).toBe(true);
    expect(materialsBlockCutting([mkMat('pending')])).toBe(true);
    expect(materialsBlockCutting([mkMat('in_transit')])).toBe(true);
  });

  it('received / not_needed не блокируют', () => {
    expect(materialsBlockCutting([mkMat('received')])).toBe(false);
    expect(materialsBlockCutting([mkMat('not_needed')])).toBe(false);
  });

  it('partial блокирует (пришло не всё)', () => {
    expect(materialsBlockCutting([mkMat('partial')])).toBe(true);
  });

  it('без материалов не блокирует', () => {
    expect(materialsBlockCutting([])).toBe(false);
  });
});
