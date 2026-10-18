import { test, expect, type Page } from '@playwright/test';
import type { MockCall } from './support/mockSupabase';
import { installSupabaseMock } from './support/mockSupabase';
import { axeSerious, setProfile } from './support/orderCatalogFx';
import {
  ITEM_ID, ORDER_ID, TEE, adminExtras, fixture, flatPuts, flatUploads, logoObject, sanitizedInPage, teeObjects, teeOrder, teeV1,
} from './support/flatsAdminFx';

/**
 * Админка «Флэты и зоны» (веха 5б, задача 7): настоящий supabase-js, настоящий
 * редактор флэта с холстом konva, мок сети С СОСТОЯНИЕМ справочников и бакета
 * `garment-flats` (тела видов, `list` по карте объектов, `storageListHidden`).
 *
 * Проверяется путь до базы (Review Focus 2 и 3 плана):
 * - файлы — до справочника, справочник — одной записью с базой свежего чтения;
 * - выпуск версии переносит все виды на новый номер (К2), история дописана;
 * - занятый номер версии: виден `list` — сразу следующий; спрятан (гонка) —
 *   409 → скачивание → «другое» → следующий номер для всех видов, «то же» —
 *   повтор после сбоя, номер прежний (К3);
 * - чужой SVG в бакет не попадает неочищенным (К9).
 */

const isCompact = (page: Page) => (page.viewportSize()?.width ?? 1280) <= 760;

async function openFlat(page: Page, id: string) {
  await page.goto(`/order-settings?tab=flats&flat=${id}&studio=1`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Справочники заказа');
  await expect(page.locator('#flat-version-badge')).toBeVisible();
}

/** Рамка выбранной зоны: поле «Y, мм» → значение (буферное поле — коммит по Enter) */
async function setFrameY(page: Page, value: string) {
  const y = page.getByRole('tabpanel', { name: 'Зоны' }).getByLabel('Y, мм', { exact: true });
  await y.fill(value);
  await y.press('Enter');
}

async function release(page: Page, label: string) {
  await page.getByRole('button', { name: label }).click();
}

test.describe('редактор флэта: файлы → версия → справочник', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне флэты только для просмотра — отдельный тест');

  test('1. новый флэт из SVG: файл v1 в бакет, затем ровно один catalog_put с прежней базой', async ({ page }) => {
    const calls: MockCall[] = [];
    const before = teeV1();
    await installSupabaseMock(page, adminExtras(calls, before, teeObjects(1)));
    await page.goto('/order-settings?tab=flats&studio=1');
    await page.getByRole('button', { name: 'Новый флэт' }).click();
    await expect(page).toHaveURL(/flat=new/);

    await page.getByLabel('SVG первого вида').setInputFiles({ name: 'polo.svg', mimeType: 'image/svg+xml', buffer: fixture('flats/tshirt-freefit-front.svg') });
    await page.getByLabel('Название флэта').fill('Поло тест');
    const id = page.getByLabel('id флэта');
    await id.fill('polo-test');
    await page.getByRole('button', { name: 'Подготовить флэт' }).click();
    await expect(page.locator('#flat-version-badge')).toHaveText('Новый, ещё не сохранён');

    await release(page, 'Создать флэт');
    await expect(page.getByText('Флэт создан')).toBeVisible();
    await expect(page).toHaveURL(/flat=polo-test/);

    expect(flatUploads(calls)).toEqual(['flats/polo-test/v1/front.svg']);
    const puts = flatPuts(calls);
    expect(puts).toHaveLength(1);
    expect(puts[0].p_base).toEqual(before);
    const upAt = calls.findIndex((c) => c.kind === 'storage');
    const putAt = calls.findIndex((c) => c.kind === 'rpc' && c.name === 'catalog_put');
    expect(upAt).toBeLessThan(putAt);
    const created = puts[0].p_value.flats.find((f) => f.id === 'polo-test')!;
    expect(created).toMatchObject({ version: 1, views: [{ kind: 'front', svg_path: 'flats/polo-test/v1/front.svg' }] });
    expect(created.history).toBeUndefined();
    expect(puts[0].p_value.flats.find((f) => f.id === TEE)).toEqual(before.flats[0]);
  });

  test('2. правка рамки зоны → «Выпустить версию 2»: перенос всех видов на v2, история [v1]', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, adminExtras(calls, teeV1(), teeObjects(1)));
    await openFlat(page, TEE);
    await expect(page.locator('#flat-version-badge')).toHaveText('Версия 1');
    await setFrameY(page, '230');
    await expect(page.getByText('Меняет силуэт — сохранится новой версией').first()).toBeVisible();
    await release(page, 'Выпустить версию 2');
    await expect(page.locator('#flat-version-badge')).toHaveText('Версия 2');

    expect(flatUploads(calls)).toEqual([`flats/${TEE}/v2/front.svg`, `flats/${TEE}/v2/back.svg`]);
    const puts = flatPuts(calls);
    expect(puts).toHaveLength(1);
    const flat = puts[0].p_value.flats[0];
    expect(flat.version).toBe(2);
    expect(flat.views.map((v) => v.svg_path)).toEqual([`flats/${TEE}/v2/front.svg`, `flats/${TEE}/v2/back.svg`]);
    expect(flat.history).toEqual([{ version: 1, views: teeV1().flats[0].views }]);
    expect(flat.views[0].print_areas[0].polygon_mm[0][1]).toBe(230);
  });

  test('2б. гонка: v2/front занят чужим телом и спрятан от list → 409 → «другое» → все виды на v3', async ({ page }) => {
    const calls: MockCall[] = [];
    const taken = `garment-flats/flats/${TEE}/v2/front.svg`;
    const objects = { ...teeObjects(1), [taken]: { type: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>') } };
    await installSupabaseMock(page, adminExtras(calls, teeV1(), objects, { storageListHidden: [taken] }));
    await openFlat(page, TEE);
    await setFrameY(page, '230');
    await release(page, 'Выпустить версию 2');
    await expect(page.locator('#flat-version-badge')).toHaveText('Версия 3');

    expect(calls.filter((c) => c.kind === 'storage-list').map((c) => c.name)).toEqual([`garment-flats/flats/${TEE}`]);
    expect(flatUploads(calls)).toEqual([
      `flats/${TEE}/v2/front.svg`, `flats/${TEE}/v3/front.svg`, `flats/${TEE}/v3/back.svg`,
    ]);
    const puts = flatPuts(calls);
    expect(puts).toHaveLength(1);
    expect(puts[0].p_value.flats[0].version).toBe(3);
    expect(puts[0].p_value.flats[0].views.map((v) => v.svg_path)).toEqual([`flats/${TEE}/v3/front.svg`, `flats/${TEE}/v3/back.svg`]);
    expect(puts[0].p_value.flats[0].history).toEqual([{ version: 1, views: teeV1().flats[0].views }]);
  });

  test('2б′. занятый номер виден list: загрузок v2 нет, сразу v3', async ({ page }) => {
    const calls: MockCall[] = [];
    const taken = `garment-flats/flats/${TEE}/v2/front.svg`;
    const objects = { ...teeObjects(1), [taken]: { type: 'image/svg+xml', body: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>') } };
    await installSupabaseMock(page, adminExtras(calls, teeV1(), objects));
    await openFlat(page, TEE);
    await setFrameY(page, '230');
    await release(page, 'Выпустить версию 2');
    await expect(page.locator('#flat-version-badge')).toHaveText('Версия 3');

    expect(flatUploads(calls)).toEqual([`flats/${TEE}/v3/front.svg`, `flats/${TEE}/v3/back.svg`]);
    expect(flatPuts(calls).map((p) => p.p_value.flats[0].version)).toEqual([3]);
  });

  test('2в. v2/front уже лежит с тем же очищенным телом (повтор после сбоя) → «то же», v2/back загружен, версия 2', async ({ page }) => {
    const calls: MockCall[] = [];
    const objects = teeObjects(1);
    const extras = adminExtras(calls, teeV1(), objects);
    await installSupabaseMock(page, extras);
    await openFlat(page, TEE);
    const same = `garment-flats/flats/${TEE}/v2/front.svg`;
    const clean = await sanitizedInPage(page, objects[`garment-flats/flats/${TEE}/v1/front.svg`].body.toString('utf8'));
    objects[same] = { type: 'image/svg+xml', body: Buffer.from(clean) };
    extras.storageListHidden = [same];

    await setFrameY(page, '230');
    await release(page, 'Выпустить версию 2');
    await expect(page.locator('#flat-version-badge')).toHaveText('Версия 2');

    expect(flatUploads(calls)).toEqual([`flats/${TEE}/v2/front.svg`, `flats/${TEE}/v2/back.svg`]);
    expect(flatPuts(calls).map((p) => p.p_value.flats[0].version)).toEqual([2]);
    expect(objects[same].body.toString('utf8')).toBe(clean);
  });
});

test.describe('редактор флэта: рукава, чужой SVG, две вкладки', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне флэты только для просмотра — отдельный тест');

  test('4. левый рукав из SVG + зеркальная копия → выпуск v2 с четырьмя видами; на «Дизайне» вкладка «Левый рукав», логотип — от шва рукава', async ({ page }) => {
    const calls: MockCall[] = [];
    const objects = { ...teeObjects(1), ...logoObject() };
    await installSupabaseMock(page, adminExtras(calls, teeV1(), objects, { salesOrders: [teeOrder()] }));
    await openFlat(page, TEE);
    await page.getByRole('tab', { name: 'Вид', exact: true }).click();
    await page.getByLabel('Какой вид').selectOption('sleeve_left');
    await page.getByLabel('SVG вида «Левый рукав»').setInputFiles({ name: 'sleeve-left.svg', mimeType: 'image/svg+xml', buffer: fixture('flats/sleeve-left.svg') });
    await expect(page.getByRole('tab', { name: 'Левый рукав' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Сделать правый рукав зеркально' }).click();
    await expect(page.getByRole('tab', { name: 'Правый рукав' })).toHaveAttribute('aria-selected', 'true');
    await release(page, 'Выпустить версию 2');
    await expect(page.locator('#flat-version-badge')).toHaveText('Версия 2');

    expect(flatUploads(calls)).toEqual(['front', 'back', 'sleeve_left', 'sleeve_right'].map((k) => `flats/${TEE}/v2/${k}.svg`));
    const right = objects[`garment-flats/flats/${TEE}/v2/sleeve_right.svg`].body.toString('utf8');
    const left = objects[`garment-flats/flats/${TEE}/v2/sleeve_left.svg`].body.toString('utf8');
    expect(right).toContain('id="garment"');
    expect(right).not.toBe(left);
    const flat = flatPuts(calls)[0].p_value.flats[0];
    expect(flat.views.map((v) => v.kind)).toEqual(['front', 'back', 'sleeve_left', 'sleeve_right']);

    // «Дизайн» той же «базы»: вкладка рукава, логотип на рукаве — отступ от шва рукава
    await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);
    const canvas = page.getByRole('application', { name: /^Холст/ });
    await expect(canvas).toHaveAttribute('data-ready', 'true');
    await page.getByRole('tablist', { name: 'Вид изделия' }).getByRole('tab', { name: 'Левый рукав' }).click();
    await expect(canvas).toHaveAccessibleName(/вид левый рукав$/i);
    await page.getByRole('region', { name: 'Логотипы' }).locator('input[type="file"]')
      .setInputFiles({ name: 'logo-300dpi.png', mimeType: 'image/png', buffer: fixture('logo-300dpi.png') });
    await expect(page.getByRole('list', { name: 'Нанесения на виде' }).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('status').filter({ hasText: /^Сохранено$/ })).toBeVisible();
    const save = calls.filter((c) => c.kind === 'rpc' && c.name === 'order_v4_save_full').at(-1)!;
    const print = (save.body as { p_order: { items: { prints: Record<string, unknown>[] }[] } }).p_order.items[0].prints[0];
    expect(print).toMatchObject({ offset_from: 'part_seam', layout: { view: 'sleeve_left', flat_version: 2 } });
  });

  test('5. чужой SVG (<script>, onload, внешний href): список «Из файла убрано», в бакете только очищенное', async ({ page }) => {
    const calls: MockCall[] = [];
    const objects = teeObjects(1);
    await installSupabaseMock(page, adminExtras(calls, teeV1(), objects));
    await page.goto('/order-settings?tab=flats&flat=new&studio=1');
    await page.getByLabel('SVG первого вида').setInputFiles({ name: 'evil.svg', mimeType: 'image/svg+xml', buffer: fixture('flats/flat-evil.svg') });
    const removed = page.getByText('Из файла убрано:').locator('..');
    await expect(removed).toBeVisible();
    await expect(removed.getByRole('listitem').first()).toBeVisible();
    await page.getByLabel('Название флэта').fill('Злой силуэт');
    await page.getByLabel('id флэта').fill('evil-test');
    await page.getByRole('button', { name: 'Подготовить флэт' }).click();
    await release(page, 'Создать флэт');
    await expect(page.getByText('Флэт создан')).toBeVisible();

    expect(flatUploads(calls)).toEqual(['flats/evil-test/v1/front.svg']);
    const stored = objects['garment-flats/flats/evil-test/v1/front.svg'].body.toString('utf8');
    expect(stored).toContain('id="garment"');
    expect(stored).not.toMatch(/<script|\son[a-z]+\s*=|evil\.example|javascript:/i);
    expect(await page.evaluate(() => (window as unknown as { __flatEvil?: string }).__flatEvil)).toBeUndefined();
  });

  test('6. вторая вкладка сохранила раньше → плашка конфликта, правки на экране; «Загрузить свежую версию»', async ({ page, context }) => {
    const calls: MockCall[] = [];
    const extras = adminExtras(calls, teeV1(), teeObjects(1));
    await installSupabaseMock(page, extras);
    const other = await context.newPage();
    await installSupabaseMock(other, extras);
    await openFlat(page, TEE);
    await openFlat(other, TEE);

    for (const [p, name] of [[other, 'Футболка — вторая вкладка'], [page, 'Футболка — первая вкладка']] as const) {
      await p.getByRole('tab', { name: 'Модель и подбор' }).click();
      await p.getByLabel('Название флэта').fill(name);
    }
    await release(other, 'Сохранить флэт');
    await expect(other.getByText('Флэт сохранён')).toBeVisible();

    await release(page, 'Сохранить флэт');
    const notice = page.locator('#flat-notice');
    await expect(notice).toContainText('уже изменил другой администратор');
    await expect(page.getByLabel('Название флэта')).toHaveValue('Футболка — первая вкладка');
    await expect(page.getByRole('button', { name: 'Сохранить флэт' })).toBeDisabled();
    await notice.getByRole('button', { name: 'Загрузить свежую версию' }).click();
    await expect(page.locator('#flat-editor-title')).toHaveText('Футболка — вторая вкладка');
    expect(flatPuts(calls)).toHaveLength(2);
    expect(flatPuts(calls)[0].p_value.flats[0].name).toBe('Футболка — вторая вкладка');
  });
});

test.describe('справочник зон нанесения', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне зоны только для просмотра — отдельный тест');

  test('7. «Капюшон» → строка ТЗ «Капюшон Л» → «Сохранить зоны» → catalog_put zonesCatalog; /sku — только просмотр со ссылкой', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, adminExtras(calls, teeV1(), teeObjects(1)));
    await page.goto('/order-settings?tab=flats&studio=1');
    await page.getByRole('tab', { name: 'Зоны нанесения' }).click();
    await expect(page).toHaveURL(/part=zones/);
    const row = page.getByLabel('Строка ТЗ: зона «Капюшон»');
    await expect(row).toHaveValue('');
    await row.selectOption({ label: 'Капюшон Л' });
    await page.getByRole('button', { name: 'Сохранить зоны' }).click();
    await expect(page.getByText('Зоны нанесения сохранены')).toBeVisible();

    const puts = calls.filter((c) => c.kind === 'rpc' && c.name === 'catalog_put');
    expect(puts).toHaveLength(1);
    const body = puts[0].body as { p_table: string; p_key: string; p_value: { id: string; tz_row?: string }[] };
    expect(body).toMatchObject({ p_table: 'app_config', p_key: 'zonesCatalog' });
    expect(body.p_value.find((z) => z.id === 'hood')?.tz_row).toBe('hood_l');
    expect(calls.filter((c) => c.kind === 'storage')).toEqual([]);

    await page.goto('/sku?tab=zones&studio=1');
    await expect(page.locator('.zones-catalog-table')).toBeVisible();
    await expect(page.locator('.zones-catalog-table input, .zones-catalog-table button')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Флэты и зоны/ })).toHaveAttribute('href', '/order-settings?tab=flats&part=zones');
  });
});

/** Запросы модулей konva: в dev — `/node_modules/.vite/deps/konva*.js`, в сборке — чанк `vendor-konva` */
function watchKonva(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => { if (/konva|react-konva/.test(r.url())) seen.push(r.url()); });
  return seen;
}

test.describe('права и телефон', () => {
  test('8а. rop: список и редактор без правки, записей нет', async ({ page }) => {
    test.skip(isCompact(page), 'Десктопная раскладка');
    const calls: MockCall[] = [];
    await installSupabaseMock(page, adminExtras(calls, teeV1(), teeObjects(1)));
    await page.goto('/sales?studio=1');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await setProfile(page, { role: 'rop', is_sales: false, is_ms: false });
    await page.getByRole('navigation', { name: 'Разделы заказа' }).getByRole('link', { name: 'Справочники заказа' }).click();
    await page.getByRole('tab', { name: 'Флэты и зоны' }).click();
    await expect(page.getByText('Флэтов в справочнике: 1')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новый флэт' })).toHaveCount(0);
    await page.getByRole('link', { name: teeV1().flats[0].name as string }).click();
    await expect(page.locator('#flat-version-badge')).toHaveText('Версия 1');
    await expect(page.getByText('Флэты меняет администратор или директор').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /^(Сохранить флэт|Выпустить версию|Создать флэт)/ })).toHaveCount(0);
    await expect(page.getByRole('tabpanel', { name: 'Зоны' }).getByLabel('Y, мм', { exact: true })).toBeDisabled();
    await page.waitForTimeout(500);
    expect(calls.filter((c) => c.kind === 'storage')).toEqual([]);
    expect(calls.filter((c) => c.kind === 'rpc' && c.name === 'catalog_put')).toEqual([]);
  });

  test('8б. 390 px: флэт — картинка без холста, konva не запрошен; список и зоны без горизонтальной прокрутки (11)', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Ширина задаётся в тесте — один прогон');
    await page.setViewportSize({ width: 390, height: 844 });
    const konva = watchKonva(page);
    const calls: MockCall[] = [];
    await installSupabaseMock(page, adminExtras(calls, teeV1(), teeObjects(1)));

    const noHScroll = async (what: string) => {
      const over = await page.evaluate(() => [document.documentElement, document.querySelector('main')]
        .filter((el): el is HTMLElement => !!el)
        .map((el) => ({ tag: el.tagName, sw: el.scrollWidth, cw: el.clientWidth }))
        .filter((m) => m.sw > m.cw));
      expect(over, `${what}: горизонтальная прокрутка`).toEqual([]);
    };

    await page.goto('/order-settings?tab=flats&studio=1');
    await expect(page.getByRole('list', { name: 'Флэтов в справочнике: 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Новый флэт' })).toHaveCount(0);
    await noHScroll('список флэтов');

    await page.getByRole('link', { name: /Футболка FreeFit/ }).click();
    const img = page.getByRole('img', { name: /^Силуэт «.+», вид Перед, зон: 1$/ });
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect(page.getByText('Править — с компьютера', { exact: true })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(0);
    await noHScroll('превью флэта');

    await page.goto('/order-settings?tab=flats&part=zones&studio=1');
    await expect(page.getByRole('heading', { name: 'Капюшон' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Сохранить зоны' })).toHaveCount(0);
    await noHScroll('зоны нанесения');

    expect(konva).toEqual([]);
    expect(calls.filter((c) => c.kind === 'storage' || (c.kind === 'rpc' && c.name === 'catalog_put'))).toEqual([]);
  });
});

test.describe('доступность', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'Десктопная раскладка');

  test('9. axe serious/critical = 0: список флэтов, редактор, зоны', async ({ page }) => {
    await installSupabaseMock(page, adminExtras([], teeV1(), teeObjects(1)));
    const check = async (what: string) => {
      const report = await axeSerious(page);
      expect(report, `${what} — нарушения:\n${report.join('\n')}`).toEqual([]);
    };
    await page.goto('/order-settings?tab=flats&studio=1');
    await expect(page.getByText('Флэтов в справочнике: 1')).toBeVisible();
    await check('список флэтов');

    await openFlat(page, TEE);
    await expect(page.getByRole('application', { name: /^Холст флэта/ })).toHaveAttribute('data-ready', 'true');
    await check('редактор, вкладка «Зоны»');
    for (const tab of ['Вид', 'Модель и подбор', 'История']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await check(`редактор, вкладка «${tab}»`);
    }

    await page.goto('/order-settings?tab=flats&part=zones&studio=1');
    await expect(page.getByRole('button', { name: 'Сохранить зоны' })).toBeVisible();
    await check('зоны нанесения');
  });
});

test.describe('планшет: тач-цели', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  /** Интерактивные элементы внутри панели вкладки, меньше 44 × 44 (цель — подпись, если элемент внутри неё) */
  async function smallTargets(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const root = document.querySelector('#order-settings-tabpanel');
      if (!root) return ['нет панели вкладки'];
      const sel = 'button, a[href], select, input:not([type="hidden"]), summary, [role="tab"], [tabindex="0"]';
      return [...root.querySelectorAll<HTMLElement>(sel)]
        .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
        .map((el) => {
          const target = (el.closest('label') as HTMLElement | null) ?? el;
          const r = target.getBoundingClientRect();
          const name = (el.getAttribute('aria-label') ?? el.textContent ?? el.id ?? el.tagName).trim().slice(0, 40);
          return { name: `${el.tagName.toLowerCase()} «${name}» ${Math.round(r.width)}×${Math.round(r.height)}`, ok: r.width >= 44 && r.height >= 44 };
        })
        .filter((t) => !t.ok)
        .map((t) => t.name);
    });
  }

  test('10. редактор флэта и зоны: все цели касания не меньше 44 × 44', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'Планшет задаётся в тесте — один прогон');
    await installSupabaseMock(page, adminExtras([], teeV1(), teeObjects(1)));
    await openFlat(page, TEE);
    await expect(page.getByRole('application', { name: /^Холст флэта/ })).toHaveAttribute('data-ready', 'true');
    for (const tab of ['Зоны', 'Вид', 'Модель и подбор', 'История']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      expect(await smallTargets(page), `редактор, вкладка «${tab}»`).toEqual([]);
    }
    await page.goto('/order-settings?tab=flats&part=zones&studio=1');
    await expect(page.getByRole('button', { name: 'Сохранить зоны' })).toBeVisible();
    expect(await smallTargets(page), 'зоны нанесения').toEqual([]);
  });
});
