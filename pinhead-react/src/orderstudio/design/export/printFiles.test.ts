import { describe, it, expect, vi } from 'vitest';
import { newSalesItem, newSalesPrint } from '../../model/factory';
import { pngBytes, textBytes } from '../assets/bytes.testutil';
import { readPngDpi } from '../assets/loadAsset';
import { buildPrintFiles, dpiCandidates, printFileName, printablePrints } from './printFiles';

const ORDER = { id: '0b6c1f0e-1d2a-4c3b-8e4f-5a6b7c8d9e0f', number: 'PH-1234' };
const path = (f: string) => `orders/${ORDER.id}/logo/${f}`;
const layout = (view: string) => ({ v: 1, flat_id: 't', flat_version: 1, view, area_id: 'chest', x_mm: 0, y_mm: 0, rotation_deg: 0, flip_h: false, flip_v: false,
  asset: { type: 'png', source_file: 'a.png', intrinsic_w_mm: 10, intrinsic_h_mm: 10, size_estimated: false, has_preview: false } });

/** Имена записей ZIP по центральному каталогу */
function zipNames(zip: Uint8Array): string[] {
  const dv = new DataView(zip.buffer, zip.byteOffset);
  const end = zip.length - 22;
  let at = dv.getUint32(end + 16, true);
  const out: string[] = [];
  for (let k = 0; k < dv.getUint16(end + 10, true); k++) {
    const len = dv.getUint16(at + 28, true);
    out.push(new TextDecoder().decode(zip.subarray(at + 46, at + 46 + len)));
    at += 46 + len;
  }
  return out;
}

describe('файлы печати (веха 5в, Э4а)', () => {
  it('имя файла: заказ, номер, вид, техника, мм; при снижении — dpi', () => {
    const p = newSalesPrint({ method: 'dtf', width_mm: 280, height_mm: 350, layout: layout('front') as never });
    expect(printFileName('PH-1234', 1, p, 'png')).toBe('PH-1234_p2_front_dtf_280x350mm.png');
    expect(printFileName('PH-1234', 0, { ...p, layout: null, zone_id: 'sleeve-l' }, 'png', 150)).toBe('PH-1234_p1_sleeve-l_dtf_280x350mm_150dpi.png');
  });

  it('попытки DPI: А3 — с 300; 1,5 м по стороне — 300 не влезает в холст; огромное — не ниже 72', () => {
    expect(dpiCandidates(297, 420)[0]).toBe(300);
    expect(dpiCandidates(1500, 500)[0]).toBe(150);
    const big = dpiCandidates(5000, 5000);
    expect(big).toEqual([Math.max(72, big[0])]);
    expect(big[0]).toBeGreaterThanOrEqual(72);
  });

  it('холст отказал при 300 — файл при 150 с пометкой в имени', async () => {
    const item = newSalesItem({ prints: [newSalesPrint({ method: 'dtf', width_mm: 100, height_mm: 50, artwork_path: path('a.png'), layout: layout('front') as never })] });
    const rasterize = vi.fn(async (_s, _k, w: number) => (w > 1000 ? null : pngBytes(4, 2)));
    const res = await buildPrintFiles(ORDER, item, { download: async () => new Blob([pngBytes(20, 10) as BlobPart]), rasterize });
    expect(zipNames(res.zip)[0]).toBe('PH-1234_p1_front_dtf_100x50mm_150dpi.png');
  });

  it('в архиве — PNG 300 dpi на растр, исходник у SVG и PDF, список; без мм и макета — не входят', async () => {
    const item = newSalesItem({ prints: [
      newSalesPrint({ method: 'dtf', width_mm: 100, height_mm: 50, artwork_path: path('a.png'), layout: layout('front') as never }),
      newSalesPrint({ method: 'silkscreen', width_mm: 200, height_mm: 100, artwork_path: path('b.svg'), layout: layout('back') as never }),
      newSalesPrint({ method: 'embroidery', width_mm: 80, height_mm: 60, artwork_path: path('c.pdf') }),
      newSalesPrint({ method: 'dtf', width_mm: null, height_mm: null, artwork_path: path('d.png') }),
      newSalesPrint({ method: 'dtf', width_mm: 10, height_mm: 10, artwork_path: '' }),
    ] });
    expect(printablePrints(item).map((x) => x.index)).toEqual([0, 1, 2]);
    const files: Record<string, Uint8Array> = {
      [path('a.png')]: pngBytes(20, 10),
      [path('b.svg')]: textBytes('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10" onload="x()"/></svg>'),
      [path('c.pdf')]: textBytes('%PDF-1.4\n%%EOF'),
    };
    const rasterize = vi.fn(async () => pngBytes(4, 2));
    const res = await buildPrintFiles(ORDER, item, { download: async (_o, p) => new Blob([files[p] as BlobPart]), rasterize });
    expect(res.count).toBe(3);
    const names = zipNames(res.zip);
    expect(names).toEqual([
      'PH-1234_p1_front_dtf_100x50mm.png',
      'PH-1234_p2_back_silkscreen_200x100mm.svg',
      'PH-1234_p2_back_silkscreen_200x100mm.png',
      'PH-1234_p3_zone_embroidery_80x60mm.pdf',
      'читать.txt',
    ]);
    // растр — в натуральную величину при 300 dpi
    expect(rasterize).toHaveBeenNthCalledWith(1, expect.anything(), 'png', 1181, 591);
    expect(res.fileName).toBe('PH-1234-print-files.zip');
    // SVG в архиве — очищенный
    const text = new TextDecoder().decode(res.zip);
    expect(text).not.toContain('onload');
    expect(readPngDpi(pngBytes(4, 2))).toBeNull();
    expect(text).toContain('исходник (вектор)');
  });

  it('макет не скачался — замечание, архив собран', async () => {
    const item = newSalesItem({ prints: [newSalesPrint({ method: 'dtf', width_mm: 10, height_mm: 10, artwork_path: path('a.png') })] });
    const res = await buildPrintFiles(ORDER, item, { download: async () => null, rasterize: async () => null });
    expect(res.count).toBe(0);
    expect(res.notes).toEqual(['Нанесение 1: макет не скачался — повторите позже']);
  });
});
