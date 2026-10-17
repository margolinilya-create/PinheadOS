import { test, expect } from '@playwright/test';
import { installSupabaseMock, FX_CREATED, type MockCall } from './support/mockSupabase';

/**
 * Оболочка раздела ТЗ (Order Studio): сайдбар, «Заказы v4», старые адреса
 * и журнал мока (RPC и Storage). Dev-автологин — admin, сеть замокана.
 * Флаг раздела включается per-navigation: `?studio=1` (см. visual.spec.ts).
 */

const SALES_ROW = {
  id: 'sales-1',
  order_number: 'PH-9001',
  title: 'Худи для команды',
  customer: 'ООО Тест',
  status: 'draft',
  price_total: 12000,
  due_date: null,
  updated_at: FX_CREATED,
  schema_version: 4,
};

test('оболочка раздела ТЗ: сайдбар и список заказов', async ({ page }) => {
  await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
  await page.goto('/sales?studio=1');

  const nav = page.getByRole('navigation', { name: 'Разделы заказа' });
  // «Новый заказ» — кнопка-действие, а не ссылка на визард
  await expect(nav.getByRole('button', { name: 'Новый заказ' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Все заказы' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Все заказы' })).toBeVisible();
  await expect(page.getByText('PH-9001')).toBeVisible();
});

test('/ раздела ТЗ ведёт в список заказов', async ({ page }) => {
  await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
  await page.goto('/?studio=1');
  await expect(page).toHaveURL(/\/sales(\?|$)/);
  await expect(page.getByText('PH-9001')).toBeVisible();
});

test('«Новый заказ» создаёт черновик и открывает его на вкладке «Изделие»', async ({ page }) => {
  const calls: MockCall[] = [];
  await installSupabaseMock(page, { salesOrders: [SALES_ROW], calls });
  await page.goto('/sales?studio=1');
  await expect(page.getByText('PH-9001')).toBeVisible();

  // Кнопка в шапке списка: на телефоне меню свёрнуто, кнопку меню проверяет OrderLayout.test
  await page.getByRole('main').getByRole('button', { name: 'Новый заказ' }).click();
  // Dev-вход (`dev`, не uuid) своих черновиков в базе не имеет — создаётся новый
  await expect(page).toHaveURL(/\/sales\/mock-sales-1\?tab=item$/);
  expect(calls.filter((c) => c.kind === 'rpc' && c.name === 'order_v4_save_full')).toHaveLength(1);
});

test('мок пишет журнал RPC и Storage', async ({ page }) => {
  const calls: MockCall[] = [];
  await installSupabaseMock(page, { calls });
  await page.goto('/?studio=1');

  await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    await supabase.rpc('erp_create_order', { p: 1 });
    await supabase.storage.from('order-artworks').upload('t/a.txt', new Blob(['x']));
  });

  expect(calls).toContainEqual(expect.objectContaining({ kind: 'rpc', name: 'erp_create_order' }));
  expect(calls).toContainEqual(expect.objectContaining({ kind: 'storage', name: 'order-artworks/t/a.txt' }));
});

test('мок сохранения v4 отвечает как сервер миграции D: ревизия клиента и версия заказа', async ({ page }) => {
  await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
  await page.goto('/?studio=1');

  const r = await page.evaluate(async (created) => {
    const { saveSalesOrder } = await import('/src/orderstudio/api/salesOrders.ts');
    const noRev = await saveSalesOrder({ id: 'sales-1' });
    const first = await saveSalesOrder({ id: 'sales-1', client_rev: 3, expected_updated_at: created });
    const stale = await saveSalesOrder({ id: 'sales-1', client_rev: 3, expected_updated_at: created });
    const next = first.ok
      ? await saveSalesOrder({ id: 'sales-1', client_rev: 3, expected_updated_at: first.saved.updated_at })
      : null;
    const fresh = await saveSalesOrder({ id: null, client_rev: 3 });
    return { noRev, first, stale, next, fresh };
  }, FX_CREATED);

  expect(r.noRev).toEqual({ ok: false, kind: 'outdated', message: 'Вышло обновление — обновите страницу, правка не сохранена' });
  expect(r.first).toMatchObject({ ok: true, saved: { id: 'sales-1', order_number: 'PH-9001' } });
  expect(r.stale).toEqual({ ok: false, kind: 'conflict', message: 'Заказ изменён в другой вкладке — обновите страницу' });
  expect(r.next).toMatchObject({ ok: true });
  expect(r.fresh).toMatchObject({ ok: true, saved: { id: 'mock-sales-1' } });
});

test('мок Storage различает sign, list, move, copy и загрузку', async ({ page }) => {
  const calls: MockCall[] = [];
  await installSupabaseMock(page, { calls });
  await page.goto('/?studio=1');

  const r = await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const b = supabase.storage.from('order-artworks');
    const one = await b.createSignedUrl('o1/a.png', 60);
    const many = await b.createSignedUrls(['o1/a.png', 'o1/b.png'], 60);
    const list = await b.list('o1');
    const move = await b.move('o1/a.png', 'o2/a.png');
    const copy = await b.copy('o1/b.png', 'o2/b.png');
    const up = await b.upload('o1/c.txt', new Blob(['x']));
    return {
      one: [one.data?.signedUrl, one.error?.message],
      many: many.data?.map((d) => [d.path, d.signedUrl, d.error]),
      list: [list.data, list.error?.message],
      move: move.error?.message ?? null,
      copy: copy.error?.message ?? null,
      up: up.error?.message ?? null,
    };
  });

  expect(r.one[0]).toContain('token=mock-signed');
  expect(r.one[1]).toBeUndefined();
  expect(r.many).toHaveLength(2);
  for (const [, url, err] of r.many ?? []) {
    expect(url).toContain('token=mock-signed');
    expect(err).toBeNull();
  }
  expect(r.list[0]).toEqual([]);
  expect(r.move).toBeNull();
  expect(r.copy).toBeNull();
  expect(r.up).toBeNull();

  const brief = calls.map((c) => [c.kind, c.name]);
  expect(brief).toEqual([
    ['storage-sign', 'order-artworks/o1/a.png'],
    ['storage-sign', 'order-artworks/o1/a.png'],
    ['storage-sign', 'order-artworks/o1/b.png'],
    ['storage-list', 'order-artworks/o1'],
    ['storage-move', 'order-artworks/o1/a.png->o2/a.png'],
    ['storage-copy', 'order-artworks/o1/b.png->o2/b.png'],
    ['storage', 'order-artworks/o1/c.txt'],
  ]);
});

test('старые адреса', async ({ page }) => {
  await installSupabaseMock(page);

  await page.goto('/orders?studio=1');
  await expect(page).toHaveURL(/\/sales(\?|$)/);

  await page.goto('/print?studio=1');
  await expect(page).toHaveURL(/\/sales(\?|$)/);
});
