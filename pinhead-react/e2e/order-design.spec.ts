import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { installSupabaseMock, FX_CREATED, type MockCall, type MockExtras } from './support/mockSupabase';
import { seedFlatObjects, seedFlatsCatalog } from './support/flatsFixture';
import { axeSerious } from './support/orderCatalogFx';
import {
  ITEM_ID as V_ITEM, ORDER_ID as V_ORDER, TEE, V2_CHEST_SHIFT, chestPrint, logoObject, teeObjects, teeOrder, teeV2WithHistory,
} from './support/flatsAdminFx';

/**
 * Вкладка «Дизайн» рабочего места `/sales/:id?tab=design` (веха 5а, задача 8):
 * настоящий supabase-js, настоящий холст konva и PDF-движок, мок сети с бакетами
 * `garment-flats` и `order-artworks` С ТЕЛОМ (`MockExtras.storageObjects`).
 *
 * Проверяется путь до базы (Review Focus плана):
 * - открытие вкладки ничего не пишет — ни нанесений, ни `flat_id`;
 * - логотип ложится в бакет заказа сразу, нанесение уходит в `order_v4_save_full`
 *   с раскладкой v1, `flat_id`, отступом от горловины; правка размера меняет цену;
 * - чужой SVG (`<script>`, `onload`) не исполняется ни на холсте, ни в PDF;
 * - PDF скачивается, текст в нём извлекается (кириллица), и под CSP боя;
 * - не черновик — только просмотр; телефон — превью-картинка без холста.
 */

const FIX = new URL('./fixtures/', import.meta.url);
const fixture = (name: string) => readFileSync(new URL(name, FIX));

const FLAT = 'tshirt-freefit';
const ORDER_ID = '6f1c2d3e-0000-4000-8000-0000000005a1';
const ITEM_ID = '6f1c2d3e-0000-4000-8000-0000000005b1';
const ORDER_NUMBER = 'PH-9100';

type SavedPrint = {
  key: string;
  zone: string;
  method: string;
  width_mm: number | null;
  height_mm: number | null;
  artwork_path: string;
  offset_mm: number | null;
  offset_from: string;
  offset_dir: string;
  layout: Record<string, unknown> | null;
};
type SavedItem = { key: string; flat_id: string; prints: SavedPrint[] };
type SavedOrder = { id: string; items: SavedItem[] };

const saves = (calls: MockCall[]) => calls
  .filter((c) => c.kind === 'rpc' && c.name === 'order_v4_save_full')
  .map((c) => (c.body as { p_order: SavedOrder }).p_order);
const uploads = (calls: MockCall[], bucket: string) => calls
  .filter((c) => c.kind === 'storage' && c.name.startsWith(`${bucket}/`))
  .map((c) => c.name.slice(bucket.length + 1));

/** Футболка Free Fit (T-004, категория `tshirts`, крой `free`) — типовой флэт FreeFit */
function teeItem(prints: unknown[] = []) {
  return {
    id: ITEM_ID,
    kind: 'sku',
    sku_code: 'T-004',
    product_type: 'Футболка',
    size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Белый (01-01)', sizes: { M: 20, L: 10 } }] },
    extras: [],
    sort_order: 0,
    flat_id: prints.length ? FLAT : '',
    order_item_prints: prints,
    order_item_labels: [],
  };
}

function orderRow(status: string, prints: unknown[] = []) {
  return {
    id: ORDER_ID,
    schema_version: 4,
    order_number: ORDER_NUMBER,
    title: 'Футболки для команды',
    customer: 'ООО Тест',
    status,
    kind: 'run',
    price_total: null,
    due_date: null,
    updated_at: FX_CREATED,
    created_by: null,
    order_items: [teeItem(prints)],
    order_notes_cards: [],
  };
}

const LOGO_PATH = `orders/${ORDER_ID}/logo/00000000-0000-4000-8000-000000000001-logo.png`;

/** Нанесение, уже стоящее на груди (строка `order_item_prints` с раскладкой v1) */
function placedPrint(layout: Record<string, unknown> = {}) {
  return {
    id: '6f1c2d3e-0000-4000-8000-0000000005c1',
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
      ...layout,
    },
  };
}

function designMock(calls: MockCall[], status = 'draft', prints: unknown[] = []): MockExtras {
  return {
    calls,
    salesOrders: [orderRow(status, prints)],
    catalogs: { app_config: { garmentFlats: seedFlatsCatalog([FLAT]) } },
    storageObjects: {
      ...seedFlatObjects([FLAT]),
      [`order-artworks/${LOGO_PATH}`]: { type: 'image/png', body: fixture('logo-300dpi.png') },
    },
  };
}

const canvas = (page: Page) => page.getByRole('application', { name: /^Холст/ });
/** Вкладка вида над холстом (веха 5б: `tablist` «Вид изделия», подпись — вид и число нанесений) */
const viewTab = (page: Page, label: string) => page.getByRole('tablist', { name: 'Вид изделия' })
  .getByRole('tab', { name: new RegExp(`^${label}( · \\d+)?$`) });
const layers = (page: Page) => page.getByRole('list', { name: 'Нанесения на виде' }).getByRole('listitem');
const pricePerUnit = (page: Page) => page.getByRole('heading', { name: /^Цена за штуку:/ });

/** Автосохранение дошло: индикатор «Сохранено» после правки */
async function settled(page: Page) {
  await expect(page.getByRole('status').filter({ hasText: /^Сохранено$/ })).toBeVisible();
}

async function openDesign(page: Page) {
  await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${ORDER_NUMBER} · ООО Тест`);
  await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
}

/** Логотип через «Загрузить логотип» (скрытый `<input type=file>` панели) */
async function uploadLogo(page: Page, name: string, mimeType: string) {
  await page.getByRole('region', { name: 'Логотипы' }).locator('input[type="file"]')
    .setInputFiles({ name, mimeType, buffer: fixture(name) });
}

/** Ни одного `alert`/`confirm` страницы и ни одной ошибки консоли */
function watchPage(page: Page) {
  const dialogs: string[] = [];
  const errors: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { dialogs, errors };
}

test.describe('вкладка «Дизайн»: холст пишет в заказ', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне холст только для просмотра — отдельный тест ниже');

  test('открытие: типовой флэт FreeFit, вид «Перед», запросов записи нет', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, designMock(calls));
    await openDesign(page);

    const silhouette = page.getByRole('combobox', { name: 'Силуэт' });
    await expect(silhouette).toHaveValue(FLAT);
    await expect(silhouette.locator('option:checked')).toHaveText(/FreeFit.*— типовой$/);
    await expect(viewTab(page, 'Перед')).toHaveAttribute('aria-selected', 'true');
    await expect(canvas(page)).toHaveAccessibleName(/вид перед$/);
    await expect(page.getByText('На этом виде нанесений нет.')).toBeVisible();

    await page.waitForTimeout(1500);
    expect(saves(calls)).toEqual([]);
    expect(calls.filter((c) => c.kind === 'storage')).toEqual([]);
    expect(calls.filter((c) => c.kind === 'rpc' && c.name === 'catalog_put')).toEqual([]);
  });

  test('PNG 300 dpi → бакет заказа, нанесение «Грудь (перед)» с раскладкой; ширина меняет цену, стрелки и Ctrl+Z', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, designMock(calls));
    await openDesign(page);

    await uploadLogo(page, 'logo-300dpi.png', 'image/png');
    await expect(layers(page)).toHaveCount(1);
    await expect(layers(page).first()).toContainText('Нанесение 1 · Грудь (перед)');
    await settled(page);

    const logo = uploads(calls, 'order-artworks');
    expect(logo).toHaveLength(1);
    expect(logo[0]).toMatch(new RegExp(`^orders/${ORDER_ID}/logo/[0-9a-f-]{36}-logo-300dpi\\.png$`));

    const first = saves(calls).at(-1)!;
    expect(first.items[0].flat_id).toBe(FLAT);
    const p = first.items[0].prints[0];
    expect(p.zone).toBe('Грудь (перед)');
    expect(p.artwork_path).toBe(logo[0]);
    expect(p.offset_from).toBe('neck_seam');
    expect(p.offset_dir).toBe('down');
    expect(p.layout).toMatchObject({
      v: 1, flat_id: FLAT, flat_version: 1, view: 'front', area_id: 'chest',
      asset: { type: 'png', px_w: 600, px_h: 300, dpi: expect.closeTo(300, 0), size_estimated: false },
    });

    // Новое нанесение выбрано, фокус — в «Ширине»
    const width = page.getByLabel('Ширина, мм', { exact: true });
    await expect(width).toBeFocused();
    // Шелкография до А4 считается по А4 (51 × 25 и 200 × 100 — одна цена), DTF — по площади:
    // техника DTF, затем ширина 200 — цена за штуку на панели меняется
    await page.getByRole('combobox', { name: 'Техника' }).selectOption('dtf');
    await settled(page);
    expect(saves(calls).at(-1)!.items[0].prints[0].method).toBe('dtf');
    const priceBefore = await pricePerUnit(page).textContent();
    await width.fill('200');
    await width.press('Enter');
    await expect(page.getByLabel('Высота, мм', { exact: true })).toHaveValue('100');
    await expect(pricePerUnit(page)).not.toHaveText(priceBefore ?? '');
    await settled(page);
    expect(saves(calls).at(-1)!.items[0].prints[0]).toMatchObject({ width_mm: 200, height_mm: 100 });

    // Стрелка вниз ×3 на холсте — отступ от горловины +3 мм; Ctrl+Z — назад одним шагом
    const offset = page.getByLabel('От горловины, мм', { exact: true });
    const before = Number(await offset.inputValue());
    await canvas(page).focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
    await expect(offset).toHaveValue(String(before + 3));
    await settled(page);
    expect(saves(calls).at(-1)!.items[0].prints[0].offset_mm).toBe(before + 3);
    await page.keyboard.press('Control+z');
    await expect(offset).toHaveValue(String(before));
    await settled(page);
    expect(saves(calls).at(-1)!.items[0].prints[0].offset_mm).toBe(before);
  });
});

/**
 * Старый заказ рисуется по своей версии силуэта (веха 5б, задача 7; Review Focus 1).
 * Справочник: флэт на версии 2 (рамка груди ниже на `V2_CHEST_SHIFT` мм) с историей
 * `[v1]`; позиция стоит на v1. Открытие ничего не пишет, SVG — по пути v1;
 * перетаскивание и новое размещение пишут `flat_version: 1`; перенос — только кнопкой.
 */
test.describe('вкладка «Дизайн»: позиция на прежней версии силуэта', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне холст только для просмотра');

  test('3. плашка «Силуэт обновлён», SVG v1, правки на v1 пишут flat_version 1, «Перенести на версию 2» → flat_version 2', async ({ page }) => {
    const calls: MockCall[] = [];
    const flatGets: string[] = [];
    page.on('request', (r) => {
      const m = /\/storage\/v1\/object\/(?:authenticated\/|sign\/)?garment-flats\/(.+?)(?:\?|$)/.exec(r.url());
      if (m && r.method() === 'GET') flatGets.push(decodeURIComponent(m[1]));
    });
    await installSupabaseMock(page, {
      calls,
      salesOrders: [teeOrder([chestPrint(1)])],
      catalogs: { app_config: { garmentFlats: teeV2WithHistory() } },
      storageObjects: { ...teeObjects(1, 2), ...logoObject() },
    });
    await page.goto(`/sales/${V_ORDER}?tab=design&item=${V_ITEM}&studio=1`);
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
    await expect(layers(page)).toHaveCount(1);
    await expect(page.getByText('Силуэт обновлён до версии 2. Нанесения стоят по версии 1.')).toBeVisible();
    const transfer = page.getByRole('button', { name: 'Перенести на версию 2' });
    await expect(transfer).toBeVisible();

    await page.waitForTimeout(1500);
    expect(saves(calls)).toEqual([]);
    expect(calls.filter((c) => c.kind === 'storage')).toEqual([]);
    expect(calls.filter((c) => c.kind === 'rpc' && c.name === 'catalog_put')).toEqual([]);
    expect(flatGets).toContain(`flats/${TEE}/v1/front.svg`);
    expect(flatGets.filter((g) => g.includes('/v2/'))).toEqual([]);

    // Перетаскивание (стрелки на холсте) на v1: раскладка остаётся на версии 1
    await layers(page).first().getByRole('button').first().click();
    const offset = page.getByLabel('От горловины, мм', { exact: true });
    const before = Number(await offset.inputValue());
    await canvas(page).focus();
    for (let i = 0; i < 2; i++) await page.keyboard.press('ArrowDown');
    await expect(offset).toHaveValue(String(before + 2));
    await settled(page);
    const moved = saves(calls).at(-1)!.items[0].prints[0];
    expect(moved.layout).toMatchObject({ flat_id: TEE, flat_version: 1, area_id: 'chest' });

    // Новое размещение на позиции v1 — тоже версия 1 (координаты v1, а не v2)
    await uploadLogo(page, 'logo-300dpi.png', 'image/png');
    await expect(layers(page)).toHaveCount(2);
    await settled(page);
    const both = saves(calls).at(-1)!.items[0].prints;
    expect(both.map((p) => (p.layout as { flat_version: number }).flat_version)).toEqual([1, 1]);
    // Верх груди v1 — 198,8 мм, v2 — ниже на V2_CHEST_SHIFT: логотип встал в рамку v1
    const placedY = (both[1].layout as { y_mm: number }).y_mm;
    expect(placedY).toBeLessThan(198.8 + V2_CHEST_SHIFT);
    expect(flatGets.filter((g) => g.includes('/v2/'))).toEqual([]);

    await transfer.click();
    await settled(page);
    await expect(page.getByText(/^Силуэт обновлён до версии 2/)).toHaveCount(0);
    const moved2 = saves(calls).at(-1)!.items[0].prints;
    expect(moved2.map((p) => (p.layout as { flat_version: number }).flat_version)).toEqual([2, 2]);
  });
});

/** Байты PDF → текст всех страниц (pdfjs-dist в Node, legacy-сборка — без воркера и DOM) */
async function pdfText(bytes: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false }).promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    parts.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await doc.destroy();
  return parts.join('\n');
}

/** «Скачать PDF макета»; вопрос проверки макета, если он есть, — «Скачать всё равно» */
async function downloadMaket(page: Page): Promise<Buffer> {
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Скачать PDF макета' }).click();
  const ask = page.getByRole('dialog').getByRole('button', { name: 'Скачать PDF всё равно' });
  const first = await Promise.race([downloading.then(() => 'download'), ask.waitFor().then(() => 'ask')]);
  if (first === 'ask') await ask.click();
  const dl = await downloading;
  expect(dl.suggestedFilename()).toMatch(/^PH-9100-.*-maket\.pdf$/);
  return readFileSync((await dl.path())!);
}

/** Запросы мимо приложения и мока Supabase (внешняя сеть) */
function watchExternal(page: Page): string[] {
  const out: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return;
    if (u.hostname !== 'localhost' && u.hostname !== 'e2e.invalid') out.push(r.url());
  });
  return out;
}

test.describe('вкладка «Дизайн»: чужие файлы, PDF, только чтение', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'На телефоне холст только для просмотра — отдельный тест ниже');

  test('«Спина» → SVG со <script> и onload: ничего не исполняется, нанесение есть, в blob только очищенное', async ({ page }) => {
    // Каждый object URL страницы — с его Blob: проверить, что на холст ушёл очищенный SVG
    await page.addInitScript(() => {
      const blobs: Blob[] = [];
      (window as unknown as { __blobs: Blob[] }).__blobs = blobs;
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (o: Blob | MediaSource) => {
        if (o instanceof Blob) blobs.push(o);
        return orig(o);
      };
    });
    const calls: MockCall[] = [];
    const seen = watchPage(page);
    const external = watchExternal(page);
    await installSupabaseMock(page, designMock(calls));
    await openDesign(page);
    const title = await page.title();

    await viewTab(page, 'Спина').click();
    await expect(canvas(page)).toHaveAccessibleName(/вид спина$/);
    await uploadLogo(page, 'logo-evil.svg', 'image/svg+xml');
    await expect(layers(page)).toHaveCount(1);
    await expect(layers(page).first()).toContainText('Нанесение 1 · Спина');
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
    await settled(page);

    const p = saves(calls).at(-1)!.items[0].prints[0];
    expect(p.layout).toMatchObject({ v: 1, view: 'back', area_id: 'back', asset: { type: 'svg' } });
    expect(uploads(calls, 'order-artworks')).toEqual([expect.stringMatching(/-logo-evil\.svg$/)]);

    const svgTexts = await page.evaluate(async () => {
      const blobs = (window as unknown as { __blobs: Blob[] }).__blobs;
      return Promise.all(blobs.filter((b) => b.type === 'image/svg+xml').map((b) => b.text()));
    });
    // Флэты (перед, спина) и логотип: логотип узнаётся по своему цвету, очищены все
    expect(svgTexts.filter((t) => t.includes('#1E5AA8'))).toHaveLength(1);
    for (const text of svgTexts) {
      expect(text).not.toMatch(/<script|<foreignObject|<image|javascript:|\son[a-z]+\s*=/i);
    }
    // И в PDF: логотип идёт вектором через санитайзер или растром — без исполнения
    const pdf = await downloadMaket(page);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await pdfText(pdf)).toContain('Спина');

    await page.waitForTimeout(500);
    expect(seen.dialogs).toEqual([]);
    expect(seen.errors).toEqual([]);
    expect(external).toEqual([]);
    expect(await page.title()).toBe(title);
  });

  test('PDF макета: файл %PDF меньше 8 МБ, в тексте «Грудь» и номер заказа; вредные строки — только текст', async ({ page }) => {
    const calls: MockCall[] = [];
    const seen = watchPage(page);
    const external = watchExternal(page);
    const mock = designMock(calls, 'draft', [placedPrint({ y_mm: 240, asset: {
      type: 'png', source_file: '"><svg onload=alert(1)>.png', intrinsic_w_mm: 50.8, intrinsic_h_mm: 25.4,
      px_w: 600, px_h: 300, dpi: 300, size_estimated: false, has_preview: false,
    } })]);
    (mock.salesOrders![0] as { customer: string }).customer = 'ООО "><image href=x onerror=alert(1)>';
    await installSupabaseMock(page, mock);
    await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
    await expect(layers(page)).toHaveCount(1);

    const pdf = await downloadMaket(page);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pdf.length).toBeLessThan(8 * 1024 * 1024);
    const text = await pdfText(pdf);
    expect(text).toContain('Грудь');
    expect(text).toContain(ORDER_NUMBER);
    await expect(page.getByRole('status').filter({ hasText: /^PDF макета готов: PH-9100-/ })).toBeAttached();

    expect(seen.dialogs).toEqual([]);
    expect(external).toEqual([]);
    expect(saves(calls)).toEqual([]);
  });

  test('логотип PDF → исходник и PNG-превью рядом (`<путь>.preview.png`)', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, designMock(calls));
    await openDesign(page);

    await uploadLogo(page, 'logo.pdf', 'application/pdf');
    await expect(layers(page)).toHaveCount(1);
    await settled(page);

    const paths = uploads(calls, 'order-artworks');
    expect(paths).toHaveLength(2);
    expect(paths[0]).toMatch(new RegExp(`^orders/${ORDER_ID}/logo/[0-9a-f-]{36}-logo\\.pdf$`));
    expect(paths[1]).toBe(`${paths[0]}.preview.png`);
    const p = saves(calls).at(-1)!.items[0].prints[0];
    expect(p.artwork_path).toBe(paths[0]);
    expect(p.layout).toMatchObject({ asset: { type: 'png', has_preview: true } });
  });

  test('заказ отправлен в работу (ready_to_launch): холст только для чтения, PDF скачивается, записей нет', async ({ page }) => {
    const calls: MockCall[] = [];
    await installSupabaseMock(page, designMock(calls, 'ready_to_launch', [placedPrint({ y_mm: 240 })]));
    await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
    await expect(layers(page)).toHaveCount(1);

    await expect(page.getByText(/^Силуэт: Футболка FreeFit/)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Силуэт' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Загрузить логотип' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'История правок' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Снять с изделия/ })).toHaveCount(0);

    // Стрелки на холсте ничего не двигают
    await layers(page).first().getByRole('button').first().click();
    const offset = page.getByLabel('От горловины, мм', { exact: true });
    const before = await offset.inputValue();
    await canvas(page).focus();
    await page.keyboard.press('ArrowDown');
    await expect(offset).toHaveValue(before);

    const pdf = await downloadMaket(page);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    await page.waitForTimeout(1500);
    expect(saves(calls)).toEqual([]);
  });

  test('390 px: превью-картинка, холста нет', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const calls: MockCall[] = [];
    await installSupabaseMock(page, designMock(calls, 'draft', [placedPrint({ y_mm: 240 })]));
    await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);

    const img = page.getByRole('img', { name: /вид перед: нанесений 1$/ });
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('src', /^data:image\/svg\+xml/);
    await expect(page.getByRole('application')).toHaveCount(0);
    await expect(page.locator('canvas')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Загрузить логотип' })).toHaveCount(0);
    await page.waitForTimeout(1000);
    expect(saves(calls)).toEqual([]);
  });

  test('вкладка «Дизайн» с нанесением: нет нарушений axe уровня serious/critical', async ({ page }) => {
    await installSupabaseMock(page, designMock([], 'draft', [placedPrint({ y_mm: 240 })]));
    await page.goto(`/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');
    await layers(page).first().getByRole('button').first().click();
    await expect(page.getByLabel('Ширина, мм', { exact: true })).toBeVisible();
    const report = await axeSerious(page);
    expect(report, `нарушения:\n${report.join('\n')}`).toEqual([]);
  });
});

/**
 * CSP боя в режиме ENFORCE (проверка безопасности L5): на бою политика пока
 * `Report-Only` (`vercel.json`), и нарушение там видно только в отчётах — здесь
 * та же строка ставится заголовком `Content-Security-Policy`, то есть нарушение
 * ломает действие. Идёт против СОБРАННОГО приложения (порт 4173): в dev Vite
 * вставляет встроенный скрипт и ходит по websocket — под `script-src 'self'`
 * dev не живёт вовсе, и проверка говорила бы о стенде, а не о бое. Заодно это
 * единственный e2e, где konva и PDF-движок идут продовой сборкой (подмены
 * `vite.config.js`). Единственная правка строки — мок Supabase `https://e2e.invalid`
 * рядом с `https://*.supabase.co`. Service worker выключен: он перехватывал бы
 * запросы мимо `page.route`.
 */
test.describe('CSP боя (enforce): pdfjs, холст и PDF макета', () => {
  test.skip(({ viewport }) => (viewport?.width ?? 1280) <= 760, 'Холст — на компьютере');
  test.skip(process.env.E2E_SKIP_PREVIEW === '1', 'Нужна сборка на порту 4173 (без E2E_SKIP_PREVIEW)');
  test.use({ serviceWorkers: 'block' });

  const PREVIEW = 'http://localhost:4173';

  function enforcedCsp(): string {
    const cfg = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8')) as {
      headers: { headers: { key: string; value: string }[] }[];
    };
    const value = cfg.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value;
    if (!value) throw new Error('в vercel.json нет Content-Security-Policy-Report-Only');
    return value.replaceAll('https://*.supabase.co', 'https://*.supabase.co https://e2e.invalid');
  }

  test('логотип PDF (воркер pdfjs) и «Скачать PDF макета» — ни одного нарушения CSP', async ({ page }) => {
    const csp = enforcedCsp();
    await page.addInitScript(() => {
      const list: string[] = [];
      (window as unknown as { __csp: string[] }).__csp = list;
      document.addEventListener('securitypolicyviolation', (e) => list.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    await page.route(`${PREVIEW}/sales/**`, async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
    });
    const seen = watchPage(page);
    const calls: MockCall[] = [];
    await installSupabaseMock(page, designMock(calls));
    await page.goto(`${PREVIEW}/sales/${ORDER_ID}?tab=design&item=${ITEM_ID}&studio=1`);
    await expect(canvas(page)).toHaveAttribute('data-ready', 'true');

    await uploadLogo(page, 'logo.pdf', 'application/pdf');
    await expect(layers(page)).toHaveCount(1);
    await settled(page);
    expect(uploads(calls, 'order-artworks')).toHaveLength(2);

    const pdf = await downloadMaket(page);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
    expect(violations).toEqual([]);
    expect(seen.errors.filter((e) => /Content Security Policy|CSP/i.test(e))).toEqual([]);
  });
});
