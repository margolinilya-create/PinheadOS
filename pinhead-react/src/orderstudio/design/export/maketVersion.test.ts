/**
 * PDF макета, превью и проверка по версии позиции (веха 5б, задача 5; К15,
 * Review Focus 1): лист рукава, SVG пути своей версии, метаданные зоны —
 * текущие (наложение `flatAtVersion`).
 */
import { describe, it, expect, vi } from 'vitest';
import { newPlacedPrint, placementOf } from '../model/layout';
import { flatAtVersion } from '../catalog/flatVersion';
import { resolveItemFlat } from '../ui/useItemFlat';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { ZoneDefinition } from '../../../types/catalog';
import type { SalesPrintMethod } from '../../model/types';
import type { AssetMeta, FlatView, Placement, PrintArea, ProfileOf } from '../types';
import { versionedFlat } from '../fixtures5b.testutil';
import { maketPages } from './maketPages';
import { preflight } from './preflight';
import { exportMaketPdf } from './exportPdf';

vi.mock('svg2pdf.js', () => import('svg2pdf.js/dist/svg2pdf.es.js'));

const ZONES = ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[];
const ASSET: AssetMeta = {
  type: 'png', source_file: 'logo.png', intrinsic_w_mm: 60, intrinsic_h_mm: 40,
  px_w: 709, px_h: 472, dpi: 300, size_estimated: false, has_preview: false,
};
const FLAT = versionedFlat();
const V1 = flatAtVersion(FLAT, 1)!;
const placed = (areaId: string, view: FlatView['kind'], method: SalesPrintMethod = 'dtf') =>
  newPlacedPrint(ASSET, `orders/ab/logo/${areaId}.png`, areaId, { flat: V1, zonesCatalog: ZONES, category: 'tshirts', view, itemKind: 'sku', method })!;

const profileOf: ProfileOf = (m) => ({ id: m, label: m.toUpperCase(), colorMode: 'cmyk', dpi: { good: 150, min: 100 } });
const byArea = (a: PrintArea, m: SalesPrintMethod) => !a.methods?.length || a.methods.includes(m);

describe('флэт версии позиции для PDF и превью', () => {
  const item = { prints: [placed('chest', 'front'), placed('sleeve-l', 'sleeve_left')] };
  const { flat } = resolveItemFlat(FLAT, item.prints);

  it('позиция на v1 — флэт версии 1 (виды и пути v1)', () => {
    expect(flat?.version).toBe(1);
    expect(flat?.views.map((v) => v.svg_path)).toEqual([
      'flats/tshirt-test/v1/front.svg', 'flats/tshirt-test/v1/back.svg', 'flats/tshirt-test/v1/sleeve_left.svg',
    ]);
  });

  it('листы PDF: перед и левый рукав, SVG по пути v1', () => {
    const pages = maketPages(item, flat!);
    expect(pages.map((p) => p.view.kind)).toEqual(['front', 'sleeve_left']);
    expect(pages.map((p) => p.view.svg_path)).toEqual(['flats/tshirt-test/v1/front.svg', 'flats/tshirt-test/v1/sleeve_left.svg']);
  });

  it('exportMaketPdf качает силуэт каждого листа по пути версии позиции', async () => {
    const asked: string[] = [];
    await exportMaketPdf({
      orderId: 'ab', item, flat: flat!, garmentHex: '#ffffff',
      meta: { client: 'К', orderNumber: 'PH-1', itemTitle: 'Футболка', date: '18.10.2026', statusLabel: '' },
    }, {
      fonts: async () => { throw new Error('стоп после выбора силуэтов'); },
      flatMarkup: async (view) => { asked.push(view.svg_path); return null; },
      logos: { download: async () => null, rasterizer: {} as never },
    }).catch(() => undefined);
    expect(asked.sort()).toEqual(['flats/tshirt-test/v1/front.svg', 'flats/tshirt-test/v1/sleeve_left.svg']);
  });

  it('preflight на v1: техники зоны — из текущей версии (v2: только DTF)', () => {
    const dtg = placed('chest', 'front', 'dtg');
    const placements = [placementOf(dtg, flat!)!] as Placement[];
    const issues = preflight({ flat: flat!, placements, profileOf, methodAllowed: byArea });
    expect(issues.some((i) => i.message.includes('техника «DTG» не для этой зоны'))).toBe(true);
    // имя зоны в замечании — текущее (метаданные v2 наложены на геометрию v1)
    expect(issues.some((i) => i.message.startsWith('«Грудь новая»'))).toBe(true);
    expect(flat!.views[0].print_areas[0]).toMatchObject({ tz_row: 'front_l', polygon_mm: [[150, 140], [450, 140], [450, 540], [150, 540]] });
  });
});
