import { describe, it, expect, vi } from 'vitest';
import type { PdfDoc } from '../../design/export/pdfCore';
import type { TzBox, TzLayout } from '../model/layoutPager';
import { assertGlyphs, containBox, drawLayout, type DrawOps, type TzVisual } from './drawBoxes';
import { TzPdfError } from './tzPdfError';

/** Заглушка jsPDF: только то, что зовёт рисование, со счётчиком страниц */
function fakePdf() {
  let pages = 1;
  const pdf = {
    getNumberOfPages: () => pages,
    addPage: vi.fn(() => { pages += 1; }),
    setPage: vi.fn(), setDrawColor: vi.fn(), setLineWidth: vi.fn(), setFont: vi.fn(), setFontSize: vi.fn(), setTextColor: vi.fn(),
    rect: vi.fn(), line: vi.fn(), text: vi.fn(), textWithLink: vi.fn(),
  };
  return pdf;
}

const box = (patch: Partial<TzBox>): TzBox => ({ page: 1, x: 10, y: 10, w: 50, h: 7, kind: 'text', ...patch });
const ops = (): DrawOps => ({ raster: vi.fn(), svg: vi.fn(async () => {}) });

describe('drawBoxes — раскладка ТЗ на страницы jsPDF', () => {
  it('страницы добавляются A4; первая страница группы — со сдвигом (склейка всех ТЗ)', async () => {
    const pdf = fakePdf();
    const layout: TzLayout = { pages: 3, boxes: [box({ page: 3, lines: ['x'], pt: 10 })] };
    await drawLayout(pdf as unknown as PdfDoc, layout, new Map(), ops(), 2);
    expect(pdf.addPage).toHaveBeenCalledTimes(3);
    expect(pdf.addPage).toHaveBeenCalledWith('a4', 'portrait');
    expect(pdf.setPage.mock.calls.map(([p]) => p)).toEqual([2, 3, 4]);
    expect(pdf.text).toHaveBeenCalledTimes(1);
  });

  it('ячейка — рамка и текст с отступом; строки идут вниз; жирный — словом bold', async () => {
    const pdf = fakePdf();
    const layout: TzLayout = { pages: 1, boxes: [box({ kind: 'cell', lines: ['а', 'б'], pt: 10, bold: true })] };
    await drawLayout(pdf as unknown as PdfDoc, layout, new Map(), ops());
    expect(pdf.rect).toHaveBeenCalledWith(10, 10, 50, 7);
    expect(pdf.setFont).toHaveBeenCalledWith('PHMaketSans', 'bold');
    const [first, second] = pdf.text.mock.calls;
    expect(first[0]).toBe('а');
    expect(first[1]).toBeGreaterThan(10);
    expect(second[2]).toBeGreaterThan(first[2]);
  });

  it('ссылка: https — textWithLink; javascript: — обычным текстом', async () => {
    const pdf = fakePdf();
    const layout: TzLayout = {
      pages: 1,
      boxes: [box({ lines: ['ok'], pt: 9, link: 'https://pinhead.example/sales/1' }), box({ lines: ['bad'], pt: 9, link: 'javascript:alert(1)' })],
    };
    await drawLayout(pdf as unknown as PdfDoc, layout, new Map(), ops());
    expect(pdf.textWithLink).toHaveBeenCalledTimes(1);
    expect(pdf.textWithLink.mock.calls[0][3]).toMatchObject({ url: 'https://pinhead.example/sales/1' });
    expect(pdf.text.mock.calls.map(([t]) => t)).toEqual(['bad']);
  });

  it('галочка — рамка и две линии, пустая — только рамка; линия — line', async () => {
    const pdf = fakePdf();
    const layout: TzLayout = {
      pages: 1,
      boxes: [box({ kind: 'check', w: 4, h: 4, checked: true }), box({ kind: 'check', w: 4, h: 4, checked: false }), box({ kind: 'line', w: 100, h: 0 })],
    };
    await drawLayout(pdf as unknown as PdfDoc, layout, new Map(), ops());
    expect(pdf.rect).toHaveBeenCalledTimes(2);
    expect(pdf.line).toHaveBeenCalledTimes(3);
  });

  it('картинка: растр — в пропорциях по центру ячейки, SVG — целиком; нет подготовленной — отказ', async () => {
    const o = ops();
    const raster: TzVisual = { kind: 'raster', bytes: new Uint8Array(), type: 'jpeg', alias: 'a', w: 200, h: 100 };
    const layout: TzLayout = { pages: 1, boxes: [box({ kind: 'image', w: 40, h: 40 }), box({ kind: 'scene', w: 112, h: 100 })] };
    await drawLayout(fakePdf() as unknown as PdfDoc, layout, new Map<number, TzVisual>([[0, raster], [1, { kind: 'svg', markup: '<svg/>' }]]), o);
    expect(o.raster).toHaveBeenCalledWith(raster, { x: 10, y: 20, w: 40, h: 20 });
    expect(o.svg).toHaveBeenCalledWith('<svg/>', { x: 10, y: 10, w: 112, h: 100 });
    await expect(drawLayout(fakePdf() as unknown as PdfDoc, layout, new Map(), o)).rejects.toThrow(TzPdfError);
  });

  it('containBox: высокая картинка — по высоте ячейки', () => {
    expect(containBox({ x: 0, y: 0, w: 40, h: 20 }, 0.5)).toEqual({ x: 15, y: 0, w: 10, h: 20 });
  });

  it('assertGlyphs: знак вне шрифта — отказ со знаком; невидимый — словами', () => {
    expect(() => assertGlyphs({ pages: 1, boxes: [box({ lines: ['Привет, цех'] })] })).not.toThrow();
    expect(() => assertGlyphs({ pages: 1, boxes: [box({ lines: ['Цена 100 ₽'] })] })).toThrow(/₽/);
    expect(() => assertGlyphs({ pages: 1, boxes: [box({ lines: ['a​b'] })] })).toThrow('невидимый знак U+200B');
  });
});
