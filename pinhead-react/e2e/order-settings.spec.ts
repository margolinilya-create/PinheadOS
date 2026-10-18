import { test, expect, type Page } from '@playwright/test';
import { installSupabaseMock, type MockCall, type MockExtras } from './support/mockSupabase';
import { seedCounts, seedFlatsCatalog } from './support/flatsFixture';
import {
  axeSerious, draftOrder, hoodieItem, orderCatalogs, setProfile, staffFx,
} from './support/orderCatalogFx';

/**
 * «Справочники заказа» и «Сотрудники продаж» (веха 4, задача 6): настоящий
 * supabase-js, настоящие экраны, мок сети С СОСТОЯНИЕМ справочников
 * (`MockExtras.catalogs`: запись только `catalog_put`/`prices_patch`, условно
 * по базе — иначе «Справочник изменён»).
 *
 * Проверяется путь до базы и обратно в заказ: правка справочника видна
 * в заказе ПОСЛЕ ПЕРЕЗАГРУЗКИ (то есть доехала до «базы», а не осталась
 * в сторе вкладки); две вкладки над одним справочником дают вторую отказом,
 * её правки остаются на экране, «Загрузить свежую версию» снова открывает
 * сохранение. Доступ: rop правит, продавец пункта не видит, МС без признака
 * продавца в раздел попадает.
 *
 * Роль меняется поверх dev-автологина (admin) через стор (`setProfile`) —
 * и только ПЕРЕД переходом по меню: `page.goto` вернул бы админа.
 */

const ORDER_ID = '6f1c2d3e-0000-4000-8000-0000000004a1';
const ITEM_ID = '6f1c2d3e-0000-4000-8000-0000000004b1';

const isCompact = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 760;

const nav = (page: Page) => page.getByRole('navigation', { name: 'Разделы заказа' });

/** Список заказов открыт под dev-админом — точка, откуда меняется роль */
async function openSales(page: Page) {
  await page.goto('/sales?studio=1');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
}

const rpcCalls = (calls: MockCall[], name: string) =>
  calls.filter((c) => c.kind === 'rpc' && c.name === name);

/** Число из суммы «12 345 ₽» */
const rubles = (text: string | null) => Number((text ?? '').replace(/[^\d]/g, ''));

test.describe('справочники заказа: правка доходит до заказа', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне справочники только для просмотра — отдельный тест ниже');

  test('rop добавляет цвет поставщику — цвет предлагается в заказе', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, {
      calls,
      catalogs: orderCatalogs(),
      salesOrders: [draftOrder(ORDER_ID, [hoodieItem(ITEM_ID, 'Чёрный (40-01)')])],
    });
    await openSales(page);
    await setProfile(page, { role: 'rop', is_sales: false, is_ms: false });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Заказы отдела');

    // rop: справочники заказа есть, каталог моделей и админка — нет
    await expect(nav(page).getByRole('link', { name: 'Каталог моделей и цен' })).toHaveCount(0);
    await nav(page).getByRole('link', { name: 'Справочники заказа' }).click();
    await expect(page).toHaveURL(/\/order-settings/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Справочники заказа');
    await expect(page.getByRole('link', { name: '«Каталоге моделей и цен»' })).toHaveCount(0);

    // Поставщик по умолчанию выбран первым; новый цвет — в его палитру
    await expect(page.getByRole('button', { name: /^Коттонпром/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Добавить цвет' }).click();
    await page.getByRole('textbox', { name: 'Код цвета' }).fill('E2E-01');
    await page.getByRole('textbox', { name: 'Название цвета' }).fill('Лаймовый');
    await page.getByRole('textbox', { name: 'Hex цвета' }).fill('#A0E000');
    await page.getByRole('button', { name: 'Готово' }).click();
    await page.getByRole('button', { name: 'Сохранить поставщиков' }).click();
    await expect(page.getByText('Поставщики сохранены')).toBeVisible();

    const put = rpcCalls(calls, 'catalog_put').at(-1)!.body as {
      p_table: string; p_key: string; p_value: { id: string; palette: { colors: { code: string; hex: string; active: boolean }[] } }[];
    };
    expect(put.p_table).toBe('catalog_config');
    expect(put.p_key).toBe('suppliers');
    const cotton = put.p_value.find((s) => s.id === 'cottonprom')!;
    expect(cotton.palette.colors.at(-1)).toMatchObject({ code: 'E2E-01', hex: '#A0E000', active: true });

    // Заказ после перезагрузки: справочник прочитан из «базы», цвет — в палитре
    const savesBefore = rpcCalls(calls, 'order_v4_save_full').length;
    await page.goto(`/sales/${ORDER_ID}?tab=item&studio=1`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PH-9100 · ООО Тест');
    const lime = page.getByRole('button', { name: 'Лаймовый (E2E-01)', exact: true });
    await expect(lime).toBeVisible();
    await expect(page.getByRole('button', { name: 'Чёрный (40-01)', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Открытие ничего не пишет; выбор нового цвета — пишет
    expect(rpcCalls(calls, 'order_v4_save_full')).toHaveLength(savesBefore);
    await lime.click();
    await expect(lime).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('status').filter({ hasText: /^Сохранено$/ })).toBeVisible();
    const saved = rpcCalls(calls, 'order_v4_save_full').at(-1)!.body as {
      p_order: { items: { size_grid: { rows: { color: string }[] } }[] };
    };
    expect(saved.p_order.items[0].size_grid.rows.map((r) => r.color)).toEqual(['Лаймовый (E2E-01)']);
  });

  test('правка подготовки меняет итог на вкладке «ТЗ и цена»', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, {
      calls,
      catalogs: orderCatalogs(),
      salesOrders: [draftOrder(ORDER_ID, [
        hoodieItem(ITEM_ID, 'Чёрный (40-01)', [{ id: '6f1c2d3e-0000-4000-8000-0000000004c1', method: 'dtf', sort_order: 0 }]),
      ])],
    });

    await page.goto(`/sales/${ORDER_ID}?tab=summary&studio=1`);
    const total = page.getByTestId('order-total');
    await expect(total).toHaveText(/\d/);
    const before = rubles(await total.textContent());
    await expect(page.getByText('Подготовка (формы, программа)')).toHaveCount(0);

    await page.goto('/order-settings?tab=pricing&studio=1');
    await expect(page.getByRole('tab', { name: 'Правила цены' })).toHaveAttribute('aria-selected', 'true');
    const dtf = page.getByLabel('DTF', { exact: true });
    await expect(dtf).toBeEnabled();
    await dtf.fill('1500');
    await page.getByRole('button', { name: 'Сохранить правила цены' }).click();
    await expect(page.getByText('Правила цены сохранены')).toBeVisible();

    // Записаны только изменённые ключи прайса с их прежними значениями
    const patch = rpcCalls(calls, 'prices_patch').at(-1)!.body;
    expect(patch).toEqual({ p_patch: { prepFees: { dtf: 1500 } }, p_base: { prepFees: {} } });

    await page.goto(`/sales/${ORDER_ID}?tab=summary&studio=1`);
    await expect(page.getByText('Подготовка (формы, программа)')).toBeVisible();
    await expect(total).toHaveText(/\d/);
    expect(rubles(await total.textContent())).toBe(before + 1500);
  });

  test('две вкладки: вторая получает отказ, правки остаются, «Загрузить свежую версию» снова открывает сохранение', async ({ page, context }) => {
    const calls: MockCall[] = [];
    // Один набор MockExtras на обе вкладки — одна «база» справочников
    const extra: MockExtras = { calls, catalogs: orderCatalogs() };
    await installSupabaseMock(page, extra);
    const other = await context.newPage();
    await installSupabaseMock(other, extra);

    for (const p of [page, other]) {
      await p.goto('/order-settings?tab=pricing&studio=1');
      await expect(p.getByLabel('DTF', { exact: true })).toBeEnabled();
    }

    // Первая вкладка сохраняет
    await page.getByLabel('DTF', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Сохранить правила цены' }).click();
    await expect(page.getByText('Правила цены сохранены')).toBeVisible();

    // Вторая — поверх устаревшей базы: отказ, плашка, правка на экране
    await other.getByLabel('Вышивка', { exact: true }).fill('200');
    await other.getByRole('button', { name: 'Сохранить правила цены' }).click();
    const alert = other.getByRole('alert').filter({ hasText: 'Справочник «Правила цены» уже изменили' });
    await expect(alert).toContainText('Ваши правки не сохранены');
    await expect(other.getByLabel('Вышивка', { exact: true })).toHaveValue('200');
    await expect(other.getByRole('button', { name: 'Сохранить правила цены' })).toBeDisabled();

    // Свежая версия: видна правка первой вкладки, своя вносится заново и сохраняется
    await alert.getByRole('button', { name: 'Загрузить свежую версию' }).click();
    await expect(other.getByRole('alert')).toHaveCount(0);
    await expect(other.getByLabel('DTF', { exact: true })).toHaveValue('100');
    await expect(other.getByLabel('Вышивка', { exact: true })).toHaveValue('');
    await other.getByLabel('Вышивка', { exact: true }).fill('200');
    await other.getByRole('button', { name: 'Сохранить правила цены' }).click();
    await expect(other.getByText('Правила цены сохранены')).toBeVisible();

    expect(rpcCalls(calls, 'prices_patch').at(-1)!.body).toEqual({
      p_patch: { prepFees: { dtf: 100, embroidery: 200 } },
      p_base: { prepFees: { dtf: 100 } },
    });
  });
});

test.describe('доступ к настройкам продаж', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'Меню на телефоне свёрнуто — доступ меню проверяет orderNav.test');

  test('продавец не видит «Справочники заказа» и «Сотрудников продаж», адрес уводит в заказы', async ({ page }) => {
    await installSupabaseMock(page, { catalogs: orderCatalogs() });
    await openSales(page);
    await setProfile(page, { role: 'manager', is_sales: true, is_ms: false });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Мои заказы');

    await expect(nav(page).getByRole('button', { name: 'Новый заказ' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Справочники заказа' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Сотрудники продаж' })).toHaveCount(0);

    // Прямой адрес (переход внутри приложения — роль сохраняется): назад в список
    await page.evaluate(() => {
      window.history.pushState({}, '', '/order-settings?studio=1');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page).toHaveURL(/\/sales(\?|$)/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Мои заказы');
  });

  test('МС без признака продавца заходит в раздел: заказы в работе, своих не заводит', async ({ page }) => {
    await installSupabaseMock(page);
    await openSales(page);
    await setProfile(page, { role: 'production', is_sales: false, is_ms: true });

    await expect(page).toHaveURL(/\/sales(\?|$)/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Заказы в работе');
    await expect(nav(page).getByRole('link', { name: 'Заказы в работе' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новый заказ' })).toHaveCount(0);
    await expect(nav(page).getByRole('link', { name: 'Справочники заказа' })).toHaveCount(0);
  });

  test('отметка МС на «Сотрудниках продаж» уходит в sales_set_staff и переживает перезагрузку', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, { calls, salesStaff: staffFx() });
    await openSales(page);
    await setProfile(page, { role: 'rop', is_sales: false, is_ms: false });
    await nav(page).getByRole('link', { name: 'Сотрудники продаж' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Сотрудники продаж');
    await expect(page.getByText('Продавцов: 1 · МС: 0')).toBeVisible();

    const ms = page.getByRole('checkbox', { name: 'МС: Олег Петров' });
    await expect(ms).not.toBeChecked();
    await ms.check();
    await expect(page.getByText('Продавцов: 1 · МС: 1')).toBeVisible();
    await expect(ms).toBeEnabled();
    expect(rpcCalls(calls, 'sales_set_staff').map((c) => c.body)).toEqual([
      { p_profile: 'p-oleg', p_kind: 'ms', p_on: true },
    ]);
    // Признак продавца у Олега не задет
    await expect(page.getByRole('checkbox', { name: 'Ведёт заказы: Олег Петров' })).not.toBeChecked();

    await page.goto('/sales-staff?studio=1');
    await expect(page.getByRole('checkbox', { name: 'МС: Олег Петров' })).toBeChecked();
  });
});

/**
 * «Флэты и зоны» (веха 5а): кнопка «Загрузить типовые флэты» — сид дизайн-мейкера.
 * Каждый SVG — в бакет `garment-flats` по версионному пути, справочник — ОДНОЙ записью
 * `catalog_put` ПОСЛЕ всех файлов (справочник не ссылается на файл, которого нет).
 * Число файлов и флэтов берётся из самого сида, а не из спеки.
 */
test.describe('флэты и зоны: типовые флэты кнопкой', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне справочники только для просмотра');

  test('admin: «Загрузить типовые флэты» — все SVG сида в бакет, затем один catalog_put', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, { calls, catalogs: orderCatalogs(), storageObjects: {} });
    await page.goto('/order-settings?tab=flats&studio=1');
    await expect(page.getByRole('tab', { name: 'Флэты и зоны' })).toHaveAttribute('aria-selected', 'true');
    const { flats, files } = seedCounts();
    await expect(page.getByText(`Типовых силуэтов пока нет. Загрузите ${flats} моделей одной кнопкой`)).toBeVisible();

    await page.getByRole('button', { name: 'Загрузить типовые флэты' }).click();
    await expect(page.getByText(`Типовые флэты загружены: ${flats} моделей`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(`Флэтов в справочнике: ${flats}`)).toBeVisible();

    const flatUploads = calls.filter((c) => c.kind === 'storage').map((c) => c.name);
    expect(flatUploads).toHaveLength(files);
    for (const name of flatUploads) expect(name).toMatch(/^garment-flats\/flats\/[a-z0-9-]+\/v1\/(front|back)\.svg$/);
    expect(new Set(flatUploads).size).toBe(files);

    const puts = rpcCalls(calls, 'catalog_put');
    expect(puts).toHaveLength(1);
    expect(puts[0].body).toMatchObject({ p_table: 'app_config', p_key: 'garmentFlats', p_base: null });
    // Справочник — последним: после него ни одной загрузки
    const putAt = calls.indexOf(puts[0]);
    expect(calls.slice(putAt).filter((c) => c.kind === 'storage')).toEqual([]);
    const value = (puts[0].body as { p_value: { flats: { id: string }[] } }).p_value;
    expect(value.flats).toHaveLength(flats);
  });

  test('rop видит флэты, но кнопки загрузки нет', async ({ page }) => {
    const calls: MockCall[] = [];
    const catalogs = orderCatalogs() as MockExtras['catalogs'] & { app_config: Record<string, unknown> };
    catalogs.app_config.garmentFlats = seedFlatsCatalog(['tshirt-freefit', 'hoodie-classic']);
    await installSupabaseMock(page, { calls, catalogs });
    await openSales(page);
    await setProfile(page, { role: 'rop', is_sales: false, is_ms: false });
    await nav(page).getByRole('link', { name: 'Справочники заказа' }).click();
    await page.getByRole('tab', { name: 'Флэты и зоны' }).click();
    await expect(page).toHaveURL(/tab=flats/);
    await expect(page.getByText('Флэтов в справочнике: 2')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Загрузить типовые флэты' })).toHaveCount(0);
    await expect(page.getByText('Флэты меняет администратор или директор')).toBeVisible();
    expect(calls.filter((c) => c.kind === 'storage')).toEqual([]);
    expect(rpcCalls(calls, 'catalog_put')).toEqual([]);
  });
});

test('телефон: справочники только для просмотра, сохранения нет', async ({ page }) => {
  test.skip(!isCompact(page), 'Проверка раскладки ≤ 760 px');
  await installSupabaseMock(page, { catalogs: orderCatalogs() });
  await page.goto('/order-settings?tab=pricing&studio=1');
  await expect(page.getByRole('note').filter({ hasText: 'На телефоне справочники только для просмотра' })).toBeVisible();
  await expect(page.getByLabel('DTF', { exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Сохранить правила цены' })).toBeDisabled();
});

test.describe('доступность', () => {
  test('справочники заказа: нет нарушений axe уровня serious/critical на всех вкладках', async ({ page }) => {
    // «Флэты и зоны» — с таблицей: два флэта сида
    const catalogs = orderCatalogs() as MockExtras['catalogs'] & { app_config: Record<string, unknown> };
    catalogs.app_config.garmentFlats = seedFlatsCatalog(['tshirt-freefit', 'hoodie-classic']);
    await installSupabaseMock(page, { catalogs });
    for (const tab of ['suppliers', 'labels', 'packaging', 'pricing', 'tz', 'flats']) {
      await page.goto(`/order-settings?tab=${tab}&studio=1`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Справочники заказа');
      await expect(page.getByRole('tabpanel')).toBeVisible();
      await expect(page.getByText('Загрузка справочника…')).toHaveCount(0);
      const report = await axeSerious(page);
      expect(report, `вкладка ${tab} — нарушения:\n${report.join('\n')}`).toEqual([]);
    }
  });

  test('сотрудники продаж: нет нарушений axe уровня serious/critical', async ({ page }) => {
    await installSupabaseMock(page, { salesStaff: staffFx() });
    await page.goto('/sales-staff?studio=1');
    await expect(page.getByRole('checkbox', { name: 'МС: Олег Петров' })).toBeVisible();
    const report = await axeSerious(page);
    expect(report, `нарушения:\n${report.join('\n')}`).toEqual([]);
  });
});
