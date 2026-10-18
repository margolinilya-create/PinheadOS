/**
 * Фикстуры админки «Флэты и зоны» (веха 5б, задача 7): справочник флэтов
 * с историей версий, бакет `garment-flats` с телами видов, заказ на прежней
 * версии силуэта. Основа — флэт сида `tshirt-freefit` (перед и спина v1):
 * та же форма, что кладёт «Загрузить типовые флэты».
 *
 * Мок держит справочники и бакет С СОСТОЯНИЕМ на объект `MockExtras`,
 * поэтому каждая функция отдаёт свежую копию.
 */
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FX_CREATED, type MockCall, type MockExtras } from './mockSupabase';
import { seedFlatObjects, seedFlatsCatalog } from './flatsFixture';
import { orderCatalogs } from './orderCatalogFx';
import { ZONES_CATALOG_DEFAULT } from '../../src/data/constants.js';

export const TEE = 'tshirt-freefit';
const FIX = new URL('../fixtures/', import.meta.url);
export const fixture = (name: string) => readFileSync(new URL(name, FIX));

type View = { kind: string; svg_path: string; print_areas: { id: string; polygon_mm: number[][] }[] } & Record<string, unknown>;
type Flat = { id: string; version: number; views: View[]; history?: unknown[] } & Record<string, unknown>;
type Catalog = { version: number; flats: Flat[] };
type Objects = Record<string, { type: string; body: Buffer }>;

/** Справочник с одним флэтом сида на версии 1 */
export function teeV1(): Catalog {
  return seedFlatsCatalog([TEE]) as unknown as Catalog;
}

/** Тела видов флэта сида по путям версии `version` (`garment-flats/flats/<id>/v<N>/<вид>.svg`) */
export function teeObjects(...versions: number[]): Objects {
  const v1 = seedFlatObjects([TEE]);
  const out: Objects = {};
  for (const n of versions) {
    for (const [key, obj] of Object.entries(v1)) out[key.replace('/v1/', `/v${n}/`)] = { ...obj };
  }
  return out;
}

/** Сдвиг рамки зоны «Грудь» v2 против v1, мм — по нему видно, по какой версии рисуют */
export const V2_CHEST_SHIFT = 40;

/**
 * Флэт на версии 2 с историей `[v1]`: у v2 пути `v2`, рамка груди ниже на
 * `V2_CHEST_SHIFT` мм; виды v1 — в `history` как есть (так их пишет выпуск)
 */
export function teeV2WithHistory(): Catalog {
  const cat = teeV1();
  const v1 = cat.flats[0];
  const views = v1.views.map((v) => ({
    ...v,
    svg_path: v.svg_path.replace('/v1/', '/v2/'),
    print_areas: v.print_areas.map((a) => (a.id === 'chest'
      ? { ...a, polygon_mm: a.polygon_mm.map(([x, y]) => [x, y + V2_CHEST_SHIFT]) }
      : a)),
  }));
  cat.flats[0] = { ...v1, version: 2, views, history: [{ version: 1, views: structuredClone(v1.views) }] };
  return cat;
}

/**
 * Набор мока для админки: справочники заказа + флэты + справочник зон (как на бою
 * после миграции H: строка `zonesCatalog` есть — без неё редактор зон на запасном
 * пути и сохранять не даёт), бакет, журнал
 */
export function adminExtras(calls: MockCall[], garmentFlats: unknown, objects: Objects, more: Partial<MockExtras> = {}): MockExtras {
  const catalogs = orderCatalogs() as { catalog_config: Record<string, unknown>; app_config: Record<string, unknown> };
  catalogs.app_config.garmentFlats = garmentFlats;
  catalogs.app_config.zonesCatalog = structuredClone(ZONES_CATALOG_DEFAULT);
  return { calls, catalogs, storageObjects: objects, ...more };
}

export const ORDER_ID = '6f1c2d3e-0000-4000-8000-0000000007a1';
export const ITEM_ID = '6f1c2d3e-0000-4000-8000-0000000007b1';
export const LOGO_PATH = `orders/${ORDER_ID}/logo/00000000-0000-4000-8000-000000000071-logo.png`;

/** Нанесение на груди по раскладке версии `version` флэта сида */
export function chestPrint(version: number) {
  return {
    id: '6f1c2d3e-0000-4000-8000-0000000007c1',
    sort_order: 0, method: 'dtf', zone: 'Грудь (перед)', sizes: [], width_mm: 200, height_mm: 100,
    colors: 1, textile: 'white', fill: 1, artwork_path: LOGO_PATH,
    offset_mm: 80, offset_from: 'neck_seam', offset_dir: 'down',
    layout: {
      v: 1, flat_id: TEE, flat_version: version, view: 'front', area_id: 'chest',
      x_mm: 377.6, y_mm: 238.8, rotation_deg: 0, flip_h: false, flip_v: false,
      asset: {
        type: 'png', source_file: 'logo.png', intrinsic_w_mm: 50.8, intrinsic_h_mm: 25.4,
        px_w: 600, px_h: 300, dpi: 300, size_estimated: false, has_preview: false,
      },
    },
  };
}

/** Черновик v4 с футболкой Free Fit (T-004, `tshirts`, крой `free`) на флэте сида */
export function teeOrder(prints: unknown[] = [], status = 'draft') {
  return {
    id: ORDER_ID, schema_version: 4, order_number: 'PH-9150', title: 'Футболки', customer: 'ООО Флэт',
    status, kind: 'run', price_total: null, due_date: null, updated_at: FX_CREATED, created_by: null,
    order_items: [{
      id: ITEM_ID, kind: 'sku', sku_code: 'T-004', product_type: 'Футболка',
      size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Белый (01-01)', sizes: { M: 20, L: 10 } }] },
      extras: [], sort_order: 0, flat_id: TEE, order_item_prints: prints, order_item_labels: [],
    }],
    order_notes_cards: [],
  };
}

/** Логотип заказа в бакете `order-artworks` (тело — PNG 300 dpi фикстуры) */
export function logoObject(): Objects {
  return { [`order-artworks/${LOGO_PATH}`]: { type: 'image/png', body: fixture('logo-300dpi.png') } };
}

/**
 * Текст, который редактор кладёт в бакет при переносе вида (К2): прежний
 * файл через санитайзер приложения — тем же кодом в той же странице (Vite
 * отдаёт исходник по адресу модуля), а не копией правил в спеке
 */
export async function sanitizedInPage(page: Page, svg: string): Promise<string> {
  return page.evaluate(async (text) => {
    const { sanitizeSvg } = await import('/src/orderstudio/design/assets/sanitizeSvg.ts');
    const res = sanitizeSvg(text);
    if (!res.ok) throw new Error(`санитайзер отказал: ${res.error}`);
    return res.svg;
  }, svg);
}

/** Загрузки в бакет флэтов — пути без имени бакета, по порядку */
export const flatUploads = (calls: MockCall[]) => calls
  .filter((c) => c.kind === 'storage' && c.name.startsWith('garment-flats/'))
  .map((c) => c.name.slice('garment-flats/'.length));

/** Записи справочника флэтов (`catalog_put('app_config', 'garmentFlats')`) */
export const flatPuts = (calls: MockCall[]) => calls
  .filter((c) => c.kind === 'rpc' && c.name === 'catalog_put' && (c.body as { p_key?: string }).p_key === 'garmentFlats')
  .map((c) => c.body as { p_value: Catalog; p_base: unknown });
