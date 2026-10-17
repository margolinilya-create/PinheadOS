import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../model/factory';
import type { SalesOrder } from '../model/types';

/**
 * Прототип запуска заказа v4 в производство (веха 2, план п. 8 и «Проверка
 * безопасности» п. 1): `launch_check` → стор ERP (`createOrder`) → переход
 * `production`. Модули ERP и RPC Order замоканы: проверяется порядок шагов
 * и ветки отказа, а не сам ERP (его сторожат свои тесты).
 */
const log: string[] = [];

const transitions = vi.hoisted(() => ({
  launchCheck: vi.fn(),
  transitionOrder: vi.fn(),
}));
const erp = vi.hoisted(() => ({
  ensureDomainSlices: vi.fn(),
  loadBootstrap: vi.fn(),
  createOrder: vi.fn(),
  departments: [] as unknown[],
}));

vi.mock('../api/salesTransitions', () => transitions);
vi.mock('../../erp/lazyScreen', () => ({ ensureDomainSlices: erp.ensureDomainSlices }));
vi.mock('../../erp/store/useErpStore', () => ({
  useErpStore: {
    getState: () => ({
      departments: erp.departments,
      loadBootstrap: erp.loadBootstrap,
      createOrder: erp.createOrder,
    }),
  },
}));

const { launchToErp } = await import('./launch');

const ORDER_ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';

function order(patch: Partial<SalesOrder> = {}): SalesOrder {
  return newSalesOrder({
    id: ORDER_ID,
    number: 'PH-1234',
    status: 'ready_to_launch',
    title: 'Худи для фестиваля',
    items: [newSalesItem({
      product_type: 'Худи',
      size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Чёрный', sizes: { M: 10, L: 5 } }] },
    })],
    ...patch,
  });
}

beforeEach(() => {
  log.length = 0;
  vi.restoreAllMocks();
  erp.departments = [{ id: 'd-1', code: 'sewing' }];
  transitions.launchCheck.mockReset().mockImplementation(async () => {
    log.push('check');
    return { ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' };
  });
  transitions.transitionOrder.mockReset().mockImplementation(async (id: string, to: string) => {
    log.push(`transition:${to}`);
    return { id, status: to, erp_order_id: 'erp-1' };
  });
  erp.ensureDomainSlices.mockReset().mockImplementation(async () => { log.push('slices'); });
  erp.loadBootstrap.mockReset().mockImplementation(async () => { log.push('bootstrap'); });
  erp.createOrder.mockReset().mockImplementation(async () => {
    log.push('create');
    return { id: 'erp-1', items: [] };
  });
});

describe('launchToErp', () => {
  it('порядок: проверка → справочники → создание → переход', async () => {
    const r = await launchToErp(order());
    expect(log).toEqual(['check', 'slices', 'bootstrap', 'create', 'transition:production']);
    expect(transitions.launchCheck).toHaveBeenCalledWith(ORDER_ID);
    expect(transitions.transitionOrder).toHaveBeenCalledWith(ORDER_ID, 'production');
    expect(r).toEqual({ ok: true, erpOrderId: 'erp-1', alreadyLaunched: false, warnings: [] });
  });

  it('связь с заказом: tz_order_id = id, tz_number = номер заказа PH-XXXX', async () => {
    await launchToErp(order(), { launchDate: '2026-10-20' });
    const input = erp.createOrder.mock.calls[0][0];
    expect(input.tz_order_id).toBe(ORDER_ID);
    expect(input.tz_number).toBe('PH-1234');
    expect(input.launch_date).toBe('2026-10-20');
    expect(input.title).toBe('Худи для фестиваля');
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toMatchObject({ product_type: 'Худи', qty: 15 });
  });

  it('уже переведён (already без launch_started_at, миграция :734) — успех без перехода и без ERP', async () => {
    transitions.launchCheck.mockImplementation(async () => {
      log.push('check');
      return { ok: true, already: true, erp_order_id: 'erp-old' };
    });
    const r = await launchToErp(order({ status: 'production', erp_order_id: 'erp-old' }));
    expect(log).toEqual(['check']);
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, erpOrderId: 'erp-old', alreadyLaunched: true, warnings: [] });
  });

  it('сирота прошлой попытки (already с launch_started_at, миграция :755–760) — без ERP сразу переход', async () => {
    transitions.launchCheck.mockImplementation(async () => {
      log.push('check');
      return { ok: true, already: true, erp_order_id: 'erp-old', launch_started_at: '2026-10-17T09:00:00Z' };
    });
    transitions.transitionOrder.mockImplementation(async (id: string, to: string) => {
      log.push(`transition:${to}`);
      return { id, status: to, erp_order_id: 'erp-old' };
    });
    const r = await launchToErp(order());
    expect(log).toEqual(['check', 'transition:production']);
    expect(r).toEqual({ ok: true, erpOrderId: 'erp-old', alreadyLaunched: true, warnings: [] });
  });

  it('проверка не пройдена — причина сервера, stage check, ERP не трогается', async () => {
    transitions.launchCheck.mockResolvedValue({ ok: false, reason: 'Нет отметки оплаты' });
    const r = await launchToErp(order());
    expect(r).toEqual({ ok: false, stage: 'check', reason: 'Нет отметки оплаты' });
    expect(erp.ensureDomainSlices).not.toHaveBeenCalled();
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('ошибка проверки (null, тост уже показан) — stage check', async () => {
    transitions.launchCheck.mockResolvedValue(null);
    const r = await launchToErp(order());
    expect(r).toEqual({ ok: false, stage: 'check', reason: 'Не удалось проверить готовность к запуску' });
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('цеха не загрузились — stage bootstrap, заказ ERP не создаётся', async () => {
    erp.departments = [];
    const r = await launchToErp(order());
    expect(r).toEqual({
      ok: false, stage: 'bootstrap',
      reason: 'Справочники производства не загрузились — обновите страницу и повторите',
    });
    expect(erp.createOrder).not.toHaveBeenCalled();
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
  });

  it('модуль производства не загрузился (устаревшая вкладка) — stage bootstrap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    erp.ensureDomainSlices.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    const r = await launchToErp(order());
    expect(r).toMatchObject({ ok: false, stage: 'bootstrap' });
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('нет позиций с количеством — stage payload, заказ ERP не создаётся', async () => {
    const r = await launchToErp(order({
      items: [newSalesItem({ product_type: 'Худи' })],
    }));
    expect(r).toEqual({ ok: false, stage: 'payload', reason: 'В заказе нет позиций с количеством' });
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('createOrder null, повторная проверка «уже» — успех с id сервера (23505 этого же запуска)', async () => {
    erp.createOrder.mockImplementation(async () => { log.push('create'); return null; });
    let n = 0;
    transitions.launchCheck.mockImplementation(async () => {
      log.push('check');
      n += 1;
      return n === 1
        ? { ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' }
        : { ok: true, already: true, erp_order_id: 'erp-orphan', launch_started_at: '2026-10-17T10:00:00Z' };
    });
    transitions.transitionOrder.mockImplementation(async (id: string, to: string) => {
      log.push(`transition:${to}`);
      return { id, status: to, erp_order_id: 'erp-orphan' };
    });
    const r = await launchToErp(order());
    expect(log).toEqual(['check', 'slices', 'bootstrap', 'create', 'check', 'transition:production']);
    expect(r).toEqual({ ok: true, erpOrderId: 'erp-orphan', alreadyLaunched: false, warnings: [] });
  });

  it('createOrder null, повторная проверка — уже переведён параллельно: успех без перехода', async () => {
    erp.createOrder.mockResolvedValue(null);
    transitions.launchCheck
      .mockResolvedValueOnce({ ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' })
      .mockResolvedValueOnce({ ok: true, already: true, erp_order_id: 'erp-par' });
    const r = await launchToErp(order());
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, erpOrderId: 'erp-par', alreadyLaunched: true, warnings: [] });
  });

  it('createOrder бросил — как null: повторная проверка решает (заказ мог успеть создаться)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    erp.createOrder.mockRejectedValue(new Error('сбой после RPC'));
    transitions.launchCheck
      .mockResolvedValueOnce({ ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' })
      .mockResolvedValueOnce({ ok: true, already: true, erp_order_id: 'erp-1', launch_started_at: '2026-10-17T10:00:00Z' });
    const r = await launchToErp(order());
    expect(transitions.launchCheck).toHaveBeenCalledTimes(2);
    expect(r).toEqual({ ok: true, erpOrderId: 'erp-1', alreadyLaunched: false, warnings: [] });
  });

  it('сборка payload бросила — stage payload, заказ ERP не создаётся', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await launchToErp(order({
      items: [newSalesItem({ product_type: 'Худи', size_grid: undefined as never })],
    }));
    expect(r).toEqual({ ok: false, stage: 'payload', reason: 'Не удалось собрать заказ для производства' });
    expect(err).toHaveBeenCalled();
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('нет номера заказа — stage payload, сироту без связи не создаём', async () => {
    const r = await launchToErp(order({ number: '' }));
    expect(r).toEqual({ ok: false, stage: 'payload', reason: 'У заказа нет номера — обновите карточку' });
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('переход прошёл, но erp_order_id в ответе нет — stage transition, а не пустой id', async () => {
    transitions.transitionOrder.mockResolvedValue({ id: ORDER_ID, status: 'production', erp_order_id: null });
    const r = await launchToErp(order());
    expect(r).toMatchObject({ ok: false, stage: 'transition', erpOrderId: 'erp-1' });
  });

  it('createOrder null, повторная проверка — отказ: stage recheck с причиной сервера', async () => {
    erp.createOrder.mockResolvedValue(null);
    const conflict = 'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства';
    transitions.launchCheck
      .mockResolvedValueOnce({ ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' })
      .mockResolvedValueOnce({ ok: false, reason: conflict });
    const r = await launchToErp(order());
    expect(r).toEqual({ ok: false, stage: 'recheck', reason: conflict });
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
  });

  it('createOrder null, повторная проверка без заказа ERP — stage create', async () => {
    erp.createOrder.mockResolvedValue(null);
    transitions.launchCheck
      .mockResolvedValueOnce({ ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' })
      .mockResolvedValueOnce({ ok: true, already: false, launch_started_at: '2026-10-17T10:01:00Z' });
    const r = await launchToErp(order());
    expect(r).toEqual({ ok: false, stage: 'create', reason: 'Не удалось создать заказ в производстве' });
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
  });

  it('переход не прошёл — stage transition с id заказа ERP (повтор идемпотентен)', async () => {
    transitions.transitionOrder.mockResolvedValue(null);
    const r = await launchToErp(order());
    expect(r).toEqual({
      ok: false, stage: 'transition', erpOrderId: 'erp-1',
      reason: 'Заказ создан в производстве, но статус не обновился — повторите запуск',
    });
  });

  it('предупреждения моста доходят человеческим текстом с названием позиции', async () => {
    const r = await launchToErp(order({
      items: [
        newSalesItem({
          product_type: 'Худи',
          size_grid: { sizes: ['M'], rows: [{ color: '', sizes: { M: 3 } }] },
          prints: [newSalesPrint({ method: 'dtg' }), newSalesPrint({ method: 'sublimation' })],
        }),
        newSalesItem({ product_type: 'Футболка' }),
      ],
    }));
    expect(r.ok).toBe(true);
    const warnings = r.ok ? r.warnings : [];
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/^«Худи»: .*DTG/);
    expect(warnings[1]).toMatch(/^«Худи»: .*Сублимация/);
    expect(warnings[2]).toMatch(/^«Футболка»: .*не ушла в производство/);
    // позиция без количества в производство не едет
    expect(erp.createOrder.mock.calls[0][0].items).toHaveLength(1);
  });

  it('повторный клик во время запуска не создаёт второй заказ ERP', async () => {
    const [a, b] = await Promise.all([launchToErp(order()), launchToErp(order())]);
    expect(erp.createOrder).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    // после завершения запуск снова доступен
    await launchToErp(order());
    expect(transitions.launchCheck).toHaveBeenCalledTimes(2);
  });
});
