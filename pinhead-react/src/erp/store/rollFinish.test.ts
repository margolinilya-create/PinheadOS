import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ЗАВЕРШЕНИЕ РУЛОНА — ОТДЕЛЬНОЕ ДЕЙСТВИЕ (правка заказчика 05.10, п. 5).
 *
 * «Списанный — потеря ткани, пригодный — доступен дальше; измеренный остаток
 * сохранить вместе с уточнением, историю расхода не стирать». Действие
 * собрано из двух существующих RPC: замер — `erp_material_roll_set_params`
 * (корректировка `length_refine`, строки расхода не трогаются), судьба —
 * `erp_roll_set_leftover` (непригодный — запись списания на позицию).
 */

const h = vi.hoisted(() => ({
  calls: [] as { fn: string; args: Record<string, unknown> }[],
  errors: {} as Record<string, { message: string } | null>,
}));

vi.mock('../../lib/supabase', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const query = (): any => {
    const q: any = {
      eq: () => q, is: () => q, in: () => q, order: () => q, select: () => q,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (res: any) => res({ data: [], error: null }),
      update: () => q, insert: () => q, upsert: () => q, delete: () => q,
    };
    return q;
  };
  return {
    supabase: {
      from: () => query(),
      rpc: (fn: string, args: Record<string, unknown>) => {
        h.calls.push({ fn, args });
        return Promise.resolve({ data: null, error: h.errors[fn] ?? null });
      },
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

const { useErpStore } = await import('./useErpStore');
const { attachDomainSlices } = await import('./domainSlices');
attachDomainSlices();

const ROLL = {
  id: 'r1', material_id: 'm1', seq: 1, label: 'Рулон №1', status: 'in_use', qty: 50,
  length_m: 111.11, length_source: 'calc', length_left_m: 71.11, leftover_kind: null,
};

beforeEach(() => {
  h.calls.length = 0;
  h.errors = {};
  useErpStore.setState({
    orders: [{
      id: 'o1', status: 'active', items: [], procurement_tasks: [],
      materials: [{ id: 'm1', kind: 'fabric', rolls: [ROLL] }],
    }] as never,
    fabricLeftovers: [] as never,
  });
  useErpStore.setState({ loadOne: vi.fn(async () => true) } as never);
});

const fns = () => h.calls.map((c) => c.fn);

describe('finishRoll', () => {
  it('без замера — только судьба остатка, пригодный остаток доступен дальше', async () => {
    const ok = await useErpStore.getState().finishRoll('r1', { kind: 'usable', itemId: 'it1' });
    expect(ok).toBe(true);
    expect(fns()).toEqual(['erp_roll_set_leftover']);
    expect(h.calls[0].args).toEqual({ p_roll_id: 'r1', p_kind: 'usable', p_item_id: 'it1' });
    // Остатки других заказов перечитываются: пригодный появится в выборе закроя
    expect(useErpStore.getState().fabricLeftovers).toBeNull();
    expect(useErpStore.getState().loadOne).toHaveBeenCalledWith('o1');
  });

  it('с замером — сначала уточнение метража с причиной, затем списание непригодного', async () => {
    const ok = await useErpStore.getState().finishRoll('r1', {
      kind: 'scrap', itemId: 'it1', refineLengthM: 110, reason: 'перемерили',
    });
    expect(ok).toBe(true);
    expect(fns()).toEqual(['erp_material_roll_set_params', 'erp_roll_set_leftover']);
    expect(h.calls[0].args).toMatchObject({
      p_roll_id: 'r1', p_length_m: 110, p_length_source: 'measured', p_reason: 'перемерили',
    });
    expect(h.calls[1].args).toMatchObject({ p_kind: 'scrap' });
  });

  it('уточнение не записалось — судьбу не трогаем', async () => {
    h.errors.erp_material_roll_set_params = { message: 'нет права' };
    const ok = await useErpStore.getState().finishRoll('r1', { kind: 'scrap', refineLengthM: 110 });
    expect(ok).toBe(false);
    expect(fns()).toEqual(['erp_material_roll_set_params']);
  });

  it('замер 0 — уточнение без выбора судьбы (решать нечего)', async () => {
    const ok = await useErpStore.getState().finishRoll('r1', { kind: null, refineLengthM: 40 });
    expect(ok).toBe(true);
    expect(fns()).toEqual(['erp_material_roll_set_params']);
  });
});
