import { describe, it, expect, vi, beforeEach } from 'vitest';
import { supabase } from '../../lib/supabase';
import { toast } from '../../store/useToastStore';
import { lastOverride, lastReturn, UNKNOWN_ACTOR } from './salesEvents';

/**
 * Журнал заказа v4 — только чтение: причина возврата и разрешение «без
 * оплаты» с именем сотрудника (`erp_employees`, т. к. чужие `profiles`
 * продавцу не видны).
 */
const from = supabase.from as unknown as ReturnType<typeof vi.fn>;

type Answer = { data: unknown; error: unknown };

/** Цепочка PostgREST: записывает вызовы, отдаёт ответ на `limit` */
function chain(answer: Answer) {
  const calls: [string, unknown[]][] = [];
  const c: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'not', 'order']) {
    c[m] = (...args: unknown[]) => { calls.push([m, args]); return c; };
  }
  c.limit = (...args: unknown[]) => { calls.push(['limit', args]); return Promise.resolve(answer); };
  return { c, calls };
}

function route(events: Answer, employees: Answer = { data: [{ full_name: 'Анна МС' }], error: null }) {
  const ev = chain(events);
  const emp = chain(employees);
  from.mockImplementation((t: string) => (t === 'order_events' ? ev.c : emp.c));
  return { ev, emp };
}

describe('lastReturn', () => {
  beforeEach(() => {
    from.mockReset();
    vi.restoreAllMocks();
  });

  it('последний возврат ready_to_launch → draft с именем сотрудника', async () => {
    const { ev, emp } = route({ data: [{ reason: 'нет размеров', actor: 'u-ms', at: '2026-10-18T10:00:00Z' }], error: null });
    expect(await lastReturn('o-1')).toEqual({ reason: 'нет размеров', actorName: 'Анна МС', at: '2026-10-18T10:00:00Z' });
    expect(ev.calls).toEqual([
      ['select', ['reason, actor, at']],
      ['eq', ['order_id', 'o-1']],
      ['eq', ['kind', 'status']],
      ['eq', ['from_status', 'ready_to_launch']],
      ['eq', ['to_status', 'draft']],
      ['order', ['at', { ascending: false }]],
      ['limit', [1]],
    ]);
    expect(emp.calls).toContainEqual(['eq', ['profile_id', 'u-ms']]);
  });

  it('возвратов не было — null', async () => {
    route({ data: [], error: null });
    expect(await lastReturn('o-1')).toBeNull();
  });

  it('сотрудника ERP нет — «сотрудник»', async () => {
    route({ data: [{ reason: 'r', actor: 'u-x', at: 't' }], error: null }, { data: [], error: null });
    expect((await lastReturn('o-1'))?.actorName).toBe(UNKNOWN_ACTOR);
  });

  it('ошибка журнала — тост и null', async () => {
    route({ data: null, error: { message: 'boom' } });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await lastReturn('o-1')).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });

  it('ошибка чтения имени — тост и null', async () => {
    route({ data: [{ reason: 'r', actor: 'u-x', at: 't' }], error: null }, { data: null, error: { message: 'x' } });
    const err = vi.spyOn(toast, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await lastReturn('o-1')).toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
  });
});

describe('lastOverride', () => {
  beforeEach(() => {
    from.mockReset();
    vi.restoreAllMocks();
  });

  it('событие оплаты с причиной', async () => {
    const { ev } = route({ data: [{ reason: 'постоянный клиент', actor: 'u-rop', at: 't' }], error: null });
    expect(await lastOverride('o-2')).toEqual({ reason: 'постоянный клиент', actorName: 'Анна МС', at: 't' });
    expect(ev.calls).toContainEqual(['eq', ['kind', 'payment']]);
    expect(ev.calls).toContainEqual(['not', ['reason', 'is', null]]);
  });

  it('нет разрешения — null', async () => {
    route({ data: [], error: null });
    expect(await lastOverride('o-2')).toBeNull();
  });
});
