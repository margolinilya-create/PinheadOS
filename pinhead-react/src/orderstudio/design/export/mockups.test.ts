import { describe, it, expect, vi } from 'vitest';
import { newSalesItem } from '../../model/factory';
import { flat as makeFlat } from '../fixtures.testutil';
import { newPlacedPrint } from '../model/layout';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import { pngBytes } from '../assets/bytes.testutil';
import { buildMockups, itemColors, mockupFileName, mockupSceneSvg } from './mockups';

const FLAT = makeFlat();
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 760"><g id="garment"><path d="M0 0h600v760H0z" fill="#cccccc"/></g></svg>';
const ASSET = { type: 'png' as const, source_file: 'logo.png', intrinsic_w_mm: 100, intrinsic_h_mm: 50, size_estimated: false, has_preview: false };
const placed = (view: 'front' | 'back') => newPlacedPrint(ASSET, 'orders/0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f/logo/a.png', view === 'front' ? 'chest' : 'back', {
  flat: FLAT, zonesCatalog: ZONES_CATALOG_DEFAULT, category: 'tshirts', view, itemKind: 'sku', method: 'dtf',
})!;

describe('мокапы (веха 5в, Э5)', () => {
  it('имя файла — код цвета из подписи, иначе номер; цвета без дублей', () => {
    expect(mockupFileName('PH-1234', 'front', 'Чёрный (15-01)', 0)).toBe('PH-1234_mockup_front_15-01.png');
    expect(mockupFileName('PH-1234', 'sleeve_left', 'розовый', 2)).toBe('PH-1234_mockup_sleeve-l_c3.png');
    const grid = { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: {} }, { color: ' ', sizes: {} }, { color: 'Белый (01-01)', sizes: {} }, { color: 'Чёрный (15-01)', sizes: {} }] };
    expect(itemColors({ size_grid: grid })).toEqual(['Белый (01-01)', 'Чёрный (15-01)']);
  });

  it('сцена: подложка, превью картинкой, подпись экранирована', () => {
    const { svg, w } = mockupSceneSvg(SVG, { w: 600, h: 760 }, 'PH-1 · <b>Худи</b>');
    expect(w).toBe(1600);
    expect(svg).toContain('data:image/svg+xml;base64,');
    expect(svg).toContain('PH-1 · &lt;b&gt;Худи&lt;/b&gt;');
  });

  it('PNG на каждую пару «вид с нанесением × цвет»; вид без нанесений не входит', async () => {
    const item = newSalesItem({
      product_type: 'Футболка',
      prints: [placed('front'), placed('back')],
      size_grid: { sizes: ['M'], rows: [{ color: 'Белый (01-01)', sizes: { M: 1 } }, { color: 'Чёрный (15-01)', sizes: { M: 1 } }] },
    });
    const toPng = vi.fn(async () => pngBytes(2, 2));
    const res = await buildMockups({ number: 'PH-1234' }, item, FLAT, [], {
      flatMarkup: async () => ({ markup: SVG, flatMm: { w: 600, h: 760 } }),
      artwork: async () => 'data:image/png;base64,iVBORw0KGgo=',
      toPng,
    });
    expect(res.count).toBe(4);
    expect(res.fileName).toBe('PH-1234-mockups.zip');
    const text = new TextDecoder().decode(res.zip);
    expect(text).toContain('PH-1234_mockup_front_01-01.png');
    expect(text).toContain('PH-1234_mockup_back_15-01.png');
    expect(toPng).toHaveBeenCalledTimes(4);
  });
});
