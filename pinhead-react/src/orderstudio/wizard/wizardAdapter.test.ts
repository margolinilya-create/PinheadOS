import { describe, it, expect } from 'vitest';
import { salesItemToWizard, colorLabel, colorCodeOf, garmentPatch } from './wizardAdapter';
import type { WizardCatalogs, GarmentSnap } from './wizardAdapter';
import { defaultItemFields } from '../../store/slices/helpers';
import { newSalesItem, newSalesLabel, newSalesPrint } from '../model/factory';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import type { SkuItem, Fabric, ZoneDefinition } from '../../types/catalog';
import type { SalesItem, SalesPrint } from '../model/types';
import { SUPPLIERS_SEED } from '../catalog/seeds';
import { updateColor } from '../catalog/suppliers';

const CAT: WizardCatalogs = {
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT as unknown as Fabric[],
  zonesCatalog: ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[],
  suppliers: SUPPLIERS_SEED,
};
const SKU = CAT.skuCatalog[2];
const FABRIC = 'medas-kulirnaya-100-180';

/**
 * Позиция v4: модель, ткань, белый цвет, 10 S + 20 M, свой размер 134,
 * грудь шелкографией A4 (3 цвета, цветная подложка, PUFF, макет).
 */
const item = (prints: Partial<SalesPrint>[] = [{
  method: 'silkscreen', zone: 'Грудь (перед)', width_mm: 210, height_mm: 297,
  colors: 3, textile: 'color', special: 'puff', artwork_url: 'https://files/art.pdf',
}]): SalesItem => newSalesItem({
  sku_code: SKU.code, product_type: SKU.name, fit: SKU.fit || 'regular', fabric_code: FABRIC,
  size_grid: { sizes: ['S', 'M', '134'], rows: [{ color: 'Белый (01-01)', sizes: { S: 10, M: 20, 134: 5 } }] },
  prints: prints.map((p) => newSalesPrint(p)),
});

describe('цвет строки сетки', () => {
  const S = SUPPLIERS_SEED;
  it('код палитры → «Имя (код)» и обратно', () => {
    expect(colorLabel('01-01', S)).toBe('Белый (01-01)');
    expect(colorCodeOf('Белый (01-01)', S)).toBe('01-01');
    expect(colorCodeOf('01-01', S)).toBe('01-01');
    expect(colorCodeOf('Свой зелёный', S)).toBe('');
    expect(colorLabel('', S)).toBe('');
  });

  it('свой цвет текстом — как есть', () => {
    expect(colorLabel('розовый', S)).toBe('розовый');
    expect(colorCodeOf('Хаки (светлый)', S)).toBe('');
  });

  it('палитры — аргументом: новый цвет справочника распознаётся без правки кода', () => {
    const list = updateColor(S, 'medastex', '01-01', { name: 'Снежный' });
    expect(colorLabel('01-01', list)).toBe('Снежный (01-01)');
    expect(colorCodeOf('Снежный (01-01)', list)).toBe('01-01');
  });

  it('снятый с продажи цвет подписывается, как раньше', () => {
    const list = updateColor(S, 'medastex', '01-01', { active: false });
    expect(colorLabel('01-01', list)).toBe('Белый (01-01)');
    expect(colorCodeOf('Белый (01-01)', list)).toBe('01-01');
  });
});

describe('позиция v4 → визард (буфер позиции)', () => {
  it('модель, ткань, цвет, размеры, зоны и параметры техники', () => {
    const back = salesItemToWizard(item([
      { method: 'silkscreen', zone: 'Грудь (перед)', width_mm: 210, height_mm: 297, colors: 3, textile: 'color', special: 'puff' },
      { method: 'embroidery', zone: 'Левый рукав', width_mm: 80, height_mm: 40, fill: 0.6, special: 'puff', on: 'cut' },
    ]), CAT);
    expect(back.sku.code).toBe(SKU.code);
    expect(back.fabric).toBe(FABRIC);
    expect(back.color).toBe('01-01');
    expect(back.sizes).toMatchObject({ S: 10, M: 20 });
    expect(back.customSizes).toEqual([{ label: '134', qty: 5 }]);
    expect(back.zones).toEqual(['front', 'sleeve-l']);
    expect(back.zoneTechs).toEqual({ front: 'screen', 'sleeve-l': 'embroidery' });
    expect(back.zonePrints.front).toEqual({ colors: 3, size: 'A4', textile: 'color', fx: 'puff' });
    expect(back.embZones['sleeve-l']).toEqual({ width_mm: 80, height_mm: 40, fill: 0.6, extra: 'puff', extras: [], mode: 'cut' });
    expect(back.noPrint).toBe(false);
  });

  it('макеты зон в буфер не грузятся (перенос визард → позиция убран в вехе 5а)', () => {
    expect(salesItemToWizard(item(), CAT)).not.toHaveProperty('zoneArtworks');
  });

  it('техники без аналога в визарде (шевроны, сублимация) в буфер не идут', () => {
    const back = salesItemToWizard(item([
      { method: 'patch', zone: 'Рукав' }, { method: 'sublimation', zone: 'Спина' },
    ]), CAT);
    expect(back.zones).toEqual([]);
    expect(back.noPrint).toBe(false);
  });

  it('каждая техника v4 → своя техника визарда и формат', () => {
    const back = salesItemToWizard(item([
      { method: 'heat_transfer', zone: 'Грудь (перед)', width_mm: 148, height_mm: 210, colors: 2 },
      { method: 'dtg', zone: 'Спина', width_mm: 300, height_mm: 410, textile: 'white' },
      { method: 'dtf', zone: 'Правый рукав', width_mm: 90, height_mm: 90 },
    ]), CAT);
    expect(back.zoneTechs).toEqual({ front: 'flex', back: 'dtg', 'sleeve-r': 'dtf' });
    expect(back.flexZones.front).toEqual({ colors: 2, size: 'A5' });
    // DTG — свои размеры (А3 = 30×41 см), а не лист A3
    expect(back.dtgZones.back).toEqual({ size: 'A3', textile: 'white' });
    expect(back.dtfZones['sleeve-r']).toMatchObject({ width_mm: 90, height_mm: 90 });
  });

  it('вышивка: обе надбавки и способ', () => {
    const back = salesItemToWizard(item([
      { method: 'embroidery', zone: 'Грудь (перед)', width_mm: 80, height_mm: 60, special: 'puff+metallic', on: 'finished' },
      { method: 'embroidery', zone: 'Спина', width_mm: 80, height_mm: 60, garment_kind: 'Шеврон' },
    ]), CAT);
    expect(back.embZones.front).toMatchObject({ extra: 'puff', extras: ['metallic'], mode: 'garment' });
    expect(back.embZones.back.mode).toBe('patch');
  });

  it('строка сетки выбирается по цвету', () => {
    const it = item();
    it.size_grid.rows.push({ color: 'Чёрный (15-01)', sizes: { L: 3 } });
    const back = salesItemToWizard(it, CAT, 'Чёрный (15-01)');
    expect(back.sizes.L).toBe(3);
    expect(back.sizes.S).toBe(0);
  });

  it('без нанесений — noPrint', () => {
    expect(salesItemToWizard(item([]), CAT).noPrint).toBe(true);
  });
});

describe('формат по мм — по технике (16.10)', () => {
  const one = (p: Partial<SalesPrint>) => salesItemToWizard(item([{ zone: 'Спина', ...p }]), CAT);

  it.each([['A6', 100, 150], ['A5', 150, 200], ['A4', 200, 300], ['A3', 300, 410], ['A3+', 400, 450]])(
    'DTG %s', (size, w, h) => {
      expect(one({ method: 'dtg', width_mm: w, height_mm: h }).dtgZones.back.size).toBe(size);
    });

  it.each([['A4', 210, 297], ['A3', 297, 420]])('шелкография %s', (size, w, h) => {
    expect(one({ method: 'silkscreen', width_mm: w, height_mm: h }).zonePrints.back.size).toBe(size);
  });
});

describe('буфер позиции → позиция (garmentPatch)', () => {
  const g = (over: Partial<GarmentSnap> = {}): GarmentSnap => ({
    sku: SKU, fabric: FABRIC, color: '01-01', colorSupplier: 'medastex',
    sizes: { ...defaultItemFields.sizes, S: 10 }, customSizes: [], extras: [],
    fit: SKU.fit || 'regular', clientFabric: false,
    ...over,
  });
  /** Позиция с ручными текстами: их не должна переписать правка размеров */
  const base = (over: Partial<SalesItem> = {}): SalesItem => newSalesItem({
    sku_code: SKU.code, product_type: 'Футболка своими словами', fit: 'regular',
    fabric_code: FABRIC, main_fabric: 'Кулирка, ручной текст', color_supplier: 'Белый / ручной текст',
    size_grid: { sizes: ['S'], rows: [{ color: 'Белый (01-01)', sizes: { S: 10 } }] },
    prints: [newSalesPrint({ zone: 'Грудь' })], labels: [newSalesLabel({ label_type: 'brand' })],
    ...over,
  });
  const moreSizes = { ...defaultItemFields.sizes, S: 10, M: 5 };

  it('правка только размеров не трогает ткань, тип и ручной color_supplier', () => {
    const b = base();
    const out = garmentPatch(g(), g({ sizes: moreSizes }), b, CAT)!;
    expect(out).not.toBeNull();
    expect(out).toMatchObject({
      main_fabric: 'Кулирка, ручной текст',
      product_type: 'Футболка своими словами',
      color_supplier: 'Белый / ручной текст',
    });
    expect(out.size_grid).toEqual({ sizes: ['S', 'M'], rows: [{ color: 'Белый (01-01)', sizes: { S: 10, M: 5 } }] });
  });

  it('цвет свободным текстом сохраняется при правке размеров', () => {
    const b = base({ size_grid: { sizes: ['S'], rows: [{ color: 'Свой зелёный', sizes: { S: 10 } }] } });
    const out = garmentPatch(g({ color: '' }), g({ color: '', sizes: moreSizes }), b, CAT)!;
    expect(out.size_grid.rows).toEqual([{ color: 'Свой зелёный', sizes: { S: 10, M: 5 } }]);
  });

  it('модель не из каталога сохраняется', () => {
    const b = base({ sku_code: 'СВОЯ-1', product_type: 'Своя модель', fit: 'oversize' });
    const out = garmentPatch(g({ sku: null }), g({ sku: null, sizes: moreSizes, extras: ['x'] }), b, CAT)!;
    expect(out).toMatchObject({ sku_code: 'СВОЯ-1', product_type: 'Своя модель', fit: 'oversize', extras: ['x'] });
  });

  it('смена модели пишет код, тип и крой', () => {
    const other = CAT.skuCatalog[0];
    const out = garmentPatch(g(), g({ sku: other, fit: other.fit || 'regular' }), base(), CAT)!;
    expect(out).toMatchObject({ sku_code: other.code, product_type: other.name, fit: other.fit || 'regular' });
  });

  it('смена ткани переписывает main_fabric и color_supplier', () => {
    const out = garmentPatch(g(), g({ fabric: 'cotton-kulirnaya-100-180' }), base(), CAT)!;
    expect(out).toMatchObject({
      fabric_code: 'cotton-kulirnaya-100-180',
      main_fabric: 'Кулирка, 100% хб, 180 г/м²',
      color_supplier: 'Белый / ТД Коттон',
    });
  });

  it('смена ткани со сбросом цвета не стирает подпись строки', () => {
    const out = garmentPatch(g(), g({ fabric: 'cotton-kulirnaya-100-180', color: '' }), base(), CAT)!;
    expect(out.size_grid.rows[0].color).toBe('Белый (01-01)');
    expect(out.color_supplier).toBe('Белый / ТД Коттон');
  });

  it('смена цвета на цветной переводит подложку нанесений, выбранную руками — нет (обход, H-2)', () => {
    const b = base({ prints: [
      newSalesPrint({ method: 'silkscreen', textile: 'white' }),
      newSalesPrint({ method: 'dtg', textile: 'white' }),
      newSalesPrint({ method: 'embroidery', textile: 'white' }),
    ] });
    const out = garmentPatch(g(), g({ color: '14-02' }), b, CAT)!;
    expect(out.size_grid.rows[0].color).toBe('Сиреневый (14-02)');
    expect(out.prints.map((p) => p.textile)).toEqual(['color', 'color', 'white']);
    // Обратно на белый — снова «белое»
    const back = garmentPatch(g({ color: '14-02' }), g(), out, CAT)!;
    expect(back.prints.map((p) => p.textile)).toEqual(['white', 'white', 'white']);
  });

  it('правка размеров подложку не трогает', () => {
    const b = base({ prints: [newSalesPrint({ method: 'silkscreen', textile: 'color' })] });
    const out = garmentPatch(g(), g({ sizes: moreSizes }), b, CAT)!;
    expect(out.prints).toBe(b.prints);
  });

  it('client_fabric — ткань не пишется', () => {
    const b = base({ client_fabric: true, fabric_code: '', main_fabric: 'Ткань клиента', color_supplier: 'клиент' });
    expect(garmentPatch(g({ fabric: '' }), g({ fabric: 'cotton-kulirnaya-100-180' }), b, CAT)).toBeNull();
    const viaBuffer = garmentPatch(g({ clientFabric: true }), g({ clientFabric: true, fabric: 'cotton-kulirnaya-100-180' }), base(), CAT);
    expect(viaBuffer).toBeNull();
  });

  it('смена цвета — подпись единственной строки и color_supplier', () => {
    const out = garmentPatch(g(), g({ color: '15-01' }), base(), CAT)!;
    expect(out.size_grid.rows).toEqual([{ color: 'Светло-фиолетовый (15-01)', sizes: { S: 10 } }]);
    expect(out.color_supplier).toBe('Светло-фиолетовый / Медас');
  });

  it('нанесения и бирки — те же объекты по ссылке', () => {
    const b = base();
    const out = garmentPatch(g(), g({ sizes: moreSizes }), b, CAT)!;
    expect(out.prints).toBe(b.prints);
    expect(out.labels).toBe(b.labels);
  });

  it('«Белый (5001)» у ткани Медас (код Коттонпрома) сохраняется при правке размеров', () => {
    const b = base({ size_grid: { sizes: ['S'], rows: [{ color: 'Белый (5001)', sizes: { S: 10 } }] } });
    const loaded = salesItemToWizard(b, CAT);
    expect(loaded.color).toBe('5001');
    const out = garmentPatch(g({ color: '5001' }), g({ color: '5001', sizes: moreSizes }), b, CAT)!;
    expect(out.size_grid.rows).toEqual([{ color: 'Белый (5001)', sizes: { S: 10, M: 5 } }]);
    expect(out.color_supplier).toBe('Белый / ручной текст');
  });

  it('смена ткани: скобки срезаются только у распознанного кода', () => {
    const own = base({ size_grid: { sizes: ['S'], rows: [{ color: 'Хаки (светлый)', sizes: { S: 10 } }] } });
    const out = garmentPatch(g({ color: 'Хаки (светлый)' }), g({ color: 'Хаки (светлый)', fabric: 'cotton-kulirnaya-100-180' }), own, CAT)!;
    expect(out.color_supplier).toBe('Хаки (светлый) / ТД Коттон');
    const coded = base({ size_grid: { sizes: ['S'], rows: [{ color: 'Белый (5001)', sizes: { S: 10 } }] } });
    const out2 = garmentPatch(g({ color: '5001' }), g({ color: '5001', fabric: 'cotton-kulirnaya-100-180' }), coded, CAT)!;
    expect(out2.color_supplier).toBe('Белый / ТД Коттон');
  });

  it('«розовый»: в буфер как есть, загрузка без правки ничего не пишет', () => {
    const b = base({ size_grid: { sizes: ['S'], rows: [{ color: 'розовый', sizes: { S: 10 } }] } });
    const loaded = salesItemToWizard(b, CAT);
    expect(loaded.color).toBe('розовый');
    const snapLoaded = g({ color: loaded.color, sizes: loaded.sizes });
    expect(garmentPatch(snapLoaded, snapLoaded, b, CAT)).toBeNull();
    // Правка размеров — подпись строки остаётся «розовый»
    const out = garmentPatch(snapLoaded, { ...snapLoaded, sizes: { ...loaded.sizes, M: 5 } }, b, CAT)!;
    expect(out.size_grid.rows[0].color).toBe('розовый');
  });

  it('свой цвет, вписанный в буфер, пишется как есть', () => {
    const out = garmentPatch(g(), g({ color: 'малиновый' }), base(), CAT)!;
    expect(out.size_grid.rows[0].color).toBe('малиновый');
    expect(out.color_supplier).toBe('малиновый / Медас');
  });

  it('снятый цвет в позиции остаётся при правке размеров', () => {
    const cat = { ...CAT, suppliers: updateColor(SUPPLIERS_SEED, 'medastex', '01-01', { active: false }) };
    const b = base();
    expect(salesItemToWizard(b, cat).color).toBe('01-01');
    const out = garmentPatch(g(), g({ sizes: moreSizes }), b, cat)!;
    expect(out.size_grid.rows[0].color).toBe('Белый (01-01)');
  });

  it('нет разницы → null', () => {
    expect(garmentPatch(g(), g(), base(), CAT)).toBeNull();
    // Разница только в палитре — писать нечего
    expect(garmentPatch(g(), g({ colorSupplier: 'cottonprom' }), base(), CAT)).toBeNull();
  });

  it('позиция с несколькими строками сетки не пишется', () => {
    const b = base({ size_grid: { sizes: ['S'], rows: [{ color: 'A', sizes: { S: 1 } }, { color: 'B', sizes: { S: 2 } }] } });
    expect(garmentPatch(g(), g({ sizes: moreSizes }), b, CAT)).toBeNull();
  });
});
