import { test, expect } from '@playwright/test';
import { installSupabaseMock, type MockCall } from './support/mockSupabase';

/**
 * Прототип запуска заказа v4 в производство (`orderstudio/bridge/launch.ts`,
 * веха 2): настоящий supabase-js, настоящий стор ERP (ленивые чанки), мок сети.
 * Проверяется ПУТЬ ПО СЕТИ: какие RPC и в каком порядке уходят и что
 * связь `tz_order_id`/`tz_number` доезжает до `erp_create_order`.
 *
 * Мок `erp_create_order` отвечает id, которого нет в фикстуре `erp_orders`,
 * поэтому `createOrder` стора отдаёт `null` — и клиент обязан спросить
 * `order_v4_launch_check` повторно. Это та же ветка, что у ответа 23505
 * на бою: код ошибки стор глотает, и различить «создан нами» и «чужой»
 * может только сервер.
 */
const ORDER_ID = '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f';
const CONFLICT = 'Заказ ERP с этой связью создан не этим запуском — обратитесь к руководителю производства';

/** Запуск на заказе из фабрики: одна позиция с сеткой 10 + 5 */
async function launch(page: import('@playwright/test').Page) {
  return page.evaluate(async (orderId) => {
    const { newSalesOrder, newSalesItem } = await import('/src/orderstudio/model/factory.ts');
    const { launchToErp } = await import('/src/orderstudio/bridge/launch.ts');
    const order = newSalesOrder({
      id: orderId,
      number: 'PH-9001',
      status: 'ready_to_launch',
      title: 'Худи для фестиваля',
      customer: 'ООО Ромашка',
      items: [newSalesItem({
        product_type: 'Худи',
        size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Чёрный', sizes: { M: 10, L: 5 } }] },
      })],
    });
    return launchToErp(order, { launchDate: '2026-10-20' });
  }, ORDER_ID);
}

const LAUNCH_RPCS = new Set([
  'order_v4_launch_check', 'erp_bootstrap', 'erp_create_order', 'order_v4_transition',
]);

test('запуск: проверка → справочники ERP → erp_create_order со связью → переход production', async ({ page }) => {
  const calls: MockCall[] = [];
  await installSupabaseMock(page, { calls });
  await page.goto('/?studio=1');
  await expect(page.locator('#root')).not.toBeEmpty();
  calls.length = 0;

  const r = await launch(page);
  expect(r).toEqual({ ok: true, erpOrderId: 'mock-erp-order-1', alreadyLaunched: false, warnings: [] });

  const rpc = calls.filter((c) => c.kind === 'rpc' && LAUNCH_RPCS.has(c.name));
  expect(rpc.map((c) => c.name)).toEqual([
    'order_v4_launch_check',
    'erp_bootstrap',
    'erp_create_order',
    // createOrder вернул null (loadOne не нашёл) — сервер подтверждает «наш»
    'order_v4_launch_check',
    'order_v4_transition',
  ]);
  expect(rpc[0].body).toEqual({ p_id: ORDER_ID });

  const order = (rpc[2].body as { payload: { order: Record<string, unknown>; items: Record<string, unknown>[] } }).payload;
  expect(order.order).toMatchObject({
    tz_order_id: ORDER_ID,
    tz_number: 'PH-9001',
    title: 'Худи для фестиваля',
    customer: 'ООО Ромашка',
    launch_date: '2026-10-20',
    status: 'active',
  });
  expect(order.items).toHaveLength(1);
  expect(order.items[0]).toMatchObject({ product_type: 'Худи', qty: 15 });
  // маршрут построил стор ERP по справочнику цехов — этапы есть
  expect((order.items[0].stages as unknown[]).length).toBeGreaterThan(0);

  expect(rpc[4].body).toEqual({ p_id: ORDER_ID, p_to: 'production', p_reason: null });
});

test('запуск: чужой заказ ERP с той же связью — конфликт, перехода нет', async ({ page }) => {
  const calls: MockCall[] = [];
  await installSupabaseMock(page, {
    calls,
    launch: {
      checks: [
        { ok: true, already: false, launch_started_at: '2026-10-17T10:00:00Z' },
        { ok: false, reason: CONFLICT },
      ],
    },
  });
  await page.goto('/?studio=1');
  await expect(page.locator('#root')).not.toBeEmpty();
  calls.length = 0;

  const r = await launch(page);
  expect(r).toEqual({ ok: false, stage: 'conflict', reason: CONFLICT });

  const names = calls.filter((c) => c.kind === 'rpc' && LAUNCH_RPCS.has(c.name)).map((c) => c.name);
  expect(names).toContain('erp_create_order');
  expect(names).not.toContain('order_v4_transition');
});
