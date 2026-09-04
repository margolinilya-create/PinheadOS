import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ГЕЙТ ЗАВЕРШЕНИЯ ЭТАПА — СТОРОЖ НА ПИСАТЕЛЯ, А НЕ НА СПИСОК ВЫЗЫВАЮЩИХ.
 *
 * Правка 30.08 (п. 5) запретила закрывать этап, пока по позиции не закрыта
 * закупка. Проверка стояла в интерфейсе, а сторож (`utils/stageDone.test.ts`)
 * перечислял точки закрытия РУКАМИ — тремя строками. Путей оказалось больше:
 * «Записать результат» у участка с настроенной схемой отчёта
 * (`erp_departments.result_fields`) идёт в `submitStageReport`, а тот через
 * `erp_stage_submit_report` сам ставит `done`, когда `qty_done` добирает тираж.
 *
 * Цена была прямая, а не теоретическая: схема отчёта засеяна миграцией
 * `20260810190000` закрою и швейке — РОВНО тем двум участкам, у которых
 * непустой `gate_material_kinds` (`20260803120000`). То есть гейт молчал
 * именно там, ради чего писался: закрой закрывал этап при неприехавшей ткани
 * и открывал швейке тираж, которого физически нет.
 *
 * Поэтому здесь проверяется ПОВЕДЕНИЕ КАЖДОГО ПИСАТЕЛЯ, а не текст исходников:
 * снимите проверку у любого из трёх — тест краснеет. Список вызывающих
 * при этом не нужен вовсе: пятый путь пройдёт через тех же писателей.
 */

const h = vi.hoisted(() => ({
  rpcCalls: [] as { fn: string }[],
  updateCalls: [] as { table: string }[],
}));

vi.mock('../../lib/supabase', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  /**
   * Мок обязан уметь то, что умеет клиент. `erpWrite` считает отказом ПУСТОЙ
   * ответ `update().select()` — так RLS запрещает на UPDATE (через `USING`,
   * то есть «0 строк» без ошибки). Мок, отдающий пустой массив всегда, объявил
   * бы отказом КАЖДУЮ запись, и сторож краснел бы на исправном коде.
   */
  const query = (table: string): any => {
    let rows: unknown[] = [];
    const q: any = {
      eq: () => q,
      is: () => q,
      in: () => q,
      order: () => q,
      select: () => q,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (res: any) => res({ data: rows, error: null }),
      update: () => { h.updateCalls.push({ table }); rows = [{ id: 'st1' }]; return q; },
      insert: () => q,
      upsert: () => q,
      delete: () => q,
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => query(table),
      rpc: (fn: string) => {
        h.rpcCalls.push({ fn });
        return Promise.resolve({ data: null, error: null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

const { useErpStore } = await import('./useErpStore');
const { attachDomainSlices } = await import('./domainSlices');
// Тест рендерит стор напрямую, минуя `lazyScreen`, — доменные действия
// (в том числе все три писателя этапа) подключаются вручную. Правило проекта.
attachDomainSlices();

/** Участок с материальным гейтом — как закрой и швейка на проде */
const GATED_DEPT = {
  id: 'd-cut', code: 'cutting', name: 'Закрой',
  gate_material_kinds: ['fabric'], is_production: true, active: true, sort_order: 1,
};
/** Участок без гейта — на нём ни один писатель отказывать не должен */
const OPEN_DEPT = { ...GATED_DEPT, id: 'd-vto', code: 'vto', name: 'ВТО', gate_material_kinds: [] };

/** Ткань, которой ещё нет на фабрике: не received / reserved / not_needed */
const PENDING_FABRIC = {
  id: 'm1', order_id: 'o1', item_id: null, kind: 'fabric',
  name: 'Кулирка 180', status: 'ordered',
};

function seed(opts: {
  deptId?: string;
  materials?: unknown[];
  bypasses?: unknown[];
  qtyDone?: number;
} = {}) {
  h.rpcCalls.length = 0;
  h.updateCalls.length = 0;
  const stage = {
    id: 'st1',
    item_id: 'it1',
    department_id: opts.deptId ?? GATED_DEPT.id,
    status: 'in_progress',
    qty_done: opts.qtyDone ?? 0,
    qty_rework: 0,
    depends_on: [],
    sort_order: 10,
    started_at: '2026-09-01T08:00:00Z',
    finished_at: null,
  };
  useErpStore.setState({
    departments: [GATED_DEPT, OPEN_DEPT] as never,
    bypasses: (opts.bypasses ?? []) as never,
    orders: [{
      id: 'o1',
      status: 'active',
      materials: (opts.materials ?? [PENDING_FABRIC]) as never,
      procurement_tasks: [],
      items: [{ id: 'it1', order_id: 'o1', qty: 100, stages: [stage] }],
    }] as never,
  });
  return stage;
}

const s = () => useErpStore.getState();

describe('гейт завершения этапа: ни один писатель не закрывает этап мимо него', () => {
  beforeEach(() => { seed(); });

  it('«Завершить этап» (setStageStatus done) — отказ, записи нет', async () => {
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(false);
    expect(h.updateCalls, 'этап не должен уходить в базу').toHaveLength(0);
  });

  it('«Частичная готовность» на весь остаток (reportProgress) — отказ, RPC нет', async () => {
    expect(await s().reportProgress('st1', 100)).toBe(false);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('«Записать результат» по схеме участка (submitStageReport) — отказ, RPC нет', async () => {
    // Тот самый четвёртый путь: до 03.09 он единственный шёл мимо гейта,
    // и именно он настроен у закроя и швейки
    expect(await s().submitStageReport('st1', { qtyGood: 100 })).toBe(false);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('частичная сдача при неприехавшем материале ЗАКОННА — цех отчитывается за сделанное', async () => {
    expect(await s().reportProgress('st1', 40)).toBe(true);
    expect(h.rpcCalls.map((c) => c.fn)).toContain('erp_stage_report_progress');
  });

  it('участок без gate_material_kinds не гейтится вовсе (fail-open)', async () => {
    seed({ deptId: OPEN_DEPT.id });
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(true);
  });

  it('материал пришёл И ПРИНЯТ складом — этап закрывается', async () => {
    seed({ materials: [{ ...PENDING_FABRIC, status: 'received', accept_status: 'accepted_full' }] });
    expect(await s().submitStageReport('st1', { qtyGood: 100 })).toBe(true);
  });

  /**
   * Один `received` не годится (обход 04.09): приёмка ставит его при любом
   * исходе, включая недостачу и отказ. Гейт запуска цеха вердикт спрашивает
   * с 22.07 — здесь та же формула, а не вторая её копия.
   */
  it('материал пришёл, но склад его не принял — этап НЕ закрывается', async () => {
    seed({ materials: [{ ...PENDING_FABRIC, status: 'received', accept_status: 'shortage' }] });
    expect(await s().submitStageReport('st1', { qtyGood: 100 })).toBe(false);
  });
});

/**
 * АВАРИЙНОЕ СНЯТИЕ ДЕЙСТВУЕТ И НА ЗАКРЫТИЕ (правка 03.09).
 *
 * Гейт завершения появился 30.08, аварийный режим — 10.08, и связать их
 * забыли: `materialsAfterBypass` звали только сборщики гейта ВХОДА. Директор
 * снимал проверку, цех брал задание в работу — и закрыть его не мог.
 * Половина выхода — не выход.
 */
describe('аварийное снятие материального гейта отпускает закрытие этапа', () => {
  const BYPASS = [{
    id: 'b1', kind: 'material_gate', order_id: 'o1', restored_at: null,
    reason: 'ткань на складе, статус не проставлен', created_by: 'Директор',
  }];

  it('снятие по заказу — все три писателя пропускают', async () => {
    seed({ bypasses: BYPASS });
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(true);
    seed({ bypasses: BYPASS });
    expect(await s().reportProgress('st1', 100)).toBe(true);
    seed({ bypasses: BYPASS });
    expect(await s().submitStageReport('st1', { qtyGood: 100 })).toBe(true);
  });

  it('возвращённое снятие (restored_at) снова держит гейт', async () => {
    seed({ bypasses: [{ ...BYPASS[0], restored_at: '2026-09-03T10:00:00Z' }] });
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(false);
  });
});
