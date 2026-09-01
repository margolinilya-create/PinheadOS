import { describe, it, expect } from 'vitest';
import {
  buildRoute,
  buildItemRoute,
  isStageReady,
  isStageAwaitingProcurement,
  hasOpenProcurement,
  materialsBlockStage,
  materialsForItem,
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

  /**
   * ВТО У ОБРАЗЦА НЕТ (правка заказчика 01.09, п. 4). Цепочка `samples` была
   * копией `sewing`, и ВТО доставалось образцу заодно. У серии оно осталось —
   * сторож ниже это и проверяет, иначе правка «у образца нет» однажды
   * прочиталась бы как «нет нигде».
   */
  it('Образцы: закуп → закрой → швейка, БЕЗ ВТО', () => {
    const route = buildRoute({ productionType: 'samples', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(
      ['supply', 'cutting', 'sewing'],
    );
  });

  it('у серии ВТО остаётся', () => {
    const route = buildRoute({ productionType: 'sewing', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toContain('vto');
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

/**
 * ОТК убран из маршрута (правки заказчика 10.08).
 *
 * Отдельного участка контроля в структуре производства нет: качество отвечает тот
 * цех, который сдаёт работу. Раньше ОТК добавлялся последним этапом и ждал все
 * терминальные ветки — теперь маршрут заканчивается настоящей работой. Тесты
 * закрепляют отсутствие, потому что вернуть его «заодно» проще всего.
 */
describe('buildRoute — ОТК больше не отдельный этап', () => {
  it('обычный пошив заканчивается ВТО, а не контролем', () => {
    const route = buildRoute({ productionType: 'sewing', brandingMethods: [], brandingOn: 'cut' });
    expect(route.map((r) => r.departmentCode)).toEqual(['supply', 'cutting', 'sewing', 'vto']);
  });

  it('ОТК не появляется ни при каких нанесениях', () => {
    for (const brandingOn of ['cut', 'finished'] as const) {
      const route = buildRoute({
        productionType: 'sewing',
        brandingMethods: ['embroidery', 'silkscreen'],
        brandingOn,
      });
      expect(route.map((r) => r.departmentCode)).not.toContain('qc');
    }
  });

  it('параллельные ветки нанесения на готовом остаются терминальными', () => {
    const route = buildRoute({
      productionType: 'sewing',
      brandingMethods: ['embroidery', 'silkscreen'],
      brandingOn: 'finished',
    });
    // Раньше обе ветки сходились на ОТК. Теперь у позиции просто два хвоста —
    // и готовность к отгрузке считается по «все этапы done», а не по одному ОТК
    const depended = new Set(route.flatMap((r) => r.dependsOnCodes));
    const terminal = route.filter((r) => !depended.has(r.departmentCode)).map((r) => r.departmentCode);
    expect(terminal.slice().sort()).toEqual(['embroidery', 'silkscreen']);
  });

  it('только закуп остаётся только закупом', () => {
    for (const productionType of ['ready_garment', 'outsource'] as const) {
      const route = buildRoute({ productionType, brandingMethods: [], brandingOn: 'finished' });
      expect(route.map((r) => r.departmentCode)).toEqual(['supply']);
    }
  });

  it('пустой маршрут остаётся пустым', () => {
    const route = buildRoute({ productionType: 'no_product', brandingMethods: [], brandingOn: 'cut' });
    expect(route).toEqual([]);
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
  // Поля появились позже фикстуры и молчали, пока tsc не подключили полностью
  role: null, color: null, article: null,
  fact_name: null, fact_color: null, fact_article: null,
  created_at: '', updated_at: '',
});

/**
 * Строки цехов для материального гейта. Раньше сюда передавался КОД цеха, а карта
 * «вид материала → цех» была константой в коде; теперь настройка живёт в данных
 * (`erp_departments.gate_material_kinds`) и правится в админке.
 */
const CUT = { code: 'cutting', gate_material_kinds: ['fabric'] };
const SEW = { code: 'sewing', gate_material_kinds: ['hardware', 'labels'] };

describe('materialsBlockStage — материалы гейтят закрой', () => {
  it('не пришедшая ткань блокирует', () => {
    expect(materialsBlockStage([mkMat('ordered')], CUT)).toBe(true);
    expect(materialsBlockStage([mkMat('pending')], CUT)).toBe(true);
    expect(materialsBlockStage([mkMat('in_transit')], CUT)).toBe(true);
  });

  it('пришедший, но НЕ принятый складом материал блокирует (правка 3)', () => {
    expect(materialsBlockStage([mkMat('received')], CUT)).toBe(true);
  });

  it('принятый склад / зарезервированный / not_needed не блокируют', () => {
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'accepted_full')], CUT)).toBe(false);
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'accepted_partial')], CUT)).toBe(false);
    expect(materialsBlockStage([mkMat('reserved')], CUT)).toBe(false);
    expect(materialsBlockStage([mkMat('not_needed')], CUT)).toBe(false);
  });

  it('недостача/пересорт/отказ по приёмке блокируют закрой', () => {
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'shortage')], CUT)).toBe(true);
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'mismatch')], CUT)).toBe(true);
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'rejected')], CUT)).toBe(true);
  });

  it('partial блокирует (пришло не всё)', () => {
    expect(materialsBlockStage([mkMat('partial')], CUT)).toBe(true);
  });

  it('без материалов не блокирует', () => {
    expect(materialsBlockStage([], CUT)).toBe(false);
  });
});

describe('materialsBlockStage — гейт по типу материала на нужный цех', () => {
  it('ткань блокирует закрой, но не швейку', () => {
    const mats = [mkMat('pending', 'fabric')];
    expect(materialsBlockStage(mats, CUT)).toBe(true);
    expect(materialsBlockStage(mats, SEW)).toBe(false);
  });

  it('фурнитура/бирки блокируют швейку, но не закрой', () => {
    expect(materialsBlockStage([mkMat('pending', 'hardware')], SEW)).toBe(true);
    expect(materialsBlockStage([mkMat('pending', 'labels')], SEW)).toBe(true);
    expect(materialsBlockStage([mkMat('pending', 'hardware')], CUT)).toBe(false);
  });

  it('упаковка/прочее не гейтят настроенные по умолчанию участки', () => {
    expect(materialsBlockStage([mkMat('pending', 'packaging')], SEW)).toBe(false);
    expect(materialsBlockStage([mkMat('pending', 'other')], CUT)).toBe(false);
  });

  /**
   * Карта «вид материала → цех» переехала из константы в данные
   * (`erp_departments.gate_material_kinds`, миграция 20260803120000): участок,
   * заведённый директором в админке, обязан попадать под гейт без релиза.
   */
  it('участок без настройки не гейтится — остановка производства fail-open', () => {
    const vto = { code: 'vto' };
    expect(materialsBlockStage([mkMat('pending', 'fabric')], vto)).toBe(false);
    expect(materialsBlockStage([mkMat('pending', 'fabric')], { code: 'vto', gate_material_kinds: [] })).toBe(false);
    expect(materialsBlockStage([mkMat('pending', 'fabric')], null)).toBe(false);
    expect(materialsBlockStage([mkMat('pending', 'fabric')], undefined)).toBe(false);
  });

  it('новый участок гейтится по своей настройке, а не по коду', () => {
    const silk = { code: 'silkscreen', gate_material_kinds: ['other'] };
    expect(materialsBlockStage([mkMat('pending', 'other', null, 'Плёнка')], silk)).toBe(true);
    expect(materialsBlockStage([mkMat('pending', 'fabric')], silk)).toBe(false);
  });

  it('принятые складом материалы не блокируют', () => {
    expect(materialsBlockStage([mkMat('received', 'fabric', null, 'Кулирка', 'accepted_full')], CUT)).toBe(false);
  });

  it('missingMaterialsForStage возвращает только неготовые материалы цеха', () => {
    const mats = [
      mkMat('received', 'fabric', null, 'Кулирка', 'accepted_full'), // принят → не в списке
      mkMat('pending', 'hardware', null, 'Молния'),
      mkMat('pending', 'fabric', null, 'Дюспо'),
    ];
    expect(missingMaterialsForStage(mats, SEW).map((m) => m.name)).toEqual(['Молния']);
    expect(missingMaterialsForStage(mats, CUT).map((m) => m.name)).toEqual(['Дюспо']);
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
    const reason = waitingReason(mkStage(), [], mats, new Map(), SEW);
    expect(reason).toContain('Ждём материалы');
    expect(reason).toContain('Молния');
    expect(reason).toContain('20.07.2026');
  });

  it('материал без даты — «план не указан»', () => {
    const mats = [mkMat('pending', 'fabric', null, 'Кулирка')];
    const reason = waitingReason(mkStage(), [], mats, new Map(), CUT);
    expect(reason).toContain('план не указан');
  });

  it('нет недостающих материалов и зависимостей — null', () => {
    expect(waitingReason(mkStage(), [], [], new Map(), SEW)).toBeNull();
  });

  it('blocked — возвращает block_reason либо дефолт (аудит P1)', () => {
    const blocked = { depends_on: [], status: 'blocked' as StageStatus, block_reason: 'Нет ниток' };
    expect(waitingReason(blocked, [], [], new Map(), SEW)).toBe('Нет ниток');
    const blockedNoReason = { depends_on: [], status: 'blocked' as StageStatus, block_reason: null };
    expect(waitingReason(blockedNoReason, [], [], new Map(), SEW)).toBe('Заблокирован цехом');
  });

  it('незавершённая зависимость — «<цех>: ещё не завершено» + fallback (аудит P1)', () => {
    const dep = { id: 'd1', status: 'in_progress' as StageStatus, department_id: 'dep-cut' };
    const st = mkStage(['d1']);
    expect(waitingReason(st, [dep], [], new Map([['dep-cut', 'Закрой']]), SEW))
      .toBe('Закрой: ещё не завершено');
    expect(waitingReason(st, [dep], [], new Map(), SEW))
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
    expect(isStageReady(st, [], [], SEW, false)).toBe(true);
    // с гейтом — не готов
    expect(isStageReady(st, [], [], SEW, true)).toBe(false);
    expect(waitingReason(st, [], [], new Map(), SEW, true)).toBe('Ожидает закупку материала на замену');
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

/**
 * `buildItemRoute` объявлен в CLAUDE.md единым источником маршрута (его зовут и
 * `createOrder`, и превью формы), но тестов у него не было ни одного — а именно он
 * решает, будут ли у позиции этапы вообще.
 */
describe('buildItemRoute — вырезание закупки при материале подрядчика', () => {
  it('материал Pinhead: маршрут не меняется', () => {
    const base = { productionType: 'outsource' as const, brandingMethods: [], brandingOn: 'cut' as const };
    expect(buildItemRoute({ ...base, materialSource: 'pinhead' }).map((s) => s.departmentCode))
      .toEqual(['supply']);
  });

  it('материал подрядчика у подряда: закупки нет, и маршрут становится ПУСТЫМ', () => {
    // Это верно по смыслу: всю работу ведёт подрядчик, она живёт в erp_subcontracting.
    // Гейт отгрузки обязан это учитывать — см. stageUi.test.ts, иначе заказ
    // невозможно закрыть никогда.
    const route = buildItemRoute({
      productionType: 'outsource',
      brandingMethods: [],
      brandingOn: 'cut',
      materialSource: 'contractor',
    });
    expect(route).toEqual([]);
  });

  it('подряд с нанесением на готовом: остаётся только цех нанесения', () => {
    const route = buildItemRoute({
      productionType: 'outsource',
      brandingMethods: ['silkscreen'],
      brandingOn: 'finished',
      materialSource: 'contractor',
    });
    expect(route.map((s) => s.departmentCode)).toEqual(['silkscreen']);
    // supply вырезан и не остался висеть в зависимостях
    expect(route.flatMap((s) => s.dependsOnCodes)).not.toContain('supply');
  });

  it('правило применяется только к подряду: у швейки закупка остаётся', () => {
    const route = buildItemRoute({
      productionType: 'sewing',
      brandingMethods: [],
      brandingOn: 'cut',
      materialSource: 'contractor',
    });
    expect(route.map((s) => s.departmentCode)).toContain('supply');
  });

  /**
   * Отметка «Закупка не требуется» (правки заказчика 20.08).
   *
   * Документ: «сам факт наличия подряда не означает, что что-то нужно
   * покупать… закупка создаётся только тогда, когда для заказа действительно
   * требуется закупка». Раньше этап `supply` стоял в начале маршрута у ЛЮБОГО
   * типа производства, и заказ, где покупать нечего, всё равно ждал закупщика.
   *
   * Вырезание этапа — единственный механизм: заказ не появляется у закупщика
   * ПО ПОСТРОЕНИЮ (`ordersAwaitingSupply` считает этапы), без второго правила
   * «показывать/не показывать» на его экране.
   */
  it('«Закупка не требуется» вырезает supply у обычного производства', () => {
    const route = buildItemRoute({
      productionType: 'sewing',
      brandingMethods: ['dtf'],
      brandingOn: 'cut',
      needsPurchase: false,
    });
    expect(route.map((s) => s.departmentCode)).not.toContain('supply');
    // Остальной маршрут не тронут — вырезали ровно закупку
    expect(route.map((s) => s.departmentCode)).toEqual(['cutting', 'dtf', 'sewing', 'vto']);
  });

  it('вырезая закупку, снимаем её и из зависимостей — иначе этап осиротеет', () => {
    const route = buildItemRoute({
      productionType: 'sewing',
      brandingMethods: [],
      brandingOn: 'cut',
      needsPurchase: false,
    });
    for (const stage of route) {
      expect(stage.dependsOnCodes).not.toContain('supply');
    }
    // Первый этап остался без зависимостей и потому готов к работе
    expect(route[0].dependsOnCodes).toEqual([]);
  });

  it('не передано — считаем, что закупка нужна: старые заказы не меняются', () => {
    // `purchase_required` у заведённых до 20.08 стоит `true` по умолчанию,
    // и дорисовывать им отсутствие закупки задним числом нельзя
    const route = buildItemRoute({
      productionType: 'sewing', brandingMethods: [], brandingOn: 'cut',
    });
    expect(route.map((s) => s.departmentCode)).toContain('supply');
    expect(buildItemRoute({
      productionType: 'sewing', brandingMethods: [], brandingOn: 'cut',
      needsPurchase: true,
    }).map((s) => s.departmentCode)).toContain('supply');
  });

  it('«Закупка не требуется» и материал подрядчика дают один результат', () => {
    // Второе правило поглощается первым, но оставлено явным — и оба обязаны
    // приводить к одному маршруту, иначе поведение зависело бы от того,
    // каким путём пришли к «закупать нечего»
    const byFlag = buildItemRoute({
      productionType: 'outsource', brandingMethods: ['silkscreen'],
      brandingOn: 'finished', needsPurchase: false,
    });
    const bySource = buildItemRoute({
      productionType: 'outsource', brandingMethods: ['silkscreen'],
      brandingOn: 'finished', materialSource: 'contractor',
    });
    expect(byFlag).toEqual(bySource);
  });

  it('«только нанесение» методом без своего цеха тоже даёт пустой маршрут', () => {
    // BRANDING_DEPT.other = null — пришив нашивок делают внутри швейки
    const route = buildItemRoute({
      productionType: 'no_product',
      brandingMethods: ['other'],
      brandingOn: 'finished',
    });
    expect(route).toEqual([]);
  });
});

/**
 * Материальный гейт различает позиции.
 *
 * `MATERIAL_GATE_DEPT` отвечает только на «какой вид материала нужен какому цеху»,
 * а принадлежность позиции раньше не проверялась вовсе: в гейт уходил весь
 * `order.materials`, поэтому задержка ткани на четвёртой позиции держала закрой
 * первых трёх — цех видел «Ждём материалы» по ткани, которой не касается.
 */
describe('materialsForItem — материалы позиции против материалов заказа', () => {
  const fabricFor = (itemId: string | null, name = 'Кулирка') =>
    ({ id: `m-${itemId ?? 'all'}`, item_id: itemId, kind: 'fabric', status: 'pending',
       accept_status: null, name }) as unknown as ErpMaterial;

  it('материал без item_id общий — виден всем позициям', () => {
    const shared = fabricFor(null, 'Общая ткань');
    expect(materialsForItem([shared], 'i1')).toEqual([shared]);
    expect(materialsForItem([shared], 'i2')).toEqual([shared]);
  });

  it('материал с item_id виден только своей позиции', () => {
    const mine = fabricFor('i1');
    const other = fabricFor('i2');
    expect(materialsForItem([mine, other], 'i1')).toEqual([mine]);
    expect(materialsForItem([mine, other], 'i2')).toEqual([other]);
  });

  it('без itemId возвращает всё — совместимость со старыми вызовами', () => {
    const all = [fabricFor('i1'), fabricFor('i2')];
    expect(materialsForItem(all)).toEqual(all);
    expect(materialsForItem(null, 'i1')).toEqual([]);
  });

  it('чужая непришедшая ткань больше не блокирует закрой этой позиции', () => {
    const mine = { ...fabricFor('i1'), status: 'received', accept_status: 'accepted_full' } as ErpMaterial;
    const foreign = fabricFor('i2', 'Ткань 4-й позиции');
    // до фильтра: гейт видел обе и блокировал
    expect(materialsBlockStage([mine, foreign], CUT)).toBe(true);
    // после фильтра по позиции — только свою, принятую
    expect(materialsBlockStage(materialsForItem([mine, foreign], 'i1'), CUT)).toBe(false);
    // а своя непришедшая по-прежнему блокирует
    expect(materialsBlockStage(materialsForItem([mine, foreign], 'i2'), CUT)).toBe(true);
  });
});
