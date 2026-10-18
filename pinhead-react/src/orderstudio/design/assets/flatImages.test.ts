import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { newSalesItem } from '../../model/factory';
import type { Supplier } from '../../catalog/types';
import { NEUTRAL_GARMENT_HEX, garmentHexOf, loadFlatImage, loadFlatMarkup, releaseFlatImages } from './flatImages';

const api = vi.hoisted(() => ({ downloadFlatSvg: vi.fn() }));
vi.mock('../../api/garmentFlatsRead', async (orig) => ({ ...(await orig<typeof import('../../api/garmentFlatsRead')>()), ...api }));
const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock('../../../store/useToastStore', () => ({ toast }));

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_v: string) { queueMicrotask(() => this.onload?.()); }
}

const VIEW = { svg_path: 'flats/tshirt-test/v1/front.svg', scale_mm_per_unit: 1 };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 700"><g id="garment" fill="#ffffff"><path d="M0 0H600V700H0Z"/></g><script>alert(1)</script></svg>';

let blobs: Blob[] = [];
const revoked = vi.fn();

beforeEach(() => {
  releaseFlatImages();
  blobs = [];
  revoked.mockClear();
  api.downloadFlatSvg.mockReset();
  toast.error.mockReset();
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(URL, 'createObjectURL').mockImplementation((b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return `blob:${blobs.length}`;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoked);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadFlatImage', () => {
  it('флэт очищен повторно, перекрашен в цвет ткани, габарит в мм', async () => {
    api.downloadFlatSvg.mockResolvedValue(SVG);
    const res = await loadFlatImage(VIEW, '#112233');
    expect(api.downloadFlatSvg).toHaveBeenCalledWith(VIEW.svg_path);
    expect(res?.flatMm).toEqual({ w: 600, h: 700 });
    expect(blobs[0].type).toBe('image/svg+xml');
    const text = await blobs[0].text();
    expect(text).not.toMatch(/<script/i);
    expect(text).toMatch(/id="garment"[^>]*fill="#112233"/);
  });

  it('hex не по форме — нейтральный цвет (строка из справочника в атрибут не попадает)', async () => {
    api.downloadFlatSvg.mockResolvedValue(SVG);
    await loadFlatImage(VIEW, '#fff" onload="alert(1)');
    expect(await blobs[0].text()).toContain(`fill="${NEUTRAL_GARMENT_HEX}"`);
  });

  it('масштаб вида: единица SVG → мм', async () => {
    api.downloadFlatSvg.mockResolvedValue(SVG);
    expect((await loadFlatMarkup({ ...VIEW, scale_mm_per_unit: 0.5 }))?.flatMm).toEqual({ w: 300, h: 350 });
  });

  it('разметка скачивается один раз на путь; другой цвет — новая картинка без запроса', async () => {
    api.downloadFlatSvg.mockResolvedValue(SVG);
    await loadFlatImage(VIEW, '#112233');
    await loadFlatImage(VIEW, '#112233');
    await loadFlatImage(VIEW, '#445566');
    expect(api.downloadFlatSvg).toHaveBeenCalledTimes(1);
    expect(blobs).toHaveLength(2);
  });

  it('битый флэт — null и один тост; повтор не скачивает', async () => {
    api.downloadFlatSvg.mockResolvedValue('<html>не svg</html>');
    expect(await loadFlatImage(VIEW, '#112233')).toBeNull();
    expect(await loadFlatImage(VIEW, '#445566')).toBeNull();
    expect(api.downloadFlatSvg).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('сбой скачивания — null (тост даёт api)', async () => {
    api.downloadFlatSvg.mockResolvedValue(null);
    expect(await loadFlatImage(VIEW, '#112233')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('release освобождает object URL и забывает разметку', async () => {
    api.downloadFlatSvg.mockResolvedValue(SVG);
    await loadFlatImage(VIEW, '#112233');
    await loadFlatImage(VIEW, '#445566');
    releaseFlatImages();
    expect(revoked.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:1', 'blob:2']);
    await loadFlatImage(VIEW, '#112233');
    expect(api.downloadFlatSvg).toHaveBeenCalledTimes(2);
  });
});

describe('garmentHexOf — цвет ткани позиции', () => {
  const supplier = (colors: { code: string; name: string; hex: string }[]): Supplier => ({
    id: 's', name: 'S', isDefault: true, fabricSupplierNames: [], active: true,
    palette: { groups: [], colors: colors.map((c) => ({ ...c, group: '', active: true })) },
  });
  const SUP = [supplier([{ code: '15-01', name: 'Чёрный', hex: '#111111' }, { code: 'bad', name: 'Плохой', hex: '#fff" x="' }])];
  const grid = (...colors: string[]) => ({ sizes: ['M'], rows: colors.map((color) => ({ color, sizes: { M: 1 } })) });

  it('подпись строки «Имя (код)» → hex палитры', () => {
    expect(garmentHexOf(newSalesItem({ size_grid: grid('Чёрный (15-01)') }), SUP)).toBe('#111111');
  });

  it('первая строка с цветом; свободный текст и пусто — нейтральный', () => {
    expect(garmentHexOf(newSalesItem({ size_grid: grid('', 'Чёрный (15-01)') }), SUP)).toBe('#111111');
    expect(garmentHexOf(newSalesItem({ size_grid: grid('розовый') }), SUP)).toBe(NEUTRAL_GARMENT_HEX);
    expect(garmentHexOf(newSalesItem({ size_grid: grid() }), SUP)).toBe(NEUTRAL_GARMENT_HEX);
  });

  it('hex палитры не по форме — нейтральный', () => {
    expect(garmentHexOf(newSalesItem({ size_grid: grid('Плохой (bad)') }), SUP)).toBe(NEUTRAL_GARMENT_HEX);
  });
});
