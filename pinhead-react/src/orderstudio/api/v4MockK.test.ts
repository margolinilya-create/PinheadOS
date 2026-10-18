// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mockAnswersForTest as mock, type MockExtras } from '../../../e2e/support/mockSupabase';
import { K_TEXTS } from '../../../e2e/support/mock/orderV4Rpc';

/**
 * Мок e2e под сохранение миграции K (веха 8) и журнал признаков L: ревизия 4,
 * `notes` в ответе, проверки 22023, `zone_id` в строках нанесений; события
 * `sales_staff_events` на смену признака. Тексты со SQL сверяет `mockContract.test.ts`.
 */
const ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';

const draft = (row: Record<string, unknown> = {}): MockExtras => ({
  salesOrders: [{
    id: ID, schema_version: 4, status: 'draft', order_number: 'PH-9001', updated_at: 'v1', notes: 'было',
    order_items: [{ id: 'i1', order_item_prints: [{ id: 'p1', method: 'dtf', zone: 'Грудь' }] }],
    ...row,
  }],
});

const rpc = (body: Record<string, unknown>, extra: MockExtras) => mock.rpc('order_v4_save_full', { p_order: body }, extra) as
  { data?: Record<string, unknown>; error?: { code: string; message: string } };
const rowOf = (e: MockExtras) => (mock.table('orders', `schema_version=eq.4&id=eq.${ID}`, e) as Record<string, unknown>[])[0];
const items = (zone_id?: unknown) => [{ key: 'i1', prints: [{ key: 'p1', method: 'dtf', zone: 'Грудь', ...(zone_id === undefined ? {} : { zone_id }) }] }];

describe('мок order_v4_save_full = K', () => {
  it('ревизия 3 — «Вышло обновление»', () => {
    expect(rpc({ id: ID, client_rev: 3, items: [] }, draft()).error).toEqual({ code: 'P0001', message: K_TEXTS.outdated });
  });

  it('ревизия 4 — успех, notes в ответе; пустой комментарий → null в строке', () => {
    const e = draft();
    const r = rpc({ id: ID, client_rev: 4, notes: 'Упаковать по 10', items: items('front') }, e);
    expect(r.data).toMatchObject({ id: ID, notes: 'Упаковать по 10' });
    expect(rowOf(e)).toMatchObject({ notes: 'Упаковать по 10' });
    const p = (rowOf(e).order_items as { order_item_prints: Record<string, unknown>[] }[])[0].order_item_prints[0];
    expect(p.zone_id).toBe('front');
    rpc({ id: ID, client_rev: 4, notes: '', items: items(null) }, e);
    expect(rowOf(e).notes).toBeNull();
  });

  it('нет ключа notes — прежний комментарий; у нанесения всё равно колонка zone_id', () => {
    const e = draft();
    const r = rpc({ id: ID, client_rev: 4, items: items() }, e);
    expect(r.data?.notes).toBe('было');
    const p = (rowOf(e).order_items as { order_item_prints: Record<string, unknown>[] }[])[0].order_item_prints[0];
    expect(p).toHaveProperty('zone_id', null);
  });

  it('комментарий 2001 знак и код зоны не по формату — 22023 с текстом K', () => {
    expect(rpc({ id: ID, client_rev: 4, notes: 'а'.repeat(2001), items: [] }, draft()).error)
      .toEqual({ code: '22023', message: K_TEXTS.notesLong });
    for (const z of ['Грудь', '', 'a'.repeat(64)]) {
      expect(rpc({ id: ID, client_rev: 4, items: items(z) }, draft()).error, z)
        .toEqual({ code: '22023', message: K_TEXTS.badZone });
    }
  });
});

describe('мок журнала признаков (L)', () => {
  const staff = () => [{ id: 'u1', name: 'Петрова П.', role: 'manager', is_sales: false, is_ms: false }];

  it('смена признака — событие с actor и source=rpc; повтор того же значения — нет', () => {
    const e: MockExtras = { salesStaff: staff() };
    mock.rpc('sales_set_staff', { p_profile: 'u1', p_kind: 'sales', p_on: true }, e);
    mock.rpc('sales_set_staff', { p_profile: 'u1', p_kind: 'sales', p_on: true }, e);
    mock.rpc('sales_set_staff', { p_profile: 'u1', p_kind: 'ms', p_on: true }, e);
    const ev = mock.table('sales_staff_events', 'order=at.desc&limit=50', e) as Record<string, unknown>[];
    expect(ev.map((x) => [x.kind, x.on_value])).toEqual([['ms', true], ['sales', true]]);
    expect(ev[0]).toMatchObject({ profile_id: 'u1', actor: 'dev', source: 'rpc' });
  });
});
