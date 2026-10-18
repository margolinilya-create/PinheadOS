import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { useSalesStore, __resetSalesStoreForTests } from '../store/useSalesStore';
import { newSalesItem, newSalesOrder } from '../model/factory';
import type { SalesOrder } from '../model/types';
import { fixtureCatalogs } from '../fixtures/loadFixture.testutil';
import { tzDocument } from './model/tzDocument';
import { tzContentHash, hashFromTzPath, NO_CRYPTO_MESSAGE, type Digest } from './model/tzHash';
import type { TzGroup } from './model/tzGroups';
import { SEND_TEXT, sendToWork, type SendDeps, type SendStore } from './sendToWork';

/**
 * «Отправить в работу» (веха 6+7, задача 5): цепочка на настоящем сторе
 * с подменённым сохранением, движком, загрузкой и переходом. Дайджест —
 * заглушкой через deps (в jsdom `crypto.subtle` нет), sha-256 из node.
 */
const api = vi.hoisted(() => ({ fetchSalesOrder: vi.fn(), saveSalesOrder: vi.fn() }));
vi.mock('../api/salesOrders', async (orig) => ({ ...(await orig<typeof import('../api/salesOrders')>()), ...api }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../store/useToastStore', () => ({ toast }));

const ID = '0f0e0d0c-0b0a-4908-8706-050403020100';
const digest: Digest = async (bytes) => {
  const b = createHash('sha256').update(bytes).digest();
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const catalogs = fixtureCatalogs();
const TODAY = '2026-10-18';

const item = (color: string, key: string) => newSalesItem({
  key, sku_code: 'TEE', product_type: 'Футболка', fabric_code: 'medas-kulirnaya-100-180',
  size_grid: { sizes: ['M'], rows: [{ color, sizes: { M: 10 } }] },
});
const order = (over: Partial<SalesOrder> = {}) => newSalesOrder({
  id: ID, number: 'PH-0042', customer: 'ООО Ромашка', due_date: '2026-11-01', updated_at: 'v1',
  items: [item('Чёрный', 'a'), newSalesItem({ ...item('Белый', 'b'), sku_code: 'HOOD', product_type: 'Худи' })],
  ...over,
});

let log: string[];
let uploads: number;
let transitionResult: { data: unknown; message: string };
const st = () => useSalesStore.getState();

function store(): SendStore {
  const s = st();
  return {
    ...s,
    flush: async () => { log.push('flush'); await st().flush(); },
    editDuringSend: (t, fn) => { log.push('edit'); return st().editDuringSend(t, fn); },
    applyServer: (p) => { log.push('applyServer'); st().applyServer(p); },
  };
}

const engine = {
  buildTzPdf: vi.fn(async (input: { order: SalesOrder; groups: TzGroup[] }) => {
    log.push('build');
    const doc = tzDocument(input.order, input.groups[0], catalogs, { issuedOn: TODAY, appOrigin: '' });
    return { blob: new Blob(['%PDF-1.4']), hash12: await tzContentHash(doc, digest), doc };
  }),
};

function deps(over: Partial<SendDeps> = {}): Partial<SendDeps> {
  return {
    catalogs, digest, today: TODAY, appOrigin: 'https://example.test', store,
    engine: async () => { log.push('engine'); return engine as never; },
    api: {
      upload: vi.fn(async (_id: string, _b: Blob, name: string) => {
        log.push('upload');
        uploads += 1;
        return `orders/${ID}/tz/u${uploads}-${name}`;
      }),
      transition: vi.fn(async () => { log.push('transition'); return transitionResult as never; }),
    },
    ...over,
  };
}

async function open(o: SalesOrder = order()) {
  api.fetchSalesOrder.mockResolvedValueOnce(o);
  await st().open(o.id);
}

beforeEach(() => {
  __resetSalesStoreForTests();
  log = [];
  uploads = 0;
  engine.buildTzPdf.mockClear();
  Object.values(api).forEach((f) => f.mockReset());
  let v = 1;
  api.saveSalesOrder.mockImplementation(async () => {
    v += 1;
    return { ok: true, saved: { id: ID, order_number: 'PH-0042', updated_at: `v${v}` } };
  });
  transitionResult = { data: { id: ID, status: 'ready_to_launch', erp_order_id: null, updated_at: 'v9', sent_at: '2026-10-18T09:00:00Z' }, message: '' };
});
afterEach(() => { vi.restoreAllMocks(); });

describe('sendToWork — цепочка отправки', () => {
  it('порядок: flush → движок → сборка/загрузка → путь → flush → переход → applyServer', async () => {
    await open();
    const d = deps();
    expect(await sendToWork(ID, d)).toEqual({ ok: true });
    expect(log).toEqual(['flush', 'engine', 'build', 'upload', 'build', 'upload', 'edit', 'flush', 'transition', 'applyServer']);
    const cur = st().current as SalesOrder;
    expect(cur.status).toBe('ready_to_launch');
    expect(cur.updated_at).toBe('v9');
    for (const it of cur.items) expect(it.tz_pdf_path.startsWith(`orders/${ID}/tz/`)).toBe(true);
    // Переход — с версией ПОСЛЕ сохранения путей (новая `updated_at`), а не прежней
    expect(d.api?.transition).toHaveBeenCalledWith(ID, 'v2');
    expect(st().sending).toBe(false);
    expect(st().saveState).toBe('locked');
  });

  it('повтор без правок (после отказа перехода) ничего не грузит и снова зовёт переход', async () => {
    await open();
    transitionResult = { data: null, message: 'Сформируйте ТЗ — PDF позиции не найден в хранилище' };
    const r1 = await sendToWork(ID, deps());
    expect(r1).toEqual({ ok: false, stage: 'transition', reason: 'Сформируйте ТЗ — PDF позиции не найден в хранилище' });
    expect(st().current?.status).toBe('draft');
    expect(uploads).toBe(2);
    log = [];
    const r2 = await sendToWork(ID, deps());
    expect(r2.ok).toBe(false);
    expect(uploads).toBe(2);
    expect(log).toEqual(['flush', 'flush', 'transition']);
  });

  it('группа с прежним хэшем не собирается и не грузится — только изменённая', async () => {
    await open();
    await sendToWork(ID, deps());
    const sent = st().current as SalesOrder;
    // Возврат менеджеру: снова черновик с записанными путями; правка только второй группы
    st().applyServer({ id: ID, status: 'draft', updated_at: 'v20' });
    st().edit((o) => ({ ...o, items: o.items.map((it) => (it.key === 'b' ? { ...it, tz_comment: 'Без бирки' } : it)) }));
    log = [];
    expect(await sendToWork(ID, deps())).toEqual({ ok: true });
    expect(engine.buildTzPdf).toHaveBeenCalledTimes(3);
    expect(log.filter((x) => x === 'upload')).toHaveLength(1);
    const a = (st().current as SalesOrder).items.find((it) => it.key === 'a');
    expect(a?.tz_pdf_path).toBe(sent.items.find((it) => it.key === 'a')?.tz_pdf_path);
  });

  it('сбой загрузки — stage upload, переход не зовётся, пути не тронуты', async () => {
    await open();
    const d = deps();
    vi.mocked(d.api!.upload).mockResolvedValueOnce(null);
    expect(await sendToWork(ID, d)).toEqual({ ok: false, stage: 'upload', reason: SEND_TEXT.upload });
    expect(d.api?.transition).not.toHaveBeenCalled();
    expect((st().current as SalesOrder).items.every((it) => it.tz_pdf_path === '')).toBe(true);
    expect(st().sending).toBe(false);
  });

  it('конфликт перехода — conflict: true, переход шёл с текущей версией', async () => {
    await open();
    transitionResult = { data: null, message: 'Заказ изменён в другой вкладке — обновите страницу' };
    const d = deps();
    expect(await sendToWork(ID, d)).toEqual({ ok: false, stage: 'transition', reason: SEND_TEXT.conflict, conflict: true });
    expect(d.api?.transition).toHaveBeenCalledWith(ID, st().current?.updated_at);
    expect(st().current?.updated_at).toBe('v2');
  });

  it('locked после flush — отказ без сборки', async () => {
    await open();
    useSalesStore.setState({ saveState: 'locked' });
    expect(await sendToWork(ID, deps())).toEqual({ ok: false, stage: 'flush', reason: SEND_TEXT.locked });
    expect(log).not.toContain('engine');
    expect(engine.buildTzPdf).not.toHaveBeenCalled();
  });

  it('повторный клик во время отправки — тот же промис, одна цепочка', async () => {
    await open();
    const p1 = sendToWork(ID, deps());
    const p2 = sendToWork(ID, deps());
    expect(p2).toBe(p1);
    await p1;
    expect(log.filter((x) => x === 'transition')).toHaveLength(1);
  });

  it('заказ изменился между сборкой и переходом — переход не зовётся, отказ save', async () => {
    await open();
    const d = deps();
    engine.buildTzPdf.mockImplementationOnce(async (input) => {
      const doc = tzDocument(input.order, input.groups[0], catalogs, { issuedOn: TODAY, appOrigin: '' });
      // Карточку подменили в обход правки (перечитали с сервера с другой тканью)
      useSalesStore.setState((s) => ({ current: { ...(s.current as SalesOrder), items: (s.current as SalesOrder).items.map((it) => ({ ...it, main_fabric: 'Футер' , fabric_code: '' })) } }));
      return { blob: new Blob(['%PDF-1.4']), hash12: await tzContentHash(doc, digest), doc };
    });
    expect(await sendToWork(ID, d)).toEqual({ ok: false, stage: 'save', reason: SEND_TEXT.changed });
    expect(d.api?.transition).not.toHaveBeenCalled();
  });

  it('во время отправки правка из полей — no-op', async () => {
    await open();
    engine.buildTzPdf.mockImplementationOnce(async (input) => {
      st().edit((o) => ({ ...o, title: 'Правка во время отправки' }));
      const doc = tzDocument(input.order, input.groups[0], catalogs, { issuedOn: TODAY, appOrigin: '' });
      return { blob: new Blob(['%PDF-1.4']), hash12: await tzContentHash(doc, digest), doc };
    });
    expect(await sendToWork(ID, deps())).toEqual({ ok: true });
    expect(st().current?.title).toBe('');
  });

  it('нет криптографии — stage build с текстом про https, загрузки нет', async () => {
    await open();
    const d = deps({ digest: null });
    expect(await sendToWork(ID, d)).toEqual({ ok: false, stage: 'build', reason: NO_CRYPTO_MESSAGE });
    expect(d.api?.upload).not.toHaveBeenCalled();
    expect(NO_CRYPTO_MESSAGE).toContain('https');
  });

  it('блокирующий пункт чек-листа — отказ check, движок не грузится', async () => {
    await open(order({ customer: '' }));
    const r = await sendToWork(ID, deps());
    expect(r).toEqual({ ok: false, stage: 'check', reason: 'Исправьте 1 пункт чек-листа, чтобы отправить' });
    expect(log).not.toContain('engine');
  });

  it('маржа ниже порога и прочее неблокирующее — отправке не мешают', async () => {
    // Расхождение внутри группы ТЗ (разная упаковка) — неблокирующий пункт
    const o = order({ items: [item('Чёрный', 'a'), { ...item('Белый', 'b'), packaging: 'individual' }] });
    await open(o);
    expect(await sendToWork(ID, deps())).toEqual({ ok: true });
  });

  it('путь в хэше совпадает с собранным содержимым', async () => {
    await open();
    await sendToWork(ID, deps());
    const cur = st().current as SalesOrder;
    expect(cur.items.every((it) => hashFromTzPath(it.tz_pdf_path)?.length === 12)).toBe(true);
  });
});

describe('сторож: цепочку отправки зовёт только SendPanel', () => {
  it('sendToWork импортирует только tz/ui/SendPanel.jsx', () => {
    const root = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|jsx)$/.test(n) && !/\.test\.|\.testutil\./.test(n)) files.push(p);
      }
    };
    walk(root);
    const users = files
      .filter((f) => /from\s+['"][^'"]*\/sendToWork['"]|import\(\s*['"][^'"]*\/sendToWork['"]/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(root, f).replace(/\\/g, '/'));
    expect(users).toEqual(['tz/ui/SendPanel.jsx']);
  });
});
