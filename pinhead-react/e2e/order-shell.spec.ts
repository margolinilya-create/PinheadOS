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

test('оболочка раздела ТЗ: сайдбар и переход в заказы v4', async ({ page }) => {
  await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
  await page.goto('/sales?studio=1');

  const nav = page.getByRole('navigation', { name: 'Разделы заказа' });
  await expect(nav.getByRole('link', { name: 'Новый заказ' })).toBeVisible();
  await expect(page.getByText('PH-9001')).toBeVisible();
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

test('старые адреса', async ({ page }) => {
  await installSupabaseMock(page);

  await page.goto('/orders?studio=1');
  await expect(page).toHaveURL(/\/sales(\?|$)/);

  await page.goto('/print?studio=1');
  await expect(page).toHaveURL(/\/(\?.*)?$/);
  expect(new URL(page.url()).pathname).toBe('/');
});
