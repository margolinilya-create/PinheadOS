import { describe, it, expect } from 'vitest';
import { tzCatalogsOf } from './tzCatalogs';

describe('tzCatalogsOf', () => {
  it('упаковка — из прайса, флэты — аргументом; не массивы — пустые списки', () => {
    const flats = { version: 1, flats: [] } as never;
    const cat = tzCatalogsOf({
      fabricsCatalog: [{ code: 'f1', name: 'Кулирка' }],
      extrasCatalog: null,
      labelLibrary: { kinds: [] },
      prices: { packOptions: [{ key: 'zip', name: 'ЗИП' }] },
      zonesCatalog: [{ id: 'chest', name: 'Грудь' }],
      suppliers: undefined,
      tzSettings: { footerText: 'Подвал' },
      skuCatalog: [{ code: 'T-1', category: 'tshirts' }, { code: 'H-1', category: 'hoodies' }, { code: '', category: 'x' }, null],
    }, flats);
    expect(cat).toEqual({
      fabricsCatalog: [{ code: 'f1', name: 'Кулирка' }],
      extrasCatalog: [],
      labelLibrary: { kinds: [] },
      packOptions: [{ key: 'zip', name: 'ЗИП' }],
      zonesCatalog: [{ id: 'chest', name: 'Грудь' }],
      garmentFlats: flats,
      suppliers: [],
      tzSettings: { footerText: 'Подвал' },
      skuCategories: { 'T-1': 'tshirts', 'H-1': 'hoodies' },
    });
  });

  it('нет прайса и библиотек — null и пустые списки, а не падение', () => {
    const cat = tzCatalogsOf({
      fabricsCatalog: undefined, extrasCatalog: undefined, labelLibrary: undefined, prices: undefined,
      zonesCatalog: undefined, suppliers: undefined, tzSettings: undefined, skuCatalog: undefined,
    }, null);
    expect(cat.skuCategories).toEqual({});
    expect(cat.packOptions).toEqual([]);
    expect(cat.labelLibrary).toBeNull();
    expect(cat.tzSettings).toBeNull();
    expect(cat.garmentFlats).toBeNull();
  });
});
