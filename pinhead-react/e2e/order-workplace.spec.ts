import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installSupabaseMock, FX_CREATED, type MockCall } from './support/mockSupabase';
import { hoodieItem, orderCatalogs } from './support/orderCatalogFx';
import { seedFlatObjects, seedFlatsCatalog } from './support/flatsFixture';

/**
 * Рабочее место заказа v4 `/sales/:id` (веха 3, задача 7): настоящий
 * supabase-js, настоящие панели визарда и автосохранение, мок сети.
 *
 * Проверяется путь до БАЗЫ, а не вид: что правка на панелях визарда доходит
 * до `order_v4_save_full` (буфер позиции → `bindBuffer` → заказ), что копия
 * в другом цвете не тянет правку в исходную позицию (отписка в cleanup
 * `useItemBuffer`), и что перезагрузка открывает записанное — мок отдаёт
 * сохранённый payload следующим чтением.
 *
 * Сторожа проверены мутацией (отчёт задачи 7): без `bindBuffer` размеры
 * не доезжают до сохранения, без отписки правка копии затирает исходную
 * позицию — оба раза основной сценарий красный.
 */

type SavedItem = {
  key: string;
  sku_code: string;
  product_type: string;
  fabric_code: string;
  extras: string[];
  size_grid: { sizes: string[]; rows: { color: string; sizes: Record<string, number> }[] };
};
type SavedOrder = {
  id: string | null;
  client_rev: number;
  customer: string;
  price_total: number | null;
  items: SavedItem[];
};

const saves = (calls: MockCall[]) => calls
  .filter((c) => c.kind === 'rpc' && c.name === 'order_v4_save_full')
  .map((c) => (c.body as { p_order: SavedOrder }).p_order);

const qty = (it: SavedItem) => it.size_grid.rows
  .reduce((n, r) => n + Object.values(r.sizes).reduce((a, b) => a + Number(b || 0), 0), 0);

/** Автосохранение дошло: индикатор «Сохранено» после правки */
async function settled(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Сохранено$/ })).toBeVisible();
}

/** Количество размера в таблице визарда (поле с отложенной записью — уходим с него) */
async function setSize(page: Page, size: string, n: number) {
  const input = page.getByRole('spinbutton', { name: `Размер ${size}`, exact: true });
  await input.fill(String(n));
  await input.blur();
}

/**
 * Список изделий в обеих раскладках: на ширине ≤ 760 вместо списка —
 * выпадающий «Изделие» (`ItemList` в режиме `compact`). Сценарий один.
 */
const compact = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 760;
const picker = (page: Page) => page.getByRole('combobox', { name: 'Изделие', exact: true });
const listRows = (page: Page) => page.getByRole('list', { name: 'Изделия заказа' }).getByRole('listitem');

async function expectItemCount(page: Page, n: number) {
  if (compact(page)) await expect(picker(page).locator('option')).toHaveCount(n);
  else await expect(listRows(page)).toHaveCount(n);
}

async function expectSelectedItem(page: Page, index: number) {
  if (compact(page)) {
    const value = await picker(page).locator('option').nth(index).getAttribute('value');
    await expect(picker(page)).toHaveValue(value ?? '');
  } else {
    await expect(listRows(page).nth(index).getByRole('button').first()).toHaveAttribute('aria-current', 'true');
  }
}

async function selectItem(page: Page, index: number) {
  if (compact(page)) await picker(page).selectOption({ index });
  else await listRows(page).nth(index).getByRole('button').first().click();
  await expectSelectedItem(page, index);
}

const DRAFT_ITEM = {
  id: '6f1c2d3e-0000-4000-8000-000000000001',
  kind: 'sku',
  sku_code: '',
  product_type: 'Худи',
  fabric_code: '',
  main_fabric: 'Футер 3-х нитка',
  color_supplier: '',
  size_grid: {
    sizes: ['M', 'L'],
    rows: [
      { color: 'Чёрный (40-01)', sizes: { M: 10, L: 5 } },
      { color: 'Белый (01-01)', sizes: { M: 4, L: 2 } },
    ],
  },
  extras: [],
  sort_order: 0,
  order_item_prints: [],
  order_item_labels: [],
};

const salesRow = (id: string, status: string, items: unknown[]) => ({
  id,
  schema_version: 4,
  order_number: 'PH-9100',
  title: 'Худи для команды',
  customer: 'ООО Тест',
  status,
  kind: 'run',
  price_total: 12000,
  due_date: null,
  updated_at: FX_CREATED,
  created_by: null,
  order_items: items,
  order_notes_cards: [],
});

test.describe('рабочее место заказа', () => {
  test('новый заказ: изделие на панелях визарда, копия в цвете, клиент, цена — до базы и обратно', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, { calls });
    await page.goto('/sales?studio=1');

    await page.getByRole('main').getByRole('button', { name: 'Новый заказ' }).first().click();
    await expect(page).toHaveURL(/\/sales\/mock-sales-1\?tab=item$/);
    await page.getByRole('button', { name: 'Добавить изделие' }).click();

    // Модель → ткань → цвет → размеры 10 + 5 → обработка
    await page.getByRole('button', { name: /^Худи Regular regular/ }).click();
    await page.getByRole('button', { name: 'Выбрать модель' }).click();
    await page.getByRole('button', { name: /^Футер 3-х нитка петля 65% хб/ }).first().click();
    await page.getByRole('button', { name: 'Чёрный (40-01)', exact: true }).click();
    await setSize(page, 'M', 10);
    await setSize(page, 'L', 5);
    await page.getByRole('button', { name: /Доп\. обработки/ }).click();
    // Обработка — строка-флажок `role="checkbox"` (не `<input>` «Ткань клиента»)
    const extra = page.locator('[role="checkbox"]').first();
    await extra.click();
    await expect(extra).toHaveAttribute('aria-checked', 'true');
    await settled(page);

    const first = saves(calls).at(-1)!;
    expect(first.items).toHaveLength(1);
    const original = first.items[0];
    expect(original.sku_code).not.toBe('');
    expect(original.fabric_code).not.toBe('');
    expect(original.extras).toHaveLength(1);
    expect(original.size_grid.rows).toEqual([
      { color: 'Чёрный (40-01)', sizes: expect.objectContaining({ M: 10, L: 5 }) },
    ]);

    // «Копия в другом цвете»: новая позиция с нулём штук, ей — свои размеры
    await page.getByRole('button', { name: /^Действия с изделием/ }).first().click();
    await page.getByRole('button', { name: /^Копия в другом цвете…/ }).click();
    await page.getByLabel('Цвет новой позиции').fill('Белый (01-01)');
    await page.getByRole('button', { name: 'Создать позицию' }).click();
    await expectItemCount(page, 2);
    // Копия выбрана и загружена в буфер: её штуки — с нуля
    await expectSelectedItem(page, 1);
    await expect(page.getByRole('spinbutton', { name: 'Размер L', exact: true })).toHaveValue(/^0?$/);
    await setSize(page, 'M', 3);
    await settled(page);

    // Клиент — на вкладке «Клиент и доставка»
    await page.getByRole('button', { name: 'Далее: клиент и доставка' }).click();
    await expect(page).toHaveURL(/tab=client/);
    await page.getByLabel('Клиент', { exact: true }).fill('ООО Ромашка');
    // «Комментарий для цехов» (веха 8): мок отвечает как сервер после K — поле есть
    await page.getByRole('textbox', { name: 'Комментарий для цехов' }).fill('Упаковать по 10 шт.');
    await settled(page);

    // «ТЗ и цена» — итог больше нуля
    await page.getByRole('tab', { name: /^ТЗ и цена/ }).click();
    await expect(page).toHaveURL(/tab=summary/);
    const table = page.getByRole('table');
    await expect(table.locator('tbody tr')).toHaveCount(2);
    // Итог на экране — не ноль (цифры есть и они не «0 ₽»)
    const total = page.getByTestId('order-total');
    await expect(total).toHaveText(/[1-9]/);
    await settled(page);

    const last = saves(calls).at(-1)!;
    expect(last.client_rev).toBe(4);
    expect(last.notes).toBe('Упаковать по 10 шт.');
    expect(last.id).toBe('mock-sales-1');
    expect(last.customer).toBe('ООО Ромашка');
    expect(last.price_total).toBeGreaterThan(0);
    expect(last.items).toHaveLength(2);
    const [a, b] = last.items;
    // Исходная позиция не задета правкой копии (отписка буфера при смене позиции)
    expect(a.key).toBe(original.key);
    expect(a.size_grid.rows).toEqual(original.size_grid.rows);
    expect(qty(a)).toBe(15);
    expect(b.key).not.toBe(a.key);
    expect(b.sku_code).toBe(a.sku_code);
    expect(b.size_grid.rows).toHaveLength(1);
    expect(b.size_grid.rows[0].color).toBe('Белый (01-01)');
    expect(qty(b)).toBe(3);

    // Перезагрузка открывает записанное
    const savesBefore = saves(calls).length;
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('PH-9001 · ООО Ромашка');
    await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(2);
    await page.getByRole('tab', { name: /^Изделие/ }).click();
    await expectItemCount(page, 2);
    // В адресе осталась копия: её 3 шт; исходная — 10 + 5
    await expect(page.getByRole('spinbutton', { name: 'Размер M', exact: true })).toHaveValue('3');
    await selectItem(page, 0);
    await expect(page.getByRole('spinbutton', { name: 'Размер M', exact: true })).toHaveValue('10');
    await expect(page.getByRole('spinbutton', { name: 'Размер L', exact: true })).toHaveValue('5');
    await expect(page.getByRole('button', { name: 'Чёрный (40-01)', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Комментарий для цехов на месте после перезагрузки
    await page.getByRole('tab', { name: /^Клиент/ }).click();
    await expect(page.getByRole('textbox', { name: 'Комментарий для цехов' })).toHaveValue('Упаковать по 10 шт.');
    // Открытие ничего не пишет
    await page.waitForTimeout(1500);
    expect(saves(calls)).toHaveLength(savesBefore);
  });

  test('заказ отправлен в работу (ready_to_launch) — только просмотр, сохранений нет', async ({ page }) => {
    const calls: MockCall[] = [];
    const id = '6f1c2d3e-0000-4000-8000-0000000000aa';
    const item = { ...DRAFT_ITEM, size_grid: { sizes: ['M', 'L'], rows: [DRAFT_ITEM.size_grid.rows[0]] } };
    await installSupabaseMock(page, { calls, salesOrders: [salesRow(id, 'ready_to_launch', [item])] });
    await page.goto(`/sales/${id}?tab=item&studio=1`);

    await expect(page.getByRole('status').filter({ hasText: 'Отправлен в работу — правка закрыта' })).toBeVisible();
    await expect(page.getByRole('button', { name: '+ Изделие' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Действия с изделием/ })).toHaveCount(0);
    await expect(page.getByRole('spinbutton', { name: 'Размер M', exact: true })).toBeDisabled();

    await page.getByRole('tab', { name: /^Клиент/ }).click();
    await expect(page.getByLabel('Клиент', { exact: true })).toBeDisabled();
    await page.waitForTimeout(1500);
    expect(saves(calls)).toHaveLength(0);
  });

  test('«Вышло обновление» — плашка и кнопка «Обновить страницу», правка дальше не уходит', async ({ page }) => {
    const calls: MockCall[] = [];
    const id = '6f1c2d3e-0000-4000-8000-0000000000bb';
    await installSupabaseMock(page, {
      calls,
      salesOrders: [salesRow(id, 'draft', [])],
      salesSaveFailure: { code: 'P0001', message: 'Вышло обновление — обновите страницу, правка не сохранена' },
    });
    await page.goto(`/sales/${id}?tab=client&studio=1`);

    await page.getByLabel('Клиент', { exact: true }).fill('ООО Новое имя');
    await expect(page.getByRole('status').filter({
      hasText: 'Вышло обновление — обновите страницу, последняя правка не сохранена',
    })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Обновить страницу' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Обновление приложения' })).toContainText('Обновите страницу');

    // Конечное состояние: поля закрыты, повторных сохранений нет
    const n = saves(calls).length;
    expect(n).toBe(1);
    await expect(page.getByLabel('Клиент', { exact: true })).toBeDisabled();
    await page.waitForTimeout(1500);
    expect(saves(calls)).toHaveLength(n);
  });

  test('многоцветная позиция — плашка «Разнести по цветам», после разнесения две позиции', async ({ page }) => {
    const calls: MockCall[] = [];
    const id = '6f1c2d3e-0000-4000-8000-0000000000cc';
    await installSupabaseMock(page, { calls, salesOrders: [salesRow(id, 'draft', [DRAFT_ITEM])] });
    await page.goto(`/sales/${id}?tab=item&studio=1`);

    await expect(page.getByRole('note')).toContainText('В позиции 2 цвета — разнесите по цветам');
    // Панели визарда для многоцветной позиции не показываются
    await expect(page.getByRole('spinbutton', { name: 'Размер M', exact: true })).toHaveCount(0);
    await page.getByRole('note').getByRole('button', { name: 'Разнести по цветам' }).click();
    await page.getByRole('dialog').getByRole('button', { name: /Разнести/ }).click();

    await expectItemCount(page, 2);
    await expect(page.getByRole('note')).toHaveCount(0);
    await settled(page);

    const last = saves(calls).at(-1)!;
    expect(last.items).toHaveLength(2);
    expect(last.items.map((it) => it.size_grid.rows.map((r) => r.color))).toEqual([
      ['Чёрный (40-01)'], ['Белый (01-01)'],
    ]);
    expect(last.items.map(qty)).toEqual([15, 6]);
    expect(last.items[0].key).toBe(DRAFT_ITEM.id);
  });

  test('снятый цвет, цвет чужой палитры и свой текстом — показаны как есть, открытие ничего не пишет', async ({ page }) => {
    // Веха 4: справочник «Поставщики и палитры». Снятый с продажи цвет
    // и цвет из другой палитры в заказе уже стоят — заказ их не стирает
    const calls: MockCall[] = [];
    const id = '6f1c2d3e-0000-4000-8000-0000000000ff';
    const items = [
      { ...hoodieItem('6f1c2d3e-0000-4000-8000-0000000000f1', 'Бордо (77-07)'), sort_order: 0 },
      { ...hoodieItem('6f1c2d3e-0000-4000-8000-0000000000f2', 'Белый (5001)'), sort_order: 1 },
      { ...hoodieItem('6f1c2d3e-0000-4000-8000-0000000000f3', 'розовый'), sort_order: 2 },
    ];
    await installSupabaseMock(page, { calls, catalogs: orderCatalogs(), salesOrders: [salesRow(id, 'draft', items)] });
    await page.goto(`/sales/${id}?tab=item&studio=1`);

    const current = page.getByTestId('color-current');
    // Снятый: с пометкой, в палитре не предлагается
    await expect(current).toHaveText(/Выбран: Бордо \(77-07\) — снят с продажи/);
    await expect(page.getByRole('button', { name: 'Бордо (77-07)', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Чёрный (40-01)', exact: true })).toBeVisible();

    // Из палитры другого поставщика (ткань без поставщика — палитра по умолчанию)
    await selectItem(page, 1);
    await expect(current).toHaveText(/Выбран: Белый \(5001\) — из палитры «Медастекс»/);

    // Свой цвет текстом — в поле «Свой цвет», без пометки
    await selectItem(page, 2);
    await expect(current).toHaveCount(0);
    await expect(page.getByLabel('Свой цвет', { exact: true })).toHaveValue('розовый');

    await page.waitForTimeout(1500);
    expect(saves(calls)).toHaveLength(0);
  });

  test('нанесение на холсте: на «Изделии» зона и мм только для чтения, «Изменить на холсте» ведёт на «Дизайн»', async ({ page }) => {
    // Веха 5а: строка нанесения с раскладкой — зону, мм и отступ пишет холст
    test.skip(compact(page), 'На телефоне холст только для просмотра — e2e/order-design.spec.ts');
    const calls: MockCall[] = [];
    const id = '6f1c2d3e-0000-4000-8000-0000000000e5';
    const itemId = '6f1c2d3e-0000-4000-8000-0000000000e6';
    const print = {
      id: '6f1c2d3e-0000-4000-8000-0000000000e7', sort_order: 0, method: 'dtf', zone: 'Грудь (перед)', sizes: [],
      width_mm: 200, height_mm: 100, colors: 1, textile: 'white', fill: 1,
      artwork_path: `orders/${id}/logo/00000000-0000-4000-8000-000000000001-logo.png`,
      offset_mm: 111, offset_from: 'neck_seam', offset_dir: 'down',
      layout: {
        v: 1, flat_id: 'tshirt-freefit', flat_version: 1, view: 'front', area_id: 'chest',
        x_mm: 377.6, y_mm: 230, rotation_deg: 0, flip_h: false, flip_v: false,
        asset: { type: 'png', source_file: 'logo.png', intrinsic_w_mm: 50.8, intrinsic_h_mm: 25.4, size_estimated: false, has_preview: false },
      },
    };
    const item = {
      ...DRAFT_ITEM, id: itemId, sku_code: 'T-004', product_type: 'Футболка', flat_id: 'tshirt-freefit',
      size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 30 } }] },
      order_item_prints: [print],
    };
    await installSupabaseMock(page, {
      calls,
      salesOrders: [salesRow(id, 'draft', [item])],
      catalogs: { app_config: { garmentFlats: seedFlatsCatalog(['tshirt-freefit']) } },
      storageObjects: seedFlatObjects(['tshirt-freefit']),
    });
    await page.goto(`/sales/${id}?tab=item&item=${itemId}&studio=1`);
    await expect(page.getByText(/^Зона, размер и отступ заданы на холсте · отступ/)).toBeVisible();
    const row = page.getByText(/^Зона, размер и отступ заданы на холсте/).locator('..');
    await expect(row.getByLabel('Зона', { exact: true })).toHaveAttribute('readonly', '');
    await expect(row.getByLabel('Ширина, мм', { exact: true })).toHaveAttribute('readonly', '');
    await expect(row.getByLabel('Ширина, мм', { exact: true })).toHaveValue('200');

    await page.getByRole('button', { name: 'Изменить на холсте' }).click();
    await expect(page).toHaveURL(/tab=design/);
    await expect(page.getByRole('application', { name: /^Холст/ })).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('list', { name: 'Нанесения на виде' }).getByRole('listitem')).toHaveCount(1);
    await page.waitForTimeout(1500);
    expect(saves(calls)).toHaveLength(0);
  });

  test('рабочее место: нет нарушений axe уровня serious/critical', async ({ page }) => {
    // Четыре вкладки и четыре прогона axe — под нагрузкой CI 30 с не хватало (финальное ревью 6+7)
    test.slow();
    const id = '6f1c2d3e-0000-4000-8000-0000000000dd';
    const item = { ...DRAFT_ITEM, size_grid: { sizes: ['M', 'L'], rows: [DRAFT_ITEM.size_grid.rows[0]] } };
    await installSupabaseMock(page, { salesOrders: [salesRow(id, 'draft', [item])] });

    for (const tab of ['item', 'design', 'client', 'summary']) {
      await page.goto(`/sales/${id}?tab=${tab}&studio=1`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('PH-9100 · ООО Тест');
      await expect(page.getByRole('tabpanel')).toBeVisible();

      const { violations } = await new AxeBuilder({ page })
        .include('main')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const serious = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      const report = serious.map((v) => {
        const nodes = v.nodes.slice(0, 3).map((n) => {
          const why = (n.failureSummary ?? '').replace(/\s+/g, ' ').trim();
          return `      ${n.target.join(' ')}\n        ${why}`;
        }).join('\n');
        return `${v.id} (${v.impact}): ${v.help}\n${nodes}`;
      });
      expect(report, `вкладка ${tab} — нарушения:\n${report.join('\n')}`).toEqual([]);
    }
  });
});

/**
 * Панели «Изделия» на телефоне (веха 8, задача 6): тач-цели — токеном
 * `--control-h-md` на `pointer: coarse` (44 px), а не `:global`-заплатками
 * рабочего места; палитра без вложенной прокрутки — она «ловила» палец.
 * `hasTouch` обязателен: без него `pointer: coarse` не срабатывает.
 */
test.describe('панели изделия на 375 px с тачем', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test('тач-цели не меньше 44 px, палитра без своей прокрутки, страница без горизонтальной', async ({ page }) => {
    const id = '6f1c2d3e-0000-4000-8000-0000000000ee';
    const items = [{ ...hoodieItem('6f1c2d3e-0000-4000-8000-0000000000e1', 'Чёрный (40-01)'), sort_order: 0 }];
    await installSupabaseMock(page, { catalogs: orderCatalogs(), salesOrders: [salesRow(id, 'draft', items)] });
    await page.goto(`/sales/${id}?tab=item&studio=1`);

    const panel = page.getByRole('tabpanel');
    const palette = panel.getByRole('group', { name: /^Палитра/ });
    await expect(palette).toBeVisible();

    // Палитра: высота по содержимому, прокрутки внутри нет
    const scroll = await palette.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      maxHeight: getComputedStyle(el).maxHeight,
      clipped: el.scrollHeight > el.clientHeight + 1,
    }));
    expect(scroll).toEqual({ overflowY: 'visible', maxHeight: 'none', clipped: false });

    // Тач-цели панелей: образцы, «−»/«+», поле размера, поиск, фильтры, обработки
    const targets = [
      palette.getByRole('button').first(),
      panel.getByRole('button', { name: /^Увеличить/ }).first(),
      panel.getByRole('button', { name: /^Уменьшить/ }).first(),
      panel.getByRole('spinbutton').first(),
      panel.getByLabel('Поиск цвета'),
      panel.getByLabel('Поиск модели'),
      panel.getByRole('group', { name: 'Категория' }).getByRole('button').first(),
      panel.getByRole('button', { name: /Доп\. обработки/ }),
    ];
    for (const t of targets) {
      const what = await t.evaluate((el) => el.outerHTML.slice(0, 80));
      const box = await t.boundingBox();
      expect(box, what).not.toBeNull();
      expect(box!.height, what).toBeGreaterThanOrEqual(44);
    }

    // Без горизонтальной прокрутки страницы
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
