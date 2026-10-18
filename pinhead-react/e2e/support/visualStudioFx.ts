import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { FX_CREATED, type MockExtras } from './mockSupabase';
import { seedFlatObjects, seedFlatsCatalog } from './flatsFixture';
import { orderCatalogs } from './orderCatalogFx';

/**
 * Фикстуры эталонов раздела «Оформление заказа» (`e2e/visual.spec.ts`): вынесены
 * из спеки в вехе 8 (задача 9), чтобы файл эталонов держался под потолком 500 строк.
 */

/**
 * Справочники «из базы» (веха 8, задача 9, К13): поставщики, бирки и подвал ТЗ
 * пришли из мока — `catalogSource = 'db'`, «Каталог моделей и цен» снимается
 * в рабочем виде, а не в состоянии «Каталог не загрузился» (так был снят до вехи 8)
 */
export function dbCatalogs(): MockExtras['catalogs'] {
  const catalogs = orderCatalogs() as MockExtras['catalogs'] & { app_config: Record<string, unknown> };
  catalogs.app_config.labelLibrary = {
    kinds: [{
      type: 'main', name: 'Основная бирка', active: true, materials: [],
      variants: [{ id: 'woven', name: 'Тканая', price: 12, withMaterial: false, active: true }],
    }],
    schemes: [{ id: 'top', name: 'Сверху по центру', active: true }],
  };
  catalogs.app_config.tzSettings = { footerText: 'Допуск по размещению нанесения — до 2 см' };
  return catalogs;
}

/**
 * Тёмная тема до первой отрисовки: системная (`prefers-color-scheme`) и явная —
 * ключ `ph_theme`, откуда её читает `useTheme` (тот же приём, что у стенда `shots`)
 */
export async function darkTheme(page: Page) {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    try { localStorage.setItem('ph_theme', 'dark'); } catch { /* приватный режим */ }
  });
}

export const FLATS_ORDER = '6f1c2d3e-0000-4000-8000-0000000005e1';
export const FLATS_ITEM = '6f1c2d3e-0000-4000-8000-0000000005e2';
const FLATS_LOGO = `orders/${FLATS_ORDER}/logo/00000000-0000-4000-8000-000000000001-logo.png`;

/** Заказ с одной футболкой FreeFit и одним логотипом на груди (раскладка v1) */
export function designExtras(): MockExtras {
  return {
    catalogs: { app_config: { garmentFlats: seedFlatsCatalog(['tshirt-freefit']) } },
    storageObjects: {
      ...seedFlatObjects(['tshirt-freefit']),
      [`order-artworks/${FLATS_LOGO}`]: {
        type: 'image/png',
        body: readFileSync(new URL('../fixtures/logo-300dpi.png', import.meta.url)),
      },
    },
    salesOrders: [{
      id: FLATS_ORDER,
      schema_version: 4,
      order_number: 'PH-9100',
      title: 'Футболки для команды',
      customer: 'ООО Тест',
      status: 'draft',
      kind: 'run',
      price_total: null,
      due_date: null,
      updated_at: FX_CREATED,
      created_by: null,
      order_items: [{
        id: FLATS_ITEM,
        kind: 'sku',
        sku_code: 'T-004',
        product_type: 'Футболка',
        flat_id: 'tshirt-freefit',
        size_grid: { sizes: ['M', 'L'], rows: [{ color: 'Белый (01-01)', sizes: { M: 20, L: 10 } }] },
        extras: [],
        sort_order: 0,
        order_item_prints: [{
          id: '6f1c2d3e-0000-4000-8000-0000000005e3', sort_order: 0, method: 'dtf', zone: 'Грудь (перед)',
          sizes: [], width_mm: 200, height_mm: 100, colors: 1, textile: 'white', fill: 1,
          artwork_path: FLATS_LOGO, offset_mm: 111, offset_from: 'neck_seam', offset_dir: 'down',
          layout: {
            v: 1, flat_id: 'tshirt-freefit', flat_version: 1, view: 'front', area_id: 'chest',
            x_mm: 377.6, y_mm: 230, rotation_deg: 0, flip_h: false, flip_v: false,
            asset: {
              type: 'png', source_file: 'logo.png', intrinsic_w_mm: 50.8, intrinsic_h_mm: 25.4,
              px_w: 600, px_h: 300, dpi: 300, size_estimated: false, has_preview: false,
            },
          },
        }],
        order_item_labels: [],
      }],
      order_notes_cards: [],
    }],
  };
}
