import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, FX_CREATED, type MockCall } from './support/mockSupabase';
import { draftOrder, hoodieItem, orderCatalogs } from './support/orderCatalogFx';

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

test('мок сохранения v4 отвечает как сервер миграции K (D — версия заказа): ревизия клиента 4 и версия заказа', async ({ page }) => {
  await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
  await page.goto('/?studio=1');

  const r = await page.evaluate(async (created) => {
    const { saveSalesOrder } = await import('/src/orderstudio/api/salesOrders.ts');
    const noRev = await saveSalesOrder({ id: 'sales-1' });
    const rev3 = await saveSalesOrder({ id: 'sales-1', client_rev: 3, expected_updated_at: created });
    const first = await saveSalesOrder({ id: 'sales-1', client_rev: 4, expected_updated_at: created });
    const stale = await saveSalesOrder({ id: 'sales-1', client_rev: 4, expected_updated_at: created });
    const next = first.ok
      ? await saveSalesOrder({ id: 'sales-1', client_rev: 4, expected_updated_at: first.saved.updated_at })
      : null;
    const fresh = await saveSalesOrder({ id: null, client_rev: 4 });
    return { noRev, rev3, first, stale, next, fresh };
  }, FX_CREATED);

  expect(r.noRev).toEqual({ ok: false, kind: 'outdated', message: 'Вышло обновление — обновите страницу, правка не сохранена' });
  expect(r.rev3).toEqual(r.noRev);
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

// ─── Выбор оболочки по профилю (веха 8, задача 5, К1) ───────────────────────
//
// Профиль вошедшего — подменой в сторе входа поверх dev-автологина (admin).
// Другой `id` — это «другой человек»: `ShellGate` (ключ `user.id`) выбирает
// оболочку заново по ТЕКУЩЕМУ адресу, ровно как после входа. До подмены
// профиля в dev-моке (`pinhead_dev_profile`, задача 9) F5 возвращает админа —
// поэтому после каждой перезагрузки профиль ставится снова.

const LIVE = { active: true, approved: true };
const SELLER = { id: 'e2e-seller', role: 'manager', name: 'Анна Продавец', is_sales: true, is_ms: false, ...LIVE };
const DESIGNER = { id: 'e2e-designer', role: 'designer', name: 'Дина Дизайнер', is_sales: false, is_ms: false, ...LIVE };
const ORDER_NAV_NAME = 'Разделы заказа';
const ERP_HOME = 'Обзор производства';

/**
 * Войти «другим человеком» в этой вкладке (оболочка выбирается заново).
 * Сначала — дождаться оболочки: dev-автологин ставит админа ПОСЛЕ события
 * `load`, и ранняя подмена была бы им перезаписана
 */
async function signInAs(page: Page, profile: Record<string, unknown>) {
  await expect(page.locator('main#main-content')).toBeAttached();
  await page.evaluate(async (p) => {
    const { useAuthStore } = await import('/src/store/useAuthStore.ts');
    useAuthStore.setState({ user: { email: `${p.id}@pinhead.ru`, ...p }, profileStatus: 'active' });
  }, profile);
}

const storedChoice = (page: Page) => page.evaluate(() => localStorage.getItem('pinhead_feature_orderStudio'));

test.describe('выбор оболочки по профилю', () => {
  test('продавец: F5 на /sales/:id с записанным «0» остаётся в разделе', async ({ page }) => {
    await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
    await page.addInitScript(() => localStorage.setItem('pinhead_feature_orderStudio', '0'));
    for (let i = 0; i < 2; i += 1) {
      if (i === 0) await page.goto('/sales/sales-1');
      else await page.reload();
      await signInAs(page, SELLER);
      await expect(page.getByRole('navigation', { name: ORDER_NAV_NAME })).toBeVisible();
      await expect(page).toHaveURL(/\/sales\/sales-1/);
    }
  });

  test('дизайнер на /sales уходит в «Производство» один раз, без петли', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/sales');
    await signInAs(page, DESIGNER);
    // LeaveToProduction: страница ушла на /, «0» записан
    await expect(page.getByRole('heading', { name: ERP_HOME })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    expect(await storedChoice(page)).toBe('0');
    // Тот же человек снова — оболочка «Производство», уходов больше нет
    await signInAs(page, DESIGNER);
    await page.waitForTimeout(300);
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByRole('navigation', { name: ORDER_NAV_NAME })).toHaveCount(0);
  });

  test('?studio=0 — «Производство» на этот заход', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/?studio=0');
    await expect(page.getByRole('heading', { name: ERP_HOME })).toBeVisible();
    await expect(page.getByRole('navigation', { name: ORDER_NAV_NAME })).toHaveCount(0);
  });

  test('продавец: «Производство» — один заход без записи; следующий / — снова раздел', async ({ page }) => {
    await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
    await page.goto('/sales');
    await signInAs(page, SELLER);
    // Адрес ухода ловится навигацией: ERP после загрузки может переписать адрес сам
    const went = page.waitForEvent('framenavigated', (f) => f === page.mainFrame() && new URL(f.url()).pathname === '/');
    await page.getByRole('button', { name: 'Перейти в раздел Производство' }).click();
    expect(new URL((await went).url()).search).toBe('?studio=0');
    await expect(page.getByRole('heading', { name: ERP_HOME })).toBeVisible();
    expect(await storedChoice(page)).toBeNull();

    await page.goto('/');
    await signInAs(page, SELLER);
    await expect(page).toHaveURL(/\/sales(\?|$)/);
    await expect(page.getByRole('navigation', { name: ORDER_NAV_NAME })).toBeVisible();
  });

  test('refreshProfile того же человека на /sku оболочку не меняет', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/sku');
    await expect(page.getByRole('navigation', { name: ORDER_NAV_NAME })).toBeVisible();
    await page.evaluate(async () => {
      const { useAuthStore } = await import('/src/store/useAuthStore.ts');
      const user = useAuthStore.getState().user;
      useAuthStore.setState({ checkingProfile: true });
      useAuthStore.setState({ checkingProfile: false, user: { ...user } });
    });
    await expect(page.getByRole('navigation', { name: ORDER_NAV_NAME })).toBeVisible();
    await expect(page.getByRole('heading', { name: ERP_HOME })).toHaveCount(0);
  });

  test('выход стирает выбор раздела', async ({ page }) => {
    await installSupabaseMock(page);
    await page.goto('/sales');
    await page.evaluate(() => localStorage.setItem('pinhead_feature_orderStudio', '1'));
    await page.getByRole('button', { name: 'Выйти' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Выйти' }).click();
    await expect.poll(() => storedChoice(page)).toBeNull();
  });
});

test.describe('оболочка на 375 px', () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test('«ТЗ и цена» видна целиком при неразмещённом нанесении и пустом клиенте; шапка без переполнения', async ({ page }) => {
    const ORDER = '6f1c2d3e-0000-4000-8000-0000000005a1';
    const order = draftOrder(ORDER, [hoodieItem('6f1c2d3e-0000-4000-8000-0000000005a2', 'Чёрный (40-01)', [
      { id: '6f1c2d3e-0000-4000-8000-0000000005a3', method: 'dtf', zone: 'Спина', sort_order: 0 },
    ])]);
    await installSupabaseMock(page, { catalogs: orderCatalogs(), salesOrders: [{ ...order, customer: '' }] });
    await page.goto(`/sales/${ORDER}?tab=summary`);

    const summary = page.getByRole('tab', { name: /^ТЗ и цена/ });
    await expect(summary).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Клиент — не заполнено/ })).toBeAttached();
    const box = await summary.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375);

    const header = await page.locator('header').first().evaluate((h) => [h.scrollWidth, h.clientWidth]);
    expect(header[0]).toBeLessThanOrEqual(header[1]);
    const doc = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(doc[0]).toBeLessThanOrEqual(doc[1]);
    // Заголовок раздела скрыт, «Производство» — иконкой с подписью для читалки
    await expect(page.getByText('Оформление заказа', { exact: true })).toBeHidden();
    await expect(page.getByRole('button', { name: 'Перейти в раздел Производство' })).toBeVisible();
  });
});

// Подпись «Производство» видна с 481 px — шапка не переполняется и там
for (const width of [481, 520, 760]) {
  test(`шапка раздела на ${width} px без переполнения`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await installSupabaseMock(page, { salesOrders: [SALES_ROW] });
    await page.goto('/sales');
    const btn = page.getByRole('button', { name: 'Перейти в раздел Производство' });
    await expect(btn).toBeVisible();
    await expect(btn.getByText('Производство', { exact: true })).toBeVisible();
    const header = await page.locator('header').first().evaluate((h) => [h.scrollWidth, h.clientWidth]);
    expect(header[0]).toBeLessThanOrEqual(header[1]);
    const box = await btn.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width);
  });
}
