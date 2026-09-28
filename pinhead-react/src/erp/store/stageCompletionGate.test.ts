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
/** Участок с формой результата и без материального гейта — швейка без ткани в гейте */
const FORM_DEPT = {
  ...OPEN_DEPT, id: 'd-sew', code: 'sewing', name: 'Швейный цех',
  result_fields: [{ code: 'good', label: 'Сшито', target: 'qty_good' }],
};

/** Закрой как на проде: разбор по рулонам, без материального гейта в этом тесте */
const ROLLS_DEPT = { ...OPEN_DEPT, id: 'd-cut2', code: 'cutting', name: 'Закрой', result_detail: 'rolls' };
/** Ткань принята, рулон оставлен «в работе» с остатком и без вида */
const FABRIC_WITH_ROLL = {
  id: 'm2', order_id: 'o1', item_id: null, kind: 'fabric', name: 'Кулирка 180',
  status: 'received', accept_status: 'accepted_full',
  rolls: [{ id: 'r1', seq: 1, label: 'Рулон №1', status: 'in_use', qty: 20, qty_left: 5, leftover_kind: null, unit: 'кг' }],
};

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
    departments: [GATED_DEPT, OPEN_DEPT, FORM_DEPT, ROLLS_DEPT] as never,
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

/**
 * НЕ УЧТЁННЫЕ ИЗДЕЛИЯ ДЕРЖАТ ЗАКРЫТИЕ (правка заказчика 27.09, п. 7).
 *
 * «Блокировать обычное завершение этапа, пока остаются изделия в работе
 * или в переделке». Гейт у ПИСАТЕЛЯ: кнопка, дорожка канбана и чип доски
 * проходят через `setStageStatus`, и ни одной не нужно помнить о проверке.
 * Только у участка с формой результата — остальным нечем сдать иначе.
 */
describe('не учтённые изделия держат «Завершить этап» у участка с формой', () => {
  it('сдано 40 из 100 — отказ с числом, записи нет', async () => {
    seed({ deptId: FORM_DEPT.id, qtyDone: 40 });
    expect(await s().setStageStatus('st1', 'done', {})).toBe(false);
    expect(h.updateCalls).toHaveLength(0);
  });

  it('учтено всё — закрывается', async () => {
    seed({ deptId: FORM_DEPT.id, qtyDone: 100 });
    expect(await s().setStageStatus('st1', 'done', {})).toBe(true);
  });

  it('участок без формы результата закрывается тиражом, как прежде', async () => {
    seed({ deptId: OPEN_DEPT.id, qtyDone: 40 });
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(true);
  });
});

/**
 * СУДЬБА ОСТАТКА РУЛОНА ДЕРЖИТ ЗАКРЫТИЕ ЗАКРОЯ (правка заказчика 27.09, п. 2):
 * рулон «в работе» с остатком и без вида после закрытия повисает мимо
 * «Остатков ткани». Гейт у писателя — все три пути закрытия.
 */
describe('рулон без судьбы остатка держит закрытие закроя', () => {
  it('«Завершить этап» — отказ, записи нет', async () => {
    seed({ deptId: ROLLS_DEPT.id, materials: [FABRIC_WITH_ROLL], qtyDone: 100 });
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(false);
    expect(h.updateCalls).toHaveLength(0);
  });

  it('судьба выбрана — закрывается', async () => {
    seed({
      deptId: ROLLS_DEPT.id, qtyDone: 100,
      materials: [{ ...FABRIC_WITH_ROLL, rolls: [{ ...FABRIC_WITH_ROLL.rolls[0], status: 'used', leftover_kind: 'usable' }] }],
    });
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(true);
  });

  it('частичная сдача при таком рулоне законна — гейт только на закрытии', async () => {
    seed({ deptId: ROLLS_DEPT.id, materials: [FABRIC_WITH_ROLL], qtyDone: 0 });
    expect(await s().reportProgress('st1', 40)).toBe(true);
  });
});

/**
 * ПРОГРАММА ВЫШИВКИ РАНЬШЕ ВЫШИВКИ (правка заказчика 27.09, п. 3) — у писателя:
 * и кнопка, и сдача, добирающая тираж, и частичная готовность на остаток
 * закрыли бы вышивку без программы. Этап программы — той же позиции и того же
 * участка; программа другой позиции ограничение не снимает.
 */
describe('незавершённая программа вышивки держит закрытие вышивки', () => {
  const EMB_DEPT = { ...OPEN_DEPT, id: 'd-emb', code: 'embroidery', name: 'Вышивка' };
  const withProgram = (status: string) => {
    seed({ deptId: EMB_DEPT.id, qtyDone: 0 });
    useErpStore.setState((st) => ({
      departments: [...st.departments, EMB_DEPT] as never,
      orders: st.orders.map((o) => ({
        ...o,
        items: o.items.map((it) => ({
          ...it,
          stages: [...it.stages, {
            id: 'prog', item_id: 'it1', department_id: EMB_DEPT.id, status, qty_done: 0,
            qty_rework: 0, depends_on: [], sort_order: 5, result_kind: 'embroidery_program',
          }],
        })),
      })) as never,
    }));
  };

  /**
   * Правка 28.09: документ запрещает ЗАВЕРШЕНИЕ вышивки, а не сдачу части.
   * Закрытие (`setStageStatus('done')`) отказывает у писателя; сдача факта
   * уходит на сервер, а тот пишет количество и этап не закрывает, пока
   * программа не завершена (`erp_stage_program_block` в условии статуса).
   */
  it('закрытие отказывает, пока программа не завершена; сдача части — нет', async () => {
    withProgram('in_progress');
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(false);
    expect(h.updateCalls).toHaveLength(0);
    expect(await s().submitStageReport('st1', { qtyGood: 40 })).toBe(true);
    expect(h.rpcCalls.map((c) => c.fn)).toContain('erp_stage_submit_report');
  });

  it('программа завершена — вышивка закрывается', async () => {
    withProgram('done');
    expect(await s().setStageStatus('st1', 'done', { qty_done: 100 })).toBe(true);
  });
});
