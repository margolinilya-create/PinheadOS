import { describe, it, expect } from 'vitest';
import {
  buildRoute,
  isStageReady,
  isStageAwaitingProcurement,
  hasOpenProcurement,
  materialsBlockStage,
  missingMaterialsForStage,
  waitingReason,
} from './routes';
import type { ErpItemStage, ErpMaterial, StageStatus } from '../types';

/** Хелпер: находит этап по коду цеха */
function stage(route: ReturnType<typeof buildRoute>, code: string) {
  const s = route.find((r) => r.departmentCode === code);
  if (!s) throw new Error(`stage ${code} not found in route`);
  return s;
}

describe('buildRoute — типы производства (лист «Маршруты»)', () => {
  it('Пошив: закуп → закрой → швейка → ВТО', () => {
    const route = buildRoute({ productionType: 'sewing', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting', 'sewing', 'vto', 'qc']);
  });

  it('Готовое изделие: только закуп', () => {
    const route = buildRoute({ productionType: 'ready_garment', brandingMethods: [], brandingOn: 'finished' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply']);
  });

  it('Крой: закуп → закрой', () => {
    const route = buildRoute({ productionType: 'cut', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting', 'qc']);
  });

  it('Без изделий: этапов производства нет', () => {
    const route = buildRoute({ productionType: 'no_product', brandingMethods: [], brandingOn: 'cut' });
    expect(route).toEqual([]);
  });

  it('Подряд: только закуп', () => {
    const route = buildRoute({ productionType: 'outsource', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply']);
  });

  it('Образцы: закуп → закрой → швейка → ВТО (эксперим. цех — отдельный модуль)', () => {
    const route = buildRoute({ productionType: 'samples', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(
      ['supply', 'cutting', 'sewing', 'vto', 'qc'],
    );
  });
});

describe('buildRoute — нанесения', () => {
  it('Пошив + шелкография на крое: печать между закроем и швейкой', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['silkscreen'], brandingOn: 'cut',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(
      ['supply', 'cutting', 'silkscreen', 'sewing', 'vto', 'qc'],
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
      ['supply', 'cutting', 'sewing', 'vto', 'embroidery', 'qc'],
    );
    expect(stage(route, 'embroidery').dependsOnCodes).toEqual(['vto']);
  });

  it('готовое изделие + вышивка: вышивка после закупа', () => {
    const route = buildRoute({
      productionType: 'ready_garment', brandingMethods: ['embroidery'], brandingOn: 'finished',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'embroidery', 'qc']);
    expect(stage(route, 'embroidery').dependsOnCodes).toEqual(['supply']);
  });

  it('без изделий + ДТФ: только цех нанесения, без зависимостей', () => {
    const route = buildRoute({
      productionType: 'no_product', brandingMethods: ['dtf'], brandingOn: 'cut',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(['dtf', 'qc']);
    expect(stage(route, 'dtf').dependsOnCodes).toEqual([]);
  });

  it('«прочие» нанесения не создают этап (нет цеха)', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['other'], brandingOn: 'cut',
    });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting', 'sewing', 'vto', 'qc']);
  });
});

describe('buildRoute — финальный ОТК', () => {
  it('по умолчанию ОТК есть и стоит последним', () => {
    const route = buildRoute({ productionType: 'sewing', brandingMethods: [], brandingOn: 'cut' });
    expect(route[route.length - 1].departmentCode).toBe('qc');
    expect(stage(route, 'qc').dependsOnCodes).toEqual(['vto']);
  });

  it('снятая галочка убирает ОТК из маршрута', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: [], brandingOn: 'cut', needsQc: false,
    });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting', 'sewing', 'vto']);
  });

  it('ОТК ждёт ВСЕ параллельные ветки нанесения на готовом, а не последнюю по списку', () => {
    const route = buildRoute({
      productionType: 'sewing',
      brandingMethods: ['embroidery', 'silkscreen'],
      brandingOn: 'finished',
    });
    // вышивка и шелкография идут параллельно после ВТО — ОТК зависит от обеих
    expect(stage(route, 'qc').dependsOnCodes.slice().sort()).toEqual(['embroidery', 'silkscreen']);
    // и не от ВТО: он уже покрыт транзитивно через ветки
    expect(stage(route, 'qc').dependsOnCodes).not.toContain('vto');
  });

  it('ОТК ждёт все ветки нанесения на крое через швейку и ВТО', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['dtf'], brandingOn: 'cut',
    });
    expect(stage(route, 'qc').dependsOnCodes).toEqual(['vto']);
  });

  it('только закуп — ОТК не добавляется: контролировать нечего', () => {
    for (const productionType of ['ready_garment', 'outsource'] as const) {
      const route = buildRoute({ productionType, brandingMethods: [], brandingOn: 'finished' });
      expect(route.map((r) => r.departmentCode)).toEqual(['supply']);
    }
  });

  it('пустой маршрут остаётся пустым', () => {
    const route = buildRoute({ productionType: 'no_product', brandingMethods: [], brandingOn: 'cut' });
    expect(route).toEqual([]);
  });

  it('sortOrder ОТК больше всех прочих этапов', () => {
    const route = buildRoute({
      productionType: 'sewing', brandingMethods: ['embroidery'], brandingOn: 'finished',
    });
    const qc = stage(route, 'qc').sortOrder;
    for (const r of route) {
      if (r.departmentCode !== 'qc') expect(r.sortOrder).toBeLessThan(qc);
    }
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

const mkMat = (
  status: string,
  kind = 'fabric',
  eta: string | null = null,
  name = 'Кулирка',
  accept: ErpMaterial['accept_status'] = null,
): ErpMaterial => ({
  id: 'm1', order_id: 'o1', item_id: null,
  kind: kind as ErpMaterial['kind'], name,
  source: 'purchase', supplier: null, qty: null,
  status: status as ErpMaterial['status'],
  eta_date: eta, received_at: null, notes: null,
  qty_expected: null, qty_received: null, accept_status: accept,
  accepted_at: null, accepted_by: null, accept_comment: null,
  created_at: '', updated_at: '',
});

describe('materialsBlockStage — материалы гейтят закрой', () => {
  it('не пришедшая ткань блокирует', () => {
    expect(materialsBlockStage([mkMat('ordered')], 'cutting')).toBe(true);
    expect(materialsBlockStage([mkMat('pending')], 'cutting')).toBe(true);
    expect(materialsBlockStage([mkMat('in_transit')], 'cutting')).toBe(true);
  });

  it('пришедший, но НЕ принятый складом материал блокирует (правка 3)', () => {
    expect(materialsBlockStage([mkMat('received')], 'cutting')).toBe(true);
  });

  it('принятый склад / зарезервированный / not_needed не блокируют', () => {
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'accepted_full')], 'cutting')).toBe(false);
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'accepted_partial')], 'cutting')).toBe(false);
    expect(materialsBlockStage([mkMat('reserved')], 'cutting')).toBe(false);
    expect(materialsBlockStage([mkMat('not_needed')], 'cutting')).toBe(false);
  });

  it('недостача/пересорт/отказ по приёмке блокируют закрой', () => {
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'shortage')], 'cutting')).toBe(true);
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'mismatch')], 'cutting')).toBe(true);
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'rejected')], 'cutting')).toBe(true);
  });

  it('partial блокирует (пришло не всё)', () => {
    expect(materialsBlockStage([mkMat('partial')], 'cutting')).toBe(true);
  });

  it('без материалов не блокирует', () => {
    expect(materialsBlockStage([], 'cutting')).toBe(false);
  });
});

describe('materialsBlockStage — гейт по типу материала на нужный цех', () => {
  it('ткань блокирует закрой, но не швейку', () => {
    const mats = [mkMat('pending', 'fabric')];
    expect(materialsBlockStage(mats, 'cutting')).toBe(true);
    expect(materialsBlockStage(mats, 'sewing')).toBe(false);
  });

  it('фурнитура/бирки блокируют швейку, но не закрой', () => {
    expect(materialsBlockStage([mkMat('pending', 'hardware')], 'sewing')).toBe(true);
    expect(materialsBlockStage([mkMat('pending', 'labels')], 'sewing')).toBe(true);
    expect(materialsBlockStage([mkMat('pending', 'hardware')], 'cutting')).toBe(false);
  });

  it('упаковка/прочее не гейтят ни один этап', () => {
    expect(materialsBlockStage([mkMat('pending', 'packaging')], 'sewing')).toBe(false);
    expect(materialsBlockStage([mkMat('pending', 'other')], 'cutting')).toBe(false);
  });

  it('принятые складом материалы не блокируют', () => {
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'accepted_full')], 'cutting')).toBe(false);
  });

  it('missingMaterialsForStage возвращает только неготовые материалы цеха', () => {
    const mats = [
      mkMat('received', 'fabric', null, 'Кулирка', 'accepted_full'), // принят → не в списке
      mkMat('pending', 'hardware', null, 'Молния'),
      mkMat('pending', 'fabric', null, 'Дюспо'),
    ];
    expect(missingMaterialsForStage(mats, 'sewing').map((m) => m.name)).toEqual(['Молния']);
    expect(missingMaterialsForStage(mats, 'cutting').map((m) => m.name)).toEqual(['Дюспо']);
  });
});

describe('waitingReason — причина ожидания с планом прихода', () => {
  const mkStage = (
    depends: string[] = [],
    status: StageStatus = 'waiting',
  ): Pick<ErpItemStage, 'depends_on' | 'status' | 'block_reason'> => ({
    depends_on: depends, status, block_reason: null,
  });

  it('перечисляет недостающие материалы цеха с датой плана', () => {
    const mats = [mkMat('pending', 'hardware', '2026-07-20', 'Молния')];
    const reason = waitingReason(mkStage(), [], mats, new Map(), 'sewing');
    expect(reason).toContain('Ждём материалы');
    expect(reason).toContain('Молния');
    expect(reason).toContain('20.07.2026');
  });

  it('материал без даты — «план не указан»', () => {
    const mats = [mkMat('pending', 'fabric', null, 'Кулирка')];
    const reason = waitingReason(mkStage(), [], mats, new Map(), 'cutting');
    expect(reason).toContain('план не указан');
  });

  it('нет недостающих материалов и зависимостей — null', () => {
    expect(waitingReason(mkStage(), [], [], new Map(), 'sewing')).toBeNull();
  });

  it('blocked — возвращает block_reason либо дефолт (аудит P1)', () => {
    const blocked = { depends_on: [], status: 'blocked' as StageStatus, block_reason: 'Нет ниток' };
    expect(waitingReason(blocked, [], [], new Map(), 'sewing')).toBe('Нет ниток');
    const blockedNoReason = { depends_on: [], status: 'blocked' as StageStatus, block_reason: null };
    expect(waitingReason(blockedNoReason, [], [], new Map(), 'sewing')).toBe('Заблокирован цехом');
  });

  it('незавершённая зависимость — «<цех>: ещё не завершено» + fallback (аудит P1)', () => {
    const dep = { id: 'd1', status: 'in_progress' as StageStatus, department_id: 'dep-cut' };
    const st = mkStage(['d1']);
    expect(waitingReason(st, [dep], [], new Map([['dep-cut', 'Закрой']]), 'sewing'))
      .toBe('Закрой: ещё не завершено');
    expect(waitingReason(st, [dep], [], new Map(), 'sewing'))
      .toBe('предыдущий этап: ещё не завершено');
  });
});

describe('isStageAwaitingProcurement / гейт закупки (аудит A1)', () => {
  const task = (source_stage_id: string | null, status: string) => ({ source_stage_id, status });

  it('открытая задача по этапу → ожидание закупки', () => {
    expect(isStageAwaitingProcurement([task('st1', 'new')], 'st1')).toBe(true);
    expect(isStageAwaitingProcurement([task('st1', 'in_progress')], 'st1')).toBe(true);
  });

  it('закрытая/отменённая или чужая задача не гейтит', () => {
    expect(isStageAwaitingProcurement([task('st1', 'done')], 'st1')).toBe(false);
    expect(isStageAwaitingProcurement([task('st1', 'cancelled')], 'st1')).toBe(false);
    expect(isStageAwaitingProcurement([task('st2', 'new')], 'st1')).toBe(false);
    expect(isStageAwaitingProcurement([], 'st1')).toBe(false);
    expect(isStageAwaitingProcurement(null, 'st1')).toBe(false);
  });

  it('blockedByProcurement=true делает этап неготовым и даёт причину', () => {
    const st = { depends_on: [] as string[], status: 'waiting' as StageStatus, block_reason: null };
    // без гейта — готов
    expect(isStageReady(st, [], [], 'sewing', false)).toBe(true);
    // с гейтом — не готов
    expect(isStageReady(st, [], [], 'sewing', true)).toBe(false);
    expect(waitingReason(st, [], [], new Map(), 'sewing', true)).toBe('Ожидает закупку материала на замену');
  });
});

describe('hasOpenProcurement — открытая задача дозакупки (правка 7)', () => {
  it('true если есть задача не done/cancelled', () => {
    expect(hasOpenProcurement([{ source_stage_id: null, status: 'new' }])).toBe(true);
    expect(hasOpenProcurement([{ source_stage_id: null, status: 'in_progress' }])).toBe(true);
    expect(hasOpenProcurement([{ source_stage_id: null, status: 'ordered' }])).toBe(true);
  });

  it('false если все задачи done/cancelled или их нет', () => {
    expect(hasOpenProcurement([{ source_stage_id: null, status: 'done' }])).toBe(false);
    expect(hasOpenProcurement([{ source_stage_id: null, status: 'cancelled' }])).toBe(false);
    expect(hasOpenProcurement([])).toBe(false);
    expect(hasOpenProcurement(null)).toBe(false);
  });
});
