import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * ИСПОЛНИТЕЛЬ ЭТАПА — ЭТО ЧЕЛОВЕК, ВЗЯВШИЙ ЗАДАНИЕ, А НЕ АВТОР ЖЕСТА.
 *
 * §3.2 обхода 04.09. Правка 03.09 распространила на переход в `in_progress`
 * ДВА поля разом — плановую дату и исполнителя, — хотя они отвечают на разные
 * вопросы. Дата принадлежит ЭТАПУ («когда сдать») и верна, кто бы работу
 * ни запустил. Исполнитель принадлежит ЧЕЛОВЕКУ («кто взял»), а диспетчер,
 * кликнувший чип на доске производства или перетащивший карточку канбана
 * в дорожку «В работе», задания не берёт: очередь цеха и страница задания
 * после его жеста показывали исполнителем ЕГО.
 *
 * Сторож проверяет ПИСАТЕЛЯ и обе стороны правила: голый переход исполнителя
 * не пишет, явный — пишет. Список экранов не нужен: третий вход пройдёт
 * через того же писателя.
 */

const h = vi.hoisted(() => ({ patches: [] as Record<string, unknown>[] }));

vi.mock('../../lib/supabase', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const query = (): any => {
    let rows: unknown[] = [];
    const q: any = {
      eq: () => q, is: () => q, in: () => q, order: () => q, select: () => q,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      then: (res: any) => res({ data: rows, error: null }),
      update: (patch: Record<string, unknown>) => {
        h.patches.push(patch); rows = [{ id: 'st1' }]; return q;
      },
      insert: () => q, upsert: () => q, delete: () => q,
    };
    return q;
  };
  return {
    supabase: {
      from: () => query(),
      rpc: () => Promise.resolve({ data: null, error: null }),
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
    },
  };
});

const { useErpStore } = await import('./useErpStore');
const { attachDomainSlices } = await import('./domainSlices');
attachDomainSlices();

const DEPT = {
  id: 'd-sew', code: 'sewing', name: 'Швейный цех',
  is_production: true, active: true, sort_order: 1, gate_material_kinds: [],
};

function seed() {
  h.patches.length = 0;
  useErpStore.setState({
    departments: [DEPT] as never,
    bypasses: [] as never,
    orders: [{
      id: 'o1', status: 'active', due_date: '2026-10-01', launch_date: '2026-09-01',
      materials: [], procurement_tasks: [],
      items: [{
        id: 'it1', order_id: 'o1', qty: 100,
        stages: [{
          id: 'st1', item_id: 'it1', department_id: DEPT.id, status: 'ready',
          qty_done: 0, qty_rework: 0, depends_on: [], sort_order: 10,
          planned_start: null, planned_end: null, started_at: null,
          finished_at: null, assignee: null,
        }],
      }],
    }] as never,
  });
}

const stagePatch = () => h.patches.find((p) => 'status' in p) ?? {};

describe('исполнитель этапа', () => {
  beforeEach(seed);

  it('голый перевод в работу (чип доски, дорожка канбана) исполнителя НЕ назначает', async () => {
    expect(await useErpStore.getState().setStageStatus('st1', 'in_progress')).toBe(true);
    expect(stagePatch()).not.toHaveProperty('assignee');
    expect(useErpStore.getState().orders[0].items[0].stages[0].assignee).toBeNull();
  });

  /**
   * Плановая дата — наоборот: она про этап, и без неё задание выпадает
   * из «Загрузки цехов», никогда не считается просроченным и не доходит
   * до колокола. Это правило 03.09 остаётся в силе.
   */
  it('плановую дату тот же голый переход ставит', async () => {
    await useErpStore.getState().setStageStatus('st1', 'in_progress');
    expect(stagePatch().planned_end).toBeTruthy();
  });

  it('«Взять в работу» из очереди исполнителя пишет — там человек говорит «беру»', async () => {
    await useErpStore.getState().setStageStatus('st1', 'in_progress', { assignee: 'Пётр' });
    expect(stagePatch().assignee).toBe('Пётр');
  });
});
