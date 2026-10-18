import { describe, it, expect, beforeEach, vi } from 'vitest';
import { supabase } from '../../lib/supabase';
import { SALES_CLIENT_REV, rowToSalesOrder, salesOrderToPayload } from './salesOrders';
import {
  probeServerZoneNotes, rowKnowsZoneNotes, serverKnowsZoneNotes, __resetServerZoneNotesForTests, markServerZoneNotes,
} from './serverZoneNotes';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../model/factory';

/**
 * Клиент миграции K (веха 8, К5): код зоны у нанесения (`zone_id`) и
 * «Комментарий для цехов» (`orders.notes`), ревизия клиента 4.
 *
 * Окно «фронт ревизии 4 → K»: старый `order_v4_save` читает поля явно и молча
 * пропускает новые — поля уходят в сохранение, только когда сервер их знает
 * (`notes` в ответе сохранения или `zone_id` в строках нанесений при чтении).
 */

const order = () => newSalesOrder({
  id: 'o-1',
  notes: 'Упаковать по 10',
  items: [newSalesItem({ prints: [newSalesPrint({ zone: 'Грудь', zone_id: 'front' })] })],
});

beforeEach(() => { __resetServerZoneNotesForTests(); });

describe('ревизия клиента 4', () => {
  it('SALES_CLIENT_REV = 4 и уходит в каждом сохранении', () => {
    expect(SALES_CLIENT_REV).toBe(4);
    expect(salesOrderToPayload(order()).client_rev).toBe(4);
  });
});

describe('salesOrderToPayload — zone_id и notes только серверу, который их знает', () => {
  it('сервер не знает — ни notes, ни zone_id в payload нет', () => {
    const p = salesOrderToPayload(order());
    expect(p).not.toHaveProperty('notes');
    expect(p.items[0].prints[0]).not.toHaveProperty('zone_id');
    expect(p.items[0].prints[0].zone).toBe('Грудь');
  });

  it('сервер знает — notes и zone_id уходят', () => {
    const p = salesOrderToPayload(order(), null, { zoneNotes: true });
    expect(p.notes).toBe('Упаковать по 10');
    expect(p.items[0].prints[0].zone_id).toBe('front');
  });

  it('код зоны не по формату ZONE_ID_RE уходит null (сервер отказал бы 22023 всему сохранению)', () => {
    const o = newSalesOrder({ items: [newSalesItem({ prints: [
      newSalesPrint({ zone_id: 'Грудь' }), newSalesPrint({ zone_id: '' }), newSalesPrint({ zone_id: 'a'.repeat(64) }),
    ] })] });
    const p = salesOrderToPayload(o, null, { zoneNotes: true });
    expect(p.items[0].prints.map((x: { zone_id: unknown }) => x.zone_id)).toEqual([null, null, null]);
  });
});

describe('rowToSalesOrder — notes и zone_id', () => {
  it('читаются из строки; чужой код зоны — null', () => {
    const o = rowToSalesOrder({
      id: 'x', notes: 'Общее',
      order_items: [{ id: 'i', order_item_prints: [
        { id: 'p1', zone: 'Грудь', zone_id: 'front', sort_order: 0 },
        { id: 'p2', zone: 'Спина', zone_id: 'BAD id', sort_order: 1 },
        { id: 'p3', zone: 'Рукав', sort_order: 2 },
      ] }],
    });
    expect(o.notes).toBe('Общее');
    expect(o.items[0].prints.map((p) => p.zone_id)).toEqual(['front', null, null]);
  });

  it('строка без колонки notes — пустой комментарий', () => {
    expect(rowToSalesOrder({ id: 'x' }).notes).toBe('');
    expect(rowToSalesOrder({ id: 'x', notes: null }).notes).toBe('');
  });
});

describe('признак «сервер знает zone_id и notes»', () => {
  it('по чтению: у строки нанесения есть колонка zone_id (её добавляет K)', () => {
    expect(rowKnowsZoneNotes({ order_items: [{ order_item_prints: [{ id: 'p', zone_id: null }] }] })).toBe(true);
    expect(rowKnowsZoneNotes({ order_items: [{ order_item_prints: [{ id: 'p', zone: 'Грудь' }] }] })).toBe(false);
    // колонка notes была и до K — по ней одной судить нельзя
    expect(rowKnowsZoneNotes({ notes: null, order_items: [] })).toBe(false);
    expect(rowKnowsZoneNotes({})).toBe(false);
  });

  it('метка держится до сброса', () => {
    expect(serverKnowsZoneNotes()).toBe(false);
    markServerZoneNotes();
    expect(serverKnowsZoneNotes()).toBe(true);
    __resetServerZoneNotesForTests();
    expect(serverKnowsZoneNotes()).toBe(false);
  });
});

describe('probeServerZoneNotes — проба без записи', () => {
  const from = supabase.from as unknown as ReturnType<typeof vi.fn>;
  const answer = (result: unknown) => {
    const c = { select: vi.fn(() => c), limit: vi.fn(() => Promise.resolve(result)) };
    from.mockReturnValueOnce(c);
    return c;
  };

  it('колонка zone_id читается (limit 0) — сервер после K, метка ставится', async () => {
    const c = answer({ data: [], error: null });
    expect(await probeServerZoneNotes()).toBe(true);
    expect(from).toHaveBeenCalledWith('order_item_prints');
    expect(c.select).toHaveBeenCalledWith('zone_id');
    expect(c.limit).toHaveBeenCalledWith(0);
    expect(serverKnowsZoneNotes()).toBe(true);
    // узнанное — без повторного запроса
    from.mockClear();
    expect(await probeServerZoneNotes()).toBe(true);
    expect(from).not.toHaveBeenCalled();
  });

  it('до K (42703) или сбой сети — «не знает», метки нет', async () => {
    answer({ data: null, error: { code: '42703', message: 'column order_item_prints.zone_id does not exist' } });
    expect(await probeServerZoneNotes()).toBe(false);
    from.mockImplementationOnce(() => { throw new Error('Failed to fetch'); });
    expect(await probeServerZoneNotes()).toBe(false);
    expect(serverKnowsZoneNotes()).toBe(false);
  });
});
