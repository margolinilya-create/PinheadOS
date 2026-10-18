import { describe, expect, it } from 'vitest';
import type { Supplier } from '../catalog/types';
import { newSalesItem, newSalesPrint } from './factory';
import { retextilePrints, textileOfColor, textileOfItem, type TextileCatalogs } from './garmentTextile';

const supplier = (id: string, colors: [string, string, string][], extra: Partial<Supplier> = {}): Supplier => ({
  id, name: id, active: true, isDefault: false, fabricSupplierNames: [],
  palette: { groups: [], colors: colors.map(([code, name, hex]) => ({ code, name, hex, group: '', active: true })) },
  ...extra,
} as Supplier);

const CAT: TextileCatalogs = {
  suppliers: [
    supplier('cotton', [['40-01', 'Чёрный', '#1A1A1A'], ['01-01', 'Белый', '#FFFFFF'], ['11-01', 'Серый меланж', '#B5B5B5']], { isDefault: true }),
    supplier('medas', [['5001', 'Белый', '#FAFAFA'], ['5002', 'Молочный', '#F5F0E1']], { fabricSupplierNames: ['Медас'] }),
  ],
  fabricsCatalog: [{ code: 'medas180', supplier: 'Медас' }, { code: 'td', supplier: 'ТД Коттон' }],
};

const item = (color: string, fabric = 'td') => newSalesItem({
  fabric_code: fabric,
  size_grid: { sizes: ['M'], rows: color ? [{ color, sizes: { M: 30 } }] : [] },
});

describe('textileOfColor — подложка по цвету изделия (обход, H-2)', () => {
  it('тёмный и цветной цвет палитры — цветное изделие', () => {
    expect(textileOfColor('Чёрный (40-01)', CAT, 'td')).toBe('color');
    expect(textileOfColor('Серый меланж (11-01)', CAT, 'td')).toBe('color');
  });

  it('белый и светлый — белое изделие, в т. ч. из палитры поставщика ткани', () => {
    expect(textileOfColor('Белый (01-01)', CAT, 'td')).toBe('white');
    expect(textileOfColor('Белый (5001)', CAT, 'medas180')).toBe('white');
    expect(textileOfColor('Молочный (5002)', CAT, 'medas180')).toBe('white');
  });

  it('цвета нет — белое (прежнее умолчание); свой текст — по слову «белый», иначе цветное', () => {
    expect(textileOfColor('', CAT, 'td')).toBe('white');
    expect(textileOfColor('белый', CAT, 'td')).toBe('white');
    expect(textileOfColor('розовый', CAT, 'td')).toBe('color');
  });

  it('позиция — по первой строке сетки', () => {
    expect(textileOfItem(item('Чёрный (40-01)'), CAT)).toBe('color');
    expect(textileOfItem(item(''), CAT)).toBe('white');
  });
});

describe('retextilePrints — смена цвета изделия', () => {
  it('шелкография и DTG с подложкой прежнего цвета переходят на новую; выбранное руками и прочие техники — нет', () => {
    const silk = newSalesPrint({ method: 'silkscreen', textile: 'white' });
    const dtg = newSalesPrint({ method: 'dtg', textile: 'white' });
    const manual = newSalesPrint({ method: 'silkscreen', textile: 'color' });
    const emb = newSalesPrint({ method: 'embroidery', textile: 'white' });
    const out = retextilePrints([silk, dtg, manual, emb], 'white', 'color');
    expect(out.map((p) => p.textile)).toEqual(['color', 'color', 'color', 'white']);
    expect(out[2]).toBe(manual);
    expect(out[3]).toBe(emb);
  });

  it('подложка не меняется — тот же массив', () => {
    const prints = [newSalesPrint()];
    expect(retextilePrints(prints, 'white', 'white')).toBe(prints);
  });
});
