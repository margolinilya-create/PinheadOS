import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installSupabaseMock, FX_CREATED, type MockCall, type MockExtras } from './support/mockSupabase';
import { seedFlatObjects, seedFlatsCatalog } from './support/flatsFixture';
import { axeSerious } from './support/orderCatalogFx';

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

  test('?design2=0 — прежний вид: без «Стандартов Pinhead» и вида холста', async ({ page }) => {
    await installSupabaseMock(page, mock([]));
    await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1&design2=0`);
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
    await expect(page.getByRole('group', { name: 'Вид холста' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Стандарты Pinhead' })).toHaveCount(0);
  });
});
