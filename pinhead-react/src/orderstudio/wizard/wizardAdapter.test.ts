import { describe, it, expect } from 'vitest';
import { wizardToSalesItem, salesItemToWizard, colorLabel, colorCodeOf } from './wizardAdapter';
import type { WizardCatalogs, WizardItem } from './wizardAdapter';
import { defaultItemFields } from '../../store/slices/helpers';
import { newSalesLabel, newSalesPrint } from '../model/factory';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { ZONES_CATALOG_DEFAULT } from '../../data/constants';
import type { SkuItem, Fabric, ZoneDefinition } from '../../types/catalog';
import type { SalesItem } from '../model/types';

const CAT: WizardCatalogs = {
  skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
  fabricsCatalog: FABRICS_CATALOG_DEFAULT as unknown as Fabric[],
  zonesCatalog: ZONES_CATALOG_DEFAULT as unknown as ZoneDefinition[],
};
const SKU = CAT.skuCatalog[2];
const FABRIC = 'medas-kulirnaya-100-180';

/** Позиция визарда: модель, ткань, белый цвет, 10 S + 20 M, свой размер, грудь шелкографией */
const snap = (over: WizardItem = {}): WizardItem => ({
  ...JSON.parse(JSON.stringify(defaultItemFields)),
  sku: SKU,
  fabric: FABRIC,
  color: '01-01',
  sizes: { ...defaultItemFields.sizes, S: 10, M: 20 },
  customSizes: [{ label: '134', qty: 5 }],
  zones: ['front'],
  zoneTechs: { front: 'screen' },
  zonePrints: { front: { colors: 3, size: 'A4', textile: 'color', fx: 'puff' } },
  zoneArtworks: { front: 'https://files/art.pdf' },
  ...over,
});

describe('цвет строки сетки', () => {
  it('код палитры → «Имя (код)» и обратно', () => {
    expect(colorLabel('01-01')).toBe('Белый (01-01)');
    expect(colorCodeOf('Белый (01-01)')).toBe('01-01');
    expect(colorCodeOf('Свой зелёный')).toBe('');
    expect(colorLabel('')).toBe('');
  });
});

describe('визард → позиция v4', () => {
  it('модель, ткань, цвет и размеры', () => {
    const it = wizardToSalesItem(snap(), CAT);
    expect(it).toMatchObject({
      kind: 'sku',
      sku_code: SKU.code,
      product_type: SKU.name,
      fabric_code: FABRIC,
      main_fabric: 'Кулирка, 100% хб, 180 г/м²',
      color_supplier: 'Белый / Медас',
    });
    expect(it.size_grid).toEqual({
      sizes: ['S', 'M', '134'],
      rows: [{ color: 'Белый (01-01)', sizes: { S: 10, M: 20, 134: 5 } }],
    });
  });

  it('шелкография: формат → мм, цвета, подложка, эффект, макет', () => {
    const [p] = wizardToSalesItem(snap(), CAT).prints;
    expect(p).toMatchObject({
      method: 'silkscreen', zone: 'Грудь (перед)', width_mm: 210, height_mm: 297,
      colors: 3, textile: 'color', special: 'puff', artwork_url: 'https://files/art.pdf',
    });
  });

  it('каждая техника визарда переводится в свой метод v4', () => {
    const it = wizardToSalesItem(snap({
      zones: ['front', 'back', 'sleeve-l', 'sleeve-r', 'hood'],
      zoneTechs: { front: 'flex', back: 'dtg', 'sleeve-l': 'embroidery', 'sleeve-r': 'dtf', hood: 'screen' },
      flexZones: { front: { colors: 2, size: 'A5' } },
      dtgZones: { back: { size: 'A3', textile: 'white' } },
      embZones: { 'sleeve-l': { width_mm: 80, height_mm: 40, fill: 0.6, extra: 'metallic' } },
      dtfZones: { 'sleeve-r': { fmt: 'A6', width_mm: 90, height_mm: 90 } },
      zonePrints: { hood: { colors: 1, size: 'A6', textile: 'white', fx: 'none' } },
    }), CAT);
    expect(it.prints.map((p) => [p.method, p.width_mm, p.height_mm])).toEqual([
      ['heat_transfer', 148, 210],
      ['dtg', 297, 420],
      ['embroidery', 80, 40],
      ['dtf', 90, 90],
      ['silkscreen', 105, 148],
    ]);
    expect(it.prints[2]).toMatchObject({ fill: 0.6, special: 'metallic' });
    expect(it.prints[4].special).toBe('');
  });

  it('«без нанесения» — без нанесений', () => {
    expect(wizardToSalesItem(snap({ noPrint: true }), CAT).prints).toEqual([]);
  });

  it('бирки из конструктора визарда', () => {
    const it = wizardToSalesItem(snap({
      labelConfig: {
        careLabel: { enabled: true, logoOption: 'no-logo', composition: '100% хлопок', country: 'Россия', uploadData: null, comments: '' },
        mainLabel: { option: 'custom', placement: 'inseam', material: 'woven', color: 'black', uploadData: null, comments: '' },
        hangTag: { option: 'standard', uploadData: null, comments: '' },
      },
    }), CAT);
    expect(it.labels.map((l) => [l.label_type, l.place])).toEqual([
      ['composition', ''], ['brand', 'Боковой шов'], ['hangtag', ''],
    ]);
    expect(it.labels[0].comment).toBe('100% хлопок, Россия');
  });

  it('заметки дизайна — в комментарий нанесения, комментарий к размерам — в крой', () => {
    const it = wizardToSalesItem(snap({ designNotes: 'логотип по центру', sizeComment: 'рукав длиннее' }), CAT);
    expect(it.prints[0].comment).toBe('Дизайн: логотип по центру');
    expect(it.cutting_note).toBe('рукав длиннее');
  });
});

describe('повторная правка в визарде не затирает доработанное в карточке', () => {
  const base = (): SalesItem => {
    const first = wizardToSalesItem(snap(), CAT);
    return {
      ...first,
      sewing_note: 'двойная строчка',
      manual_unit_price: 990,
      prints: [
        { ...first.prints[0], pantone: ['186 C'], sizes: ['S'], offset_note: '8 см', on: 'cut' as const, comment: 'по центру' },
        newSalesPrint({ method: 'patch', zone: 'Рукав', comment: 'шеврон клиента' }),
      ],
      labels: [newSalesLabel({ label_type: 'brand', place: 'Горловина', comment: 'из карточки' })],
      size_grid: {
        sizes: ['S', 'M', '134'],
        rows: [
          { color: 'Белый (01-01)', sizes: { S: 10, M: 20, 134: 5 } },
          { color: 'Чёрный', sizes: { S: 7 } },
        ],
      },
    };
  };

  it('Pantone, группа размеров, отступ, «где», комментарий нанесения остаются; техника обновляется', () => {
    const b = base();
    const it = wizardToSalesItem(snap({ zonePrints: { front: { colors: 5, size: 'A3', textile: 'white', fx: 'none' } } }), CAT, b, 'Белый (01-01)');
    expect(it.prints[0]).toMatchObject({
      key: b.prints[0].key, pantone: ['186 C'], sizes: ['S'], offset_note: '8 см', on: 'cut',
      comment: 'по центру', colors: 5, width_mm: 297, height_mm: 420,
    });
  });

  it('шеврон из карточки (у визарда такой техники нет) остаётся', () => {
    const it = wizardToSalesItem(snap(), CAT, base(), 'Белый (01-01)');
    expect(it.prints.map((p) => p.method)).toEqual(['silkscreen', 'patch']);
  });

  it('правится строка своего цвета, другие цвета сетки остаются', () => {
    const it = wizardToSalesItem(snap({ sizes: { ...defaultItemFields.sizes, S: 40 }, customSizes: [] }), CAT, base(), 'Белый (01-01)');
    expect(it.size_grid.rows).toEqual([
      { color: 'Белый (01-01)', sizes: { S: 40 } },
      { color: 'Чёрный', sizes: { S: 7 } },
    ]);
  });

  it('бирка того же типа из карточки не затирается, ТЗ пошива и ручная цена целы', () => {
    const it = wizardToSalesItem(snap({
      labelConfig: { ...defaultItemFields.labelConfig, mainLabel: { ...defaultItemFields.labelConfig.mainLabel, option: 'custom' } },
    }), CAT, base(), 'Белый (01-01)');
    expect(it.labels).toHaveLength(1);
    expect(it.labels[0].comment).toBe('из карточки');
    expect(it.sewing_note).toBe('двойная строчка');
    expect(it.manual_unit_price).toBe(990);
  });
});

describe('позиция v4 → визард (для «Изменить в визарде»)', () => {
  it('туда-обратно: модель, ткань, цвет, размеры, зоны и параметры техники', () => {
    const w = snap({
      zones: ['front', 'sleeve-l'],
      zoneTechs: { front: 'screen', 'sleeve-l': 'embroidery' },
      embZones: { 'sleeve-l': { width_mm: 80, height_mm: 40, fill: 0.6, extra: 'puff' } },
    });
    const back = salesItemToWizard(wizardToSalesItem(w, CAT), CAT);
    expect(back.sku.code).toBe(SKU.code);
    expect(back.fabric).toBe(FABRIC);
    expect(back.color).toBe('01-01');
    expect(back.sizes).toMatchObject({ S: 10, M: 20 });
    expect(back.customSizes).toEqual([{ label: '134', qty: 5 }]);
    expect(back.zones).toEqual(['front', 'sleeve-l']);
    expect(back.zoneTechs).toEqual({ front: 'screen', 'sleeve-l': 'embroidery' });
    expect(back.zonePrints.front).toEqual({ colors: 3, size: 'A4', textile: 'color', fx: 'puff' });
    expect(back.embZones['sleeve-l']).toEqual({ width_mm: 80, height_mm: 40, fill: 0.6, extra: 'puff' });
    expect(back.zoneArtworks).toEqual({ front: 'https://files/art.pdf' });
    expect(back.noPrint).toBe(false);
  });

  it('строка сетки выбирается по цвету', () => {
    const it = wizardToSalesItem(snap(), CAT);
    it.size_grid.rows.push({ color: 'Чёрный (15-01)', sizes: { L: 3 } });
    const back = salesItemToWizard(it, CAT, 'Чёрный (15-01)');
    expect(back.sizes.L).toBe(3);
    expect(back.sizes.S).toBe(0);
  });
});
