import { describe, it, expect, vi, beforeEach } from 'vitest';
import { newSalesItem, newSalesOrder, newSalesPrint } from '../model/factory';
import type { SalesOrder } from '../model/types';
import type { TzCatalogs } from '../tz/model/tzDocTypes';
import { ERP_DUPLICATE_REASON } from '../api/erpFiles';
import type { CopyDeps } from './launchFiles';

/**
 * Запуск заказа v4 в производство (веха 2 + веха 6+7): `launch_check` →
 * стор ERP → `tzcheck` → копии в `erp-attachments` → `recheck` → `createOrder`
 * → переход `production` с id заказа ERP. Модули ERP, RPC Order и сверка ТЗ
 * замоканы; копии идут настоящим `launchFiles` с сетью в зависимостях.
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
const tz = vi.hoisted(() => ({ checkTzHashes: vi.fn() }));

vi.mock('../api/salesTransitions', () => transitions);
vi.mock('./tzCheck', () => tz);
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
const TZ = `orders/${ORDER_ID}/tz/aaaa-PH-1234-g12345678-c123456789ab-hoodie.pdf`;
const ART = `orders/${ORDER_ID}/logo/a.png`;
const PDF = new TextEncoder().encode('%PDF-1.7');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const CAT = {} as TzCatalogs;
const CHECK_OK = { ok: true, already: false, launched: false, launch_started_at: '2026-10-17T10:00:00Z', updated_at: 'v1' };

let uid = 0;
const randomId = () => `00000000-0000-4000-8000-${String(++uid).padStart(12, '0')}`;

const files = {
  download: vi.fn(),
  upload: vi.fn(),
  sanitize: (t: string) => ({ ok: true as const, svg: t }),
};

function order(patch: Partial<SalesOrder> = {}): SalesOrder {
  return newSalesOrder({
    id: ORDER_ID,
    number: 'PH-1234',
    status: 'ready_to_launch',
    title: 'Худи для фестиваля',
    items: [newSalesItem({
      product_type: 'Худи',
      tz_pdf_path: TZ,
      size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Чёрный', sizes: { M: 10, L: 5 } }] },
      prints: [newSalesPrint({ method: 'dtf', artwork_path: ART })],
    })],
    ...patch,
  });
}

const opts = (more = {}) => ({ catalogs: CAT, actor: 'u-ms', randomId, digest: null, files: files as unknown as CopyDeps, ...more });
const rpc = () => log.filter((s) => s !== 'upload');

beforeEach(() => {
  log.length = 0;
  uid = 0;
  vi.restoreAllMocks();
  erp.departments = [{ id: 'd-1', code: 'sewing' }];
  transitions.launchCheck.mockReset().mockImplementation(async () => {
    log.push('check');
    return CHECK_OK;
  });
  transitions.transitionOrder.mockReset().mockImplementation(async (id: string, to: string) => {
    log.push(`transition:${to}`);
    return { id, status: to, erp_order_id: 'erp-1', updated_at: 'v9', sent_at: null };
  });
  tz.checkTzHashes.mockReset().mockImplementation(async () => { log.push('tzcheck'); return { ok: true }; });
  files.download.mockReset().mockImplementation(async (_id: string, path: string) => new Blob([path === TZ ? PDF : PNG]));
  files.upload.mockReset().mockImplementation(async (path: string, body: Blob) => { log.push('upload'); return { ok: true, path, size: body.size }; });
  erp.ensureDomainSlices.mockReset().mockImplementation(async () => { log.push('slices'); });
  erp.loadBootstrap.mockReset().mockImplementation(async () => { log.push('bootstrap'); });
  erp.createOrder.mockReset().mockImplementation(async (input: { attachments?: unknown[] }) => {
    log.push('create');
    return { id: 'erp-1', items: [], attachments: (input.attachments ?? []).map(() => ({ kind: 'print' })) };
  });
});

describe('launchToErp', () => {
  it('порядок: проверка → справочники → tzcheck → копии → повторная проверка → создание → переход', async () => {
    const r = await launchToErp(order(), opts());
    expect(log).toEqual(['check', 'slices', 'bootstrap', 'tzcheck', 'upload', 'upload', 'check', 'create', 'transition:production']);
    expect(transitions.transitionOrder).toHaveBeenCalledWith(ORDER_ID, 'production', undefined, undefined, 'erp-1');
    expect(r).toEqual({
      ok: true, erpOrderId: 'erp-1', alreadyLaunched: false, warnings: [],
      patch: { id: ORDER_ID, updated_at: 'v9', status: 'production', erp_order_id: 'erp-1', sent_at: null },
    });
  });

  it('ход запуска (onStage) — по шагам, в порядке выполнения', async () => {
    const stages: string[] = [];
    await launchToErp(order(), opts({ onStage: (s: string) => stages.push(s) }));
    expect(stages).toEqual(['check', 'bootstrap', 'payload', 'tzcheck', 'files', 'recheck', 'create', 'transition']);
  });

  it('связь и секции: tz_order_id, tz_number; tz.documents и attachments непусты', async () => {
    await launchToErp(order(), opts({ launchDate: '2026-10-20' }));
    const input = erp.createOrder.mock.calls[0][0];
    expect(input.tz_order_id).toBe(ORDER_ID);
    expect(input.tz_number).toBe('PH-1234');
    expect(input.launch_date).toBe('2026-10-20');
    // Правило закупки ERP приезжает со шлюзом (`erpGateway`), а не импортом моста
    expect(input.purchase_required).toBe(true);
    expect(input.items).toHaveLength(1);
    expect(input.items[0]).toMatchObject({ product_type: 'Худи', qty: 15 });
    expect(input.tz.documents).toHaveLength(1);
    expect(input.tz.documents[0]).toMatchObject({ item_index: 0, mime_type: 'application/pdf', uploaded_by: 'u-ms' });
    expect(input.tz.documents[0].file_path).toMatch(/^tz\/v4-[0-9a-f-]{36}\/[0-9a-f-]{36}\/v1-tz\.pdf$/);
    expect(input.attachments).toHaveLength(1);
    expect(input.attachments[0]).toMatchObject({ item_index: 0, kind: 'print', print_key: input.items[0].prints[0].key });
  });

  it('уже запущен (launched: true) — успех без перехода, без ERP и без копий', async () => {
    transitions.launchCheck.mockImplementation(async () => {
      log.push('check');
      return { ok: true, already: true, launched: true, erp_order_id: 'erp-old', updated_at: 'v5' };
    });
    const r = await launchToErp(order({ status: 'production', erp_order_id: 'erp-old' }), opts());
    expect(log).toEqual(['check']);
    expect(files.upload).not.toHaveBeenCalled();
    expect(r).toEqual({ ok: true, erpOrderId: 'erp-old', alreadyLaunched: true, warnings: [], patch: { id: ORDER_ID, updated_at: 'v5', status: 'production', erp_order_id: 'erp-old' } });
  });

  it('сирота (already, launched: false; подлинность проверил сервер) — только переход с p_erp_order_id, без копий', async () => {
    transitions.launchCheck.mockImplementation(async () => {
      log.push('check');
      return { ok: true, already: true, launched: false, erp_order_id: 'erp-orphan', launch_started_at: '2026-10-17T09:00:00Z', updated_at: 'v2' };
    });
    transitions.transitionOrder.mockImplementation(async (id: string, to: string, _r: unknown, _e: unknown, erpId: string) => {
      log.push(`transition:${to}`);
      return { id, status: to, erp_order_id: erpId, updated_at: 'v3' };
    });
    const r = await launchToErp(order(), opts());
    expect(log).toEqual(['check', 'transition:production']);
    expect(transitions.transitionOrder).toHaveBeenCalledWith(ORDER_ID, 'production', undefined, undefined, 'erp-orphan');
    expect(files.upload).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, erpOrderId: 'erp-orphan', alreadyLaunched: true });
  });

  it('сирота без подлинности — сервер отвечает ok:false: отказ check, ничего не создаём', async () => {
    const foreign = 'Заказ ERP с этой связью создан не этим запуском — обратитесь к администратору';
    transitions.launchCheck.mockResolvedValue({ ok: false, launched: false, reason: foreign });
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'check', reason: foreign });
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
  });

  it('нет launched в ответе — сервер старой версии: отказ check', async () => {
    transitions.launchCheck.mockResolvedValue({ ok: true, already: true, erp_order_id: 'erp-old' });
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'check', reason: 'Сервер старой версии — обновите страницу' });
    expect(erp.ensureDomainSlices).not.toHaveBeenCalled();
  });

  it('проверка не пройдена (права ERP) — причина сервера, stage check, ERP не трогается', async () => {
    const rights = 'Нет прав производства на создание заказа и ТЗ — попросите администратора выдать должность в производстве (диспетчер, менеджер, начальник производства)';
    transitions.launchCheck.mockResolvedValue({ ok: false, launched: false, reason: rights });
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'check', reason: rights });
    expect(erp.ensureDomainSlices).not.toHaveBeenCalled();
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('ошибка проверки (null, тост уже показан) — stage check', async () => {
    transitions.launchCheck.mockResolvedValue(null);
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'check', reason: 'Не удалось проверить готовность к запуску' });
  });

  it('хэш ТЗ не совпал с данными — отказ tzcheck, копий нет', async () => {
    const mismatch = 'ТЗ не соответствует текущим данным заказа или справочникам — верните менеджеру, он отправит заново';
    tz.checkTzHashes.mockResolvedValue({ ok: false, reason: mismatch });
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'tzcheck', reason: mismatch });
    expect(files.download).not.toHaveBeenCalled();
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('нет справочников ТЗ — отказ tzcheck', async () => {
    const r = await launchToErp(order(), opts({ catalogs: null }));
    expect(r).toMatchObject({ ok: false, stage: 'tzcheck' });
    expect(files.upload).not.toHaveBeenCalled();
  });

  it('отказ копии (409) — stage files, createOrder не вызван', async () => {
    files.upload.mockResolvedValue({ ok: false, reason: ERP_DUPLICATE_REASON });
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'files', reason: ERP_DUPLICATE_REASON });
    expect(erp.createOrder).not.toHaveBeenCalled();
    expect(transitions.launchCheck).toHaveBeenCalledTimes(1);
  });

  it('заказ вернули менеджеру во время копий — recheck отказывает, createOrder не вызван', async () => {
    transitions.launchCheck
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce({ ok: false, launched: false, reason: 'Заказ не ожидает запуска' });
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'recheck', reason: 'Заказ не ожидает запуска' });
    expect(files.upload).toHaveBeenCalled();
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('новая попытка — новые ключи (повтор после сбоя не наступает на свои файлы)', async () => {
    files.upload.mockResolvedValueOnce({ ok: false, reason: ERP_DUPLICATE_REASON });
    await launchToErp(order(), opts());
    const firstKey = files.upload.mock.calls[0][0];
    files.upload.mockClear();
    await launchToErp(order(), opts());
    expect(files.upload.mock.calls.map((c) => c[0])).not.toContain(firstKey);
  });

  it('пост-проверка: стор ERP выбросил вложение — предупреждение в итоге', async () => {
    erp.createOrder.mockImplementation(async () => { log.push('create'); return { id: 'erp-1', items: [], attachments: [] }; });
    const r = await launchToErp(order(), opts());
    expect(r.ok).toBe(true);
    expect(r.ok ? r.warnings : []).toEqual(['1 макет не привязался к нанесениям и биркам — проверьте в производстве']);
  });

  it('цеха не загрузились — stage bootstrap, заказ ERP не создаётся', async () => {
    erp.departments = [];
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'bootstrap', reason: 'Справочники производства не загрузились — обновите страницу и повторите' });
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('модуль производства не загрузился (устаревшая вкладка) — stage bootstrap', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    erp.ensureDomainSlices.mockRejectedValue(new TypeError('Failed to fetch dynamically imported module'));
    const r = await launchToErp(order(), opts());
    expect(r).toMatchObject({ ok: false, stage: 'bootstrap' });
  });

  it('нет позиций с количеством — stage payload', async () => {
    const r = await launchToErp(order({ items: [newSalesItem({ product_type: 'Худи' })] }), opts());
    expect(r).toEqual({ ok: false, stage: 'payload', reason: 'В заказе нет позиций с количеством' });
    expect(erp.createOrder).not.toHaveBeenCalled();
  });

  it('сборка payload бросила — stage payload', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await launchToErp(order({ items: [newSalesItem({ product_type: 'Худи', size_grid: undefined as never })] }), opts());
    expect(r).toEqual({ ok: false, stage: 'payload', reason: 'Не удалось собрать заказ для производства' });
    expect(err).toHaveBeenCalled();
  });

  it('нет номера заказа — stage payload, сироту без связи не создаём', async () => {
    const r = await launchToErp(order({ number: '' }), opts());
    expect(r).toEqual({ ok: false, stage: 'payload', reason: 'У заказа нет номера — обновите карточку' });
  });

  it('createOrder null, проверка после — «уже» нашего запуска: переход с id сервера', async () => {
    erp.createOrder.mockResolvedValue(null);
    transitions.launchCheck
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce({ ok: true, already: true, launched: false, erp_order_id: 'erp-orphan', updated_at: 'v4' });
    transitions.transitionOrder.mockResolvedValue({ id: ORDER_ID, status: 'production', erp_order_id: 'erp-orphan', updated_at: 'v5' });
    const r = await launchToErp(order(), opts());
    expect(transitions.transitionOrder).toHaveBeenCalledWith(ORDER_ID, 'production', undefined, undefined, 'erp-orphan');
    expect(r).toMatchObject({ ok: true, erpOrderId: 'erp-orphan', alreadyLaunched: false });
  });

  it('createOrder null, проверка после — уже переведён параллельно: успех без перехода', async () => {
    erp.createOrder.mockResolvedValue(null);
    transitions.launchCheck
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce({ ok: true, already: true, launched: true, erp_order_id: 'erp-par', updated_at: 'v6' });
    const r = await launchToErp(order(), opts());
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, erpOrderId: 'erp-par', alreadyLaunched: true });
  });

  it('createOrder бросил — как null: проверка после решает', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    erp.createOrder.mockRejectedValue(new Error('сбой после RPC'));
    transitions.launchCheck
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce({ ok: true, already: true, launched: false, erp_order_id: 'erp-1', updated_at: 'v7' });
    const r = await launchToErp(order(), opts());
    expect(transitions.launchCheck).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ ok: true, erpOrderId: 'erp-1', alreadyLaunched: false });
  });

  it('createOrder null, проверка после — отказ: stage recheck с причиной сервера', async () => {
    erp.createOrder.mockResolvedValue(null);
    const conflict = 'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства';
    transitions.launchCheck
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce(CHECK_OK)
      .mockResolvedValueOnce({ ok: false, launched: false, reason: conflict });
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'recheck', reason: conflict });
    expect(transitions.transitionOrder).not.toHaveBeenCalled();
  });

  it('createOrder null, заказа ERP нет — stage create', async () => {
    erp.createOrder.mockResolvedValue(null);
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({ ok: false, stage: 'create', reason: 'Не удалось создать заказ в производстве' });
  });

  it('переход не прошёл — stage transition с id заказа ERP (повтор идемпотентен)', async () => {
    transitions.transitionOrder.mockResolvedValue(null);
    const r = await launchToErp(order(), opts());
    expect(r).toEqual({
      ok: false, stage: 'transition', erpOrderId: 'erp-1',
      reason: 'Заказ создан в производстве, но статус не обновился — повторите запуск',
    });
  });

  it('переход прошёл без erp_order_id — stage transition, а не пустой id', async () => {
    transitions.transitionOrder.mockResolvedValue({ id: ORDER_ID, status: 'production', erp_order_id: null });
    const r = await launchToErp(order(), opts());
    expect(r).toMatchObject({ ok: false, stage: 'transition', erpOrderId: 'erp-1' });
  });

  it('предупреждения моста доходят человеческим текстом с названием позиции', async () => {
    const r = await launchToErp(order({
      items: [
        newSalesItem({
          product_type: 'Худи', tz_pdf_path: TZ,
          size_grid: { sizes: ['M'], rows: [{ color: '', sizes: { M: 3 } }] },
          prints: [newSalesPrint({ method: 'dtg' }), newSalesPrint({ method: 'sublimation' })],
        }),
        newSalesItem({ product_type: 'Футболка' }),
      ],
    }), opts());
    expect(r.ok).toBe(true);
    const warnings = r.ok ? r.warnings : [];
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toMatch(/^«Худи»: .*DTG/);
    expect(warnings[1]).toMatch(/^«Худи»: .*Сублимация/);
    expect(warnings[2]).toMatch(/^«Футболка»: .*не ушла в производство/);
    expect(erp.createOrder.mock.calls[0][0].items).toHaveLength(1);
    // позиция без количества ТЗ не получает
    expect(erp.createOrder.mock.calls[0][0].tz.documents).toHaveLength(1);
  });

  it('повторный клик во время запуска не создаёт второй заказ ERP', async () => {
    const [a, b] = await Promise.all([launchToErp(order(), opts()), launchToErp(order(), opts())]);
    expect(erp.createOrder).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    await launchToErp(order(), opts());
    expect(erp.createOrder).toHaveBeenCalledTimes(2);
    expect(rpc().filter((s) => s === 'create')).toHaveLength(2);
  });
});
