import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installSupabaseMock, FX_CREATED, type MockCall, type MockExtras } from './support/mockSupabase';
import { seedFlatObjects, seedFlatsCatalog } from './support/flatsFixture';
import { axeSerious } from './support/orderCatalogFx';
import { NEW_ORDER, newOrderGetsUuid } from './support/orderFlowFx';

/**
 * «Дизайн» 2.0 (веха 5в, Э2): «Стандарты Pinhead», вид холста, проверки под
 * холстом, итог позиции, копия на вид — в настоящем браузере с холстом konva
 * и моком сети. Проверяется путь до базы: пресет и копия уходят в
 * `order_v4_save_full`, вид холста и цвет ткани ничего не пишут.
 */

const FIX = new URL('./fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX));

const FLAT = 'tshirt-freefit';
const ORDER_ID = '6f1c2d3e-0000-4000-8000-0000000005e1';
const ITEM_ID = '6f1c2d3e-0000-4000-8000-0000000005e2';
const ORDER_NUMBER = 'PH-9150';
const LOGO_PATH = `orders/${ORDER_ID}/logo/00000000-0000-4000-8000-000000000001-logo.png`;

function placedPrint() {
  return {
    id: '6f1c2d3e-0000-4000-8000-0000000005e3',
    sort_order: 0,
    method: 'dtf',
    zone: 'Грудь (перед)',
    sizes: [],
    width_mm: 200,
    height_mm: 100,
    colors: 1,
    textile: 'white',
    fill: 1,
    artwork_path: LOGO_PATH,
    offset_mm: 80,
    offset_from: 'neck_seam',
    offset_dir: 'down',
    layout: {
      v: 1, flat_id: FLAT, flat_version: 1, view: 'front', area_id: 'chest',
      x_mm: 377.6, y_mm: 198.8, rotation_deg: 0, flip_h: false, flip_v: false,
      asset: {
        type: 'png', source_file: 'logo.png', intrinsic_w_mm: 50.8, intrinsic_h_mm: 25.4,
        px_w: 600, px_h: 300, dpi: 300, size_estimated: false, has_preview: false,
      },
    },
  };
}

function mock(calls: MockCall[]): MockExtras {
  return {
    calls,
    salesOrders: [{
      id: ORDER_ID,
      schema_version: 4,
      order_number: ORDER_NUMBER,
      title: 'Футболки для команды',
      customer: 'ООО Тест',
      status: 'draft',
      kind: 'run',
      price_total: null,
      due_date: null,
      updated_at: FX_CREATED,
      created_by: null,
      order_items: [{
        id: ITEM_ID,
        kind: 'sku',
        sku_code: 'T-004',
        product_type: 'Футболка',
        size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Белый (01-01)', sizes: { M: 20, L: 10 } }, { color: 'Чёрный (15-01)', sizes: { M: 10, L: 0 } }] },
        extras: [],
        sort_order: 0,
        flat_id: FLAT,
        order_item_prints: [placedPrint()],
        order_item_labels: [],
      }],
      order_notes_cards: [],
    }],
    catalogs: { app_config: { garmentFlats: seedFlatsCatalog([FLAT]) } },
    storageObjects: {
      ...seedFlatObjects([FLAT]),
      [`order-artworks/${LOGO_PATH}`]: { type: 'image/png', body: fixture('logo-300dpi.png') },
    },
  };
}

type SavedOrder = { items: { prints: { width_mm: number | null; layout: { view?: string } | null }[] }[] };
const saves = (calls: MockCall[]) => calls
  .filter((c) => c.kind === 'rpc' && c.name === 'order_v4_save_full')
  .map((c) => (c.body as { p_order: SavedOrder }).p_order);

const canvas = (page: Page) => page.getByRole('application', { name: /^Холст/ });

async function open(page: Page) {
  await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${ORDER_NUMBER} · ООО Тест`);
  await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
}

test.describe('вкладка «Дизайн» 2.0', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне — превью без холста');

  test('вид холста и цвет ткани ничего не пишут; пресет и копия на вид — пишут', async ({ page }) => {
    const calls: MockCall[] = [];
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await installSupabaseMock(page, mock(calls));
    await open(page);

    // Вид холста и цвет ткани — только показ
    await page.getByRole('group', { name: 'Вид холста' }).getByRole('button', { name: 'Как на изделии' }).click();
    await expect(canvas(page)).toHaveAccessibleName(/как на изделии$/);
    await page.getByRole('group', { name: 'Показать на цвете' }).getByRole('button', { name: /Чёрный/ }).click();
    await page.waitForTimeout(1200);
    expect(saves(calls)).toHaveLength(0);

    // Проверки под холстом и итог
    await expect(page.getByRole('region', { name: 'Проверка макета' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Итог позиции' })).toContainText('1 нанесение');

    // Пресет: без выбора — недоступен; с выбором — ширина стандарта
    const chest = page.getByRole('group', { name: 'Стандарты Pinhead' }).getByRole('button', { name: 'Центр груди' });
    await expect(chest).toHaveAttribute('aria-disabled', 'true');
    await page.getByRole('button', { name: /^Нанесение 1 · / }).click();
    await expect(chest).not.toHaveAttribute('aria-disabled', 'true');
    await chest.click();
    // Стандарт груди 250 мм, но зона FreeFit — 280 мм с отступом 20: ширина ужимается до 240
    await expect.poll(() => saves(calls).at(-1)?.items[0].prints[0].width_mm, { timeout: 10_000 }).toBe(240);

    // Копия на спину
    await page.getByRole('group', { name: 'Копировать нанесение 1 на вид' }).getByRole('button', { name: /Спина/ }).click();
    await expect.poll(() => saves(calls).at(-1)?.items[0].prints.length, { timeout: 10_000 }).toBe(2);
    expect(saves(calls).at(-1)?.items[0].prints[1].layout?.view).toBe('back');

    expect(await axeSerious(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('«Файлы печати» — ZIP с PNG 300 dpi нанесения и списком (Э4а)', async ({ page }) => {
    await installSupabaseMock(page, mock([]));
    await open(page);
    const download = page.waitForEvent('download');
    await page.getByRole('region', { name: 'Итог позиции' }).getByRole('button', { name: 'Файлы печати' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('PH-9150-print-files.zip');
    const bytes = readFileSync(await file.path());
    const text = bytes.toString('latin1');
    expect(text.startsWith('PK')).toBe(true);
    expect(text).toContain('PH-9150_p1_front_dtf_200x100mm.png');
    expect(text).toContain('\x89PNG');
    expect(text).toContain('pHYs');
  });

  test('«Мокапы» — ZIP с PNG «вид × цвет» (Э5)', async ({ page }) => {
    await installSupabaseMock(page, mock([]));
    await open(page);
    const download = page.waitForEvent('download');
    await page.getByRole('region', { name: 'Итог позиции' }).getByRole('button', { name: 'Мокапы' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('PH-9150-mockups.zip');
    const text = readFileSync(await file.path()).toString('latin1');
    expect(text).toContain('PH-9150_mockup_front_01-01.png');
    expect(text).toContain('PH-9150_mockup_front_15-01.png');
    expect(text).toContain('\x89PNG');
  });

  test('«Скачать КП (PDF)» на «ТЗ и цена» — PDF с мокапом (Э6)', async ({ page }) => {
    await installSupabaseMock(page, mock([]));
    await page.goto(`/sales/${ORDER_ID}?tab=summary&studio=1`);
    const btn = page.getByRole('button', { name: 'Скачать КП (PDF)' });
    await expect(btn).toBeVisible();
    const download = page.waitForEvent('download');
    await btn.click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('PH-9150-KP.pdf');
    const bytes = readFileSync(await file.path());
    expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(bytes.length).toBeGreaterThan(5000);
  });

  test('«Повторить заказ» на «ТЗ и цена» — черновик с parent_id, файл скопирован в папку нового заказа (Э8)', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, mock(calls));
    await newOrderGetsUuid(page);
    await page.goto(`/sales/${ORDER_ID}?tab=summary&studio=1`);
    await page.getByRole('button', { name: 'Повторить заказ' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Создать черновик' }).click();
    await expect(page).toHaveURL(new RegExp(`/sales/${NEW_ORDER}\\?tab=item`));
    const newId = NEW_ORDER;
    await expect.poll(() => calls.filter((c) => c.kind === 'storage-copy').map((c) => c.name), { timeout: 10_000 })
      .toEqual([`order-artworks/${LOGO_PATH}->${LOGO_PATH.replace(ORDER_ID, newId)}`]);
    type Saved = { parent_id?: string; items: { prints: { artwork_path: string; layout: unknown }[] }[] };
    const last = () => calls.filter((c) => c.kind === 'rpc' && c.name === 'order_v4_save_full').map((c) => (c.body as { p_order: Saved }).p_order).at(-1);
    await expect.poll(() => last()?.items[0]?.prints[0]?.artwork_path, { timeout: 10_000 }).toBe(LOGO_PATH.replace(ORDER_ID, newId));
    expect(last()?.parent_id).toBe(ORDER_ID);
    expect(last()?.items[0].prints[0].layout).not.toBeNull();
  });

  test('«Мои раскладки»: разложить логотип по сохранённой — грудь и спина уходят в заказ (Э8)', async ({ page }) => {
    const calls: MockCall[] = [];
    const extras = mock(calls);
    extras.layoutTemplates = [{
      id: '00000000-0000-4000-8000-00000000a001',
      name: 'Грудь и спина',
      created_by: 'dev',
      created_at: '2026-10-26T10:00:00.000Z',
      data: {
        kind: 'layout', v: 1, flat_id: FLAT, prints: [
          { view: 'front', area_id: 'chest', zone_id: 'front', method: 'dtf', width_mm: 180, down_mm: 70, dx_mm: 0, rotation_deg: 0 },
          { view: 'back', area_id: 'back', zone_id: 'back', method: 'dtf', width_mm: 260, down_mm: 120, dx_mm: 0, rotation_deg: 0 },
        ],
      },
    }];
    await installSupabaseMock(page, extras);
    await open(page);

    const panel = page.locator('details', { has: page.getByText('Мои раскладки', { exact: true }) });
    await panel.getByText('Мои раскладки', { exact: true }).click();
    const applyBtn = panel.getByRole('button', { name: 'Разложить по раскладке' });
    await expect(panel.getByLabel('Раскладка')).toContainText('Грудь и спина · 2 нанесения');
    // Без выбранного нанесения — недоступно с причиной
    await expect(applyBtn).toHaveAttribute('aria-disabled', 'true');
    await expect(panel).toContainText('Выберите размещённое нанесение на холсте');

    await page.getByRole('button', { name: /^Нанесение 1 · / }).click();
    await expect(applyBtn).not.toHaveAttribute('aria-disabled', 'true');
    await applyBtn.click();
    await expect.poll(() => saves(calls).at(-1)?.items[0].prints.length, { timeout: 10_000 }).toBe(2);
    const prints = saves(calls).at(-1)!.items[0].prints;
    expect(prints.map((p) => [p.layout?.view, p.width_mm])).toEqual([['front', 180], ['back', 260]]);
    await expect(page.getByText(/«Грудь и спина»: разложено мест — 2/)).toBeVisible();
  });

  test('«Мои раскладки»: сохранить раскладку позиции и удалить её — только своя строка (Э8)', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, mock(calls));
    await open(page);

    const panel = page.locator('details', { has: page.getByText('Мои раскладки', { exact: true }) });
    await panel.getByText('Мои раскладки', { exact: true }).click();
    await expect(panel).toContainText('Сохраните раскладку позиции');
    await panel.getByLabel('Название новой раскладки').fill('  Логотип на груди ');
    await panel.getByRole('button', { name: 'Сохранить раскладку позиции (1 нанесение)' }).click();

    await expect(panel.getByLabel('Раскладка')).toContainText('Логотип на груди · 1 нанесение');
    type Insert = { name: string; created_by: string; data: { kind: string; v: number; flat_id: string; prints: Record<string, unknown>[] } };
    const inserts = calls.filter((c) => c.name === 'order_templates:POST').map((c) => c.body as Insert);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ name: 'Логотип на груди', created_by: 'dev', data: { kind: 'layout', v: 1, flat_id: FLAT } });
    expect(inserts[0].data.prints).toEqual([expect.objectContaining({ view: 'front', area_id: 'chest', zone_id: 'front', method: 'dtf', width_mm: 200 })]);
    // В раскладке нет файлов и абсолютных координат
    expect(JSON.stringify(inserts[0].data)).not.toMatch(/orders\/|"x_mm"|"y_mm"|artwork/);
    // Сохранение раскладки заказ не пишет
    expect(saves(calls)).toHaveLength(0);

    await panel.getByRole('button', { name: 'Удалить раскладку' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Удалить' }).click();
    await expect(panel.getByLabel('Раскладка')).toHaveCount(0);
    expect(calls.filter((c) => c.name === 'order_templates:DELETE')).toHaveLength(1);
  });

  test('?design2=0 — прежний вид: без «Стандартов Pinhead» и вида холста', async ({ page }) => {
    await installSupabaseMock(page, mock([]));
    await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1&design2=0`);
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('group', { name: 'Вид холста' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Стандарты Pinhead' })).toHaveCount(0);
  });
});
