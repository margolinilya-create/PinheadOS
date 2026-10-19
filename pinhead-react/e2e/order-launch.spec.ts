import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, type MockCall } from './support/mockSupabase';
import { v4State } from './support/mock/orderV4Rpc';
import { erpUploadsByAttempt } from './support/mock/storageBuckets';

/**
 * Запуск заказа v4 в производство (`orderstudio/bridge/launch.ts`; веха 2 —
 * прототип, веха 6+7 — с ТЗ и макетами): настоящий supabase-js, настоящий стор
 * ERP (ленивые чанки), настоящие копии в `erp-attachments`, мок сети.
 * Проверяется ПУТЬ ПО СЕТИ: какие RPC и в каком порядке уходят, что связь
 * `tz_order_id`/`tz_number`, `tz.documents` и `attachments` доезжают до
 * `erp_create_order`, а переход получает id заказа ERP этого запуска.
 *
 * Мок `erp_create_order` отвечает id, которого нет в фикстуре `erp_orders`,
 * поэтому `createOrder` стора отдаёт `null` — и клиент обязан спросить
 * `order_v4_launch_check` повторно (та же ветка, что у 23505 на бою).
 */
const ORDER_ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const CONFLICT = 'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства';
const PDF = Buffer.from('%PDF-1.7\n% ТЗ\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

type Objects = Record<string, { type: string; body: Buffer }>;
type LaunchArgs = { items: number; withArtwork: boolean };

/**
 * Заказ собирается В СТРАНИЦЕ теми же модулями, что у отправки: путь PDF ТЗ
 * несёт хэши группы и содержимого по пустым справочникам (их же получает
 * запуск), иначе `tzcheck` откажет. Возвращает пути файлов для мока Storage.
 */
async function prepare(page: Page, args: LaunchArgs): Promise<{ tz: string[]; art: string[] }> {
  return page.evaluate(async ({ orderId, items, withArtwork }) => {
    const f = await import('/src/orderstudio/model/factory.ts');
    const { tzGroups } = await import('/src/orderstudio/tz/model/tzGroups.ts');
    const { tzDocument } = await import('/src/orderstudio/tz/model/tzDocument.ts');
    const { tzContentHash } = await import('/src/orderstudio/tz/model/tzHash.ts');
    const { tzFileName } = await import('/src/orderstudio/tz/model/tzFileName.ts');
    const cat = {
      fabricsCatalog: [], extrasCatalog: [], labelLibrary: null, packOptions: [], zonesCatalog: [],
      garmentFlats: null, suppliers: [], tzSettings: null,
    };
    const art = `orders/${orderId}/logo/11111111-2222-4333-8444-555555555555-logo.png`;
    const order = f.newSalesOrder({
      id: orderId, number: 'PH-9001', status: 'ready_to_launch', title: 'Худи для фестиваля', customer: 'ООО Ромашка',
      items: Array.from({ length: items }, (_, i) => f.newSalesItem({
        product_type: 'Худи',
        size_grid: { sizes: ['M', 'L'], rows: [{ color: i === 0 ? 'Чёрный' : `Цвет ${i}`, sizes: { M: 10, L: 5 } }] },
        prints: withArtwork ? [f.newSalesPrint({ method: 'dtf', zone: 'Грудь', width_mm: 100, height_mm: 100, artwork_path: art })] : [],
      })),
    });
    const tz: string[] = [];
    for (const g of tzGroups(order)) {
      const doc = tzDocument(order, g, cat as never, { issuedOn: '2026-10-18', appOrigin: 'https://pinhead-os.vercel.app' });
      const path = `orders/${orderId}/tz/66666666-7777-4888-9999-aaaaaaaaaaaa-${tzFileName(order, g, doc, await tzContentHash(doc))}`;
      for (const it of g.items) it.tz_pdf_path = path;
      tz.push(path);
    }
    (window as unknown as { __launch: unknown }).__launch = { order, cat };
    return { tz, art: withArtwork ? [art] : [] };
  }, { orderId: ORDER_ID, ...args });
}

/** Запуск подготовленного заказа (как экран: дата, справочники, кто запускает) */
async function launch(page: Page) {
  return page.evaluate(async () => {
    const { launchToErp } = await import('/src/orderstudio/bridge/launch.ts');
    const { order, cat } = (window as unknown as { __launch: { order: never; cat: never } }).__launch;
    return launchToErp(order, { launchDate: '2026-10-20', catalogs: cat, actor: 'dev' });
  });
}

async function start(page: Page, extra: Parameters<typeof installSupabaseMock>[1], args: LaunchArgs = { items: 1, withArtwork: false }) {
  const objects: Objects = (extra.storageObjects ??= {});
  await installSupabaseMock(page, extra);
  await page.goto('/?studio=1');
  await expect(page.locator('#root')).not.toBeEmpty();
  const files = await prepare(page, args);
  for (const p of files.tz) objects[`order-artworks/${p}`] = { type: 'application/pdf', body: PDF };
  for (const p of files.art) objects[`order-artworks/${p}`] = { type: 'image/png', body: PNG };
  extra.calls?.splice(0);
  return files;
}

const LAUNCH_RPCS = new Set([
  'order_v4_launch_check', 'erp_bootstrap', 'erp_create_order', 'order_v4_transition',
]);
const rpcs = (calls: MockCall[]) => calls.filter((c) => c.kind === 'rpc' && LAUNCH_RPCS.has(c.name));

test('запуск: проверка → справочники ERP → копии → повторная проверка → erp_create_order со связью → переход', async ({ page }) => {
  const calls: MockCall[] = [];
  await start(page, { calls });

  const r = await launch(page);
  expect(r).toMatchObject({ ok: true, erpOrderId: 'mock-erp-order-1', alreadyLaunched: false, warnings: [] });

  const rpc = rpcs(calls);
  expect(rpc.map((c) => c.name)).toEqual([
    'order_v4_launch_check',
    'erp_bootstrap',
    // recheck после копий продлевает метку
    'order_v4_launch_check',
    'erp_create_order',
    // createOrder вернул null (loadOne не нашёл) — сервер подтверждает «наш»
    'order_v4_launch_check',
    'order_v4_transition',
  ]);
  expect(rpc[0].body).toEqual({ p_id: ORDER_ID });

  const payload = (rpc[3].body as { payload: { order: Record<string, unknown>; items: Record<string, unknown>[] } }).payload;
  expect(payload.order).toMatchObject({
    tz_order_id: ORDER_ID, tz_number: 'PH-9001', title: 'Худи для фестиваля', customer: 'ООО Ромашка',
    launch_date: '2026-10-20', status: 'active',
  });
  expect(payload.items).toHaveLength(1);
  expect(payload.items[0]).toMatchObject({ product_type: 'Худи', qty: 15 });
  expect((payload.items[0].stages as unknown[]).length).toBeGreaterThan(0);

  expect(rpc[5].body).toEqual({ p_id: ORDER_ID, p_to: 'production', p_reason: null, p_erp_order_id: 'mock-erp-order-1' });
});

test('запуск с ТЗ и макетами: tz.documents по числу позиций, макеты — к нанесениям, копии в erp-attachments', async ({ page }) => {
  const calls: MockCall[] = [];
  const extra = { calls, storageObjects: {} as Objects };
  await start(page, extra, { items: 2, withArtwork: true });

  const r = await launch(page);
  expect(r.ok).toBe(true);

  const body = v4State(extra).erpCreates[0] as { tz: { documents: Record<string, unknown>[] }; attachments: Record<string, unknown>[] };
  expect(body.tz.documents).toHaveLength(2);
  expect(body.tz.documents.map((d) => d.item_index)).toEqual([0, 1]);
  expect(new Set(body.tz.documents.map((d) => d.group_id)).size).toBe(2);
  for (const d of body.tz.documents) {
    expect(d.file_path).toMatch(/^tz\/v4-[0-9a-f-]{36}\/[0-9a-f-]{36}\/v1-tz\.pdf$/);
    expect(String(d.file_path)).not.toContain(ORDER_ID);
    expect(d.mime_type).toBe('application/pdf');
  }
  expect(body.attachments).toHaveLength(2);
  // стор ERP перевёл ключ нанесения в номер — ни один макет не выпал (ключи взяты из тех же draftItems)
  expect(body.attachments.map((a) => [a.kind, a.item_index, a.print_index, 'print_key' in a])).toEqual([
    ['print', 0, 0, false],
    ['print', 1, 0, false],
  ]);
  for (const a of body.attachments) expect(a.file_path).toMatch(/^att\/v4-[0-9a-f-]{36}\/print\/[0-9a-f-]{36}\.png$/);
  expect(v4State(extra).attachments).toHaveLength(2);
  const uploads = calls.filter((c) => c.kind === 'storage' && String(c.name).includes('erp-attachments'));
  expect(uploads.length).toBe(4);
  expect([...erpUploadsByAttempt(extra).values()]).toEqual([4]);
});

test('файл макета больше 30 МБ — отказ шага files, заказ ERP не создан', async ({ page }) => {
  const calls: MockCall[] = [];
  const extra = { calls, storageObjects: {} as Objects };
  const files = await start(page, extra, { items: 1, withArtwork: true });
  extra.storageObjects[`order-artworks/${files.art[0]}`] = { type: 'image/png', body: Buffer.concat([PNG, Buffer.alloc(31 * 1024 * 1024)]) };

  const r = await launch(page);
  expect(r).toMatchObject({ ok: false, stage: 'files' });
  expect((r as { reason: string }).reason).toMatch(/больше 30 МБ/);
  expect(rpcs(calls).map((c) => c.name)).not.toContain('erp_create_order');
});

test('Storage отказал копии 413 — отказ шага files с причиной, заказ ERP не создан', async ({ page }) => {
  const calls: MockCall[] = [];
  const extra = { calls, storageObjects: {} as Objects };
  await start(page, extra, { items: 1, withArtwork: true });
  // Писатель шлёт POST в erp-attachments; ответ сервера — «слишком большой» (лимит бакета)
  await page.route('**/storage/v1/object/erp-attachments/**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 413, contentType: 'application/json',
      body: JSON.stringify({ statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' }),
    });
  });

  const r = await launch(page);
  expect(r).toMatchObject({ ok: false, stage: 'files' });
  expect((r as { reason: string }).reason).toMatch(/^Файл не скопирован в производство/);
  expect(rpcs(calls).map((c) => c.name)).not.toContain('erp_create_order');
  expect(v4State(extra).erpCreates).toHaveLength(0);
});

test('createOrder прошёл, переход упал → повтор: проверка отвечает «уже» — только переход, без копий и без второго заказа ERP', async ({ page }) => {
  const calls: MockCall[] = [];
  const extra = { calls, storageObjects: {} as Objects };
  await start(page, extra, { items: 1, withArtwork: true });
  // Первый переход в production падает 500 (сеть / сервер), повтор проходит
  let failed = false;
  await page.route('**/rest/v1/rpc/order_v4_transition', async (route) => {
    if (!failed) {
      failed = true;
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '500', message: 'boom' }) });
      return;
    }
    await route.fallback();
  });

  const first = await launch(page);
  expect(first).toMatchObject({ ok: false, stage: 'transition', erpOrderId: 'mock-erp-order-1' });
  const uploadsAfterFirst = [...erpUploadsByAttempt(extra).values()].reduce((a, b) => a + b, 0);
  calls.splice(0);

  const again = await launch(page);
  expect(again).toMatchObject({ ok: true, erpOrderId: 'mock-erp-order-1', alreadyLaunched: true });
  expect(rpcs(calls).map((c) => c.name)).toEqual(['order_v4_launch_check', 'order_v4_transition']);
  expect([...erpUploadsByAttempt(extra).values()].reduce((a, b) => a + b, 0)).toBe(uploadsAfterFirst);
  expect(v4State(extra).erpCreates).toHaveLength(1);
});

test('запуск: заказ уже запущен и сдан — успех без перехода (launched: true)', async ({ page }) => {
  const calls: MockCall[] = [];
  await start(page, { calls, launch: { status: 'done' } });

  const r = await launch(page);
  expect(r).toMatchObject({ ok: true, erpOrderId: 'mock-erp-order-1', alreadyLaunched: true, warnings: [] });
  expect(rpcs(calls).map((c) => c.name)).toEqual(['order_v4_launch_check']);
});

test('запуск: чужой заказ ERP с той же связью — отказ проверки после create, перехода нет', async ({ page }) => {
  const calls: MockCall[] = [];
  await start(page, {
    calls,
    launch: {
      checks: [
        { ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' },
        { ok: true, already: false, launch_started_at: '2026-10-17T10:00:30Z' },
        { ok: false, launched: false, reason: CONFLICT },
      ],
    },
  });

  const r = await launch(page);
  expect(r).toEqual({ ok: false, stage: 'recheck', reason: CONFLICT });
  const names = rpcs(calls).map((c) => c.name);
  expect(names).toContain('erp_create_order');
  expect(names).not.toContain('order_v4_transition');
});
