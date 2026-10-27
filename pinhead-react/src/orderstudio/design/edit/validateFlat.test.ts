import { describe, it, expect } from 'vitest';
import { CATALOG_MAX_BYTES, CATALOG_WARN_BYTES, validateFlat, type FlatCheckCtx } from './validateFlat';
import { addArea, setAreaPolygon, updateArea, updateMeta } from './flatEdit';
import { catalogBytes } from '../catalog/flatVersion';
import { area, clone, flat } from '../fixtures.testutil';
import seed from '../seed/garmentFlats.seed.json';
import { ZONES_CATALOG_DEFAULT } from '../../../data/constants';
import type { GarmentFlat } from '../types';
import type { ZoneLike } from './flatAreas';

const ZONES: ZoneLike[] = ZONES_CATALOG_DEFAULT;
const ctx = (patch: Partial<FlatCheckCtx> = {}): FlatCheckCtx => ({
  reservedIds: new Set(), isNew: false, base: null, activeFlats: [], zonesCatalog: ZONES,
  skuCodes: new Set(['T-006']), flatMm: {}, catalogBytes: 1000, ...patch,
});
const texts = (xs: { text: string }[]) => xs.map((x) => x.text);

describe('validateFlat', () => {
  it('все 35 флэтов сида со справочником зон по умолчанию — без ошибок', () => {
    const flats = (seed as unknown as { flats: GarmentFlat[] }).flats;
    expect(flats).toHaveLength(35);
    for (const f of flats) {
      const r = validateFlat(f, ctx({ base: f, activeFlats: flats, skuCodes: new Set(f.sku_codes) }));
      expect(r.errors, f.id).toEqual([]);
    }
  });

  it('замечание схемы — ошибка с адресом вида, зоны и поля', () => {
    const f = updateArea(flat(), 'front', 'chest', { safe_inset_mm: -1 });
    const [e] = validateFlat(f, ctx({ base: flat() })).errors;
    expect(e).toMatchObject({ view: 'front', areaId: 'chest', field: 'safe_inset_mm' });
    expect(e.text).toMatch(/safe_inset_mm/);
  });

  it('id нового флэта — ошибка; у сохранённого не проверяется', () => {
    const f = flat({ id: 'tshirt-test' });
    const reserved = new Set(['tshirt-test']);
    expect(validateFlat(f, ctx({ isNew: true, reservedIds: reserved })).errors[0]).toMatchObject({ field: 'id' });
    expect(validateFlat(f, ctx({ isNew: false, reservedIds: reserved, base: f })).errors).toEqual([]);
  });

  it('нетронутая зона со снятым zone_id — предупреждение; новая или изменённая — ошибка', () => {
    const zones = ZONES.map((z) => (z.id === 'front' ? { ...z, active: false } : z));
    const base = flat();
    const kept = validateFlat(base, ctx({ base, zonesCatalog: zones }));
    expect(kept.errors).toEqual([]);
    expect(texts(kept.warnings)).toContain('Зона «Грудь (перед)» снята с подбора');
    const added = addArea(base, 'front', area({ id: 'chest2', zone_id: 'front' }));
    expect(validateFlat(added, ctx({ base, zonesCatalog: zones })).errors).toEqual([
      expect.objectContaining({ text: 'Зона «Грудь (перед)» снята с подбора', view: 'front', areaId: 'chest2', field: 'zone_id' }),
    ]);
    const changed = updateArea(base, 'back', 'back', { zone_id: 'no-such-zone' });
    expect(texts(validateFlat(changed, ctx({ base })).errors)).toEqual(['Зоны «no-such-zone» нет в справочнике зон']);
    const missingKept = validateFlat(changed, ctx({ base: changed }));
    expect(missingKept.errors).toEqual([]);
    expect(texts(missingKept.warnings)).toContain('Зоны «no-such-zone» нет в справочнике зон');
  });

  it('справочник зон не загрузился — одно предупреждение, без ошибок по зонам', () => {
    const f = updateArea(flat(), 'back', 'back', { zone_id: 'no-such-zone' });
    const r = validateFlat(f, ctx({ zonesCatalog: null }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.filter((w) => /Справочник зон/.test(w.text))).toHaveLength(1);
  });

  it('переименование сохранённой служебной зоны — ошибка (решение 5); новой — нет', () => {
    const base = flat();
    const renamed = updateArea(base, 'back', 'label', { name: 'Бирка' });
    expect(validateFlat(renamed, ctx({ base })).errors).toEqual([
      expect.objectContaining({ view: 'back', areaId: 'label', field: 'name' }),
    ]);
    expect(validateFlat(renamed, ctx({ base: null })).errors).toEqual([]);
  });

  it('код модели у двух активных флэтов — ошибка; у снятого — нет; нет в каталоге — предупреждение', () => {
    const other = { ...flat({ id: 'polo-test', name: 'Поло' }), sku_codes: ['T-006'] };
    const f = updateMeta(flat(), { sku_codes: ['T-006', 'X-1'] });
    const r = validateFlat(f, ctx({ base: f, activeFlats: [other, f] }));
    expect(texts(r.errors)).toEqual(['Модель T-006 уже у флэта «Поло» — снимите её там или снимите флэт с подбора']);
    expect(texts(r.warnings)).toContain('Модели X-1 нет в каталоге моделей');
    expect(validateFlat(f, ctx({ base: f, activeFlats: [{ ...other, active: false }] })).errors).toEqual([]);
    expect(validateFlat({ ...f, active: false }, ctx({ base: f, activeFlats: [other] })).errors).toEqual([]);
  });

  it('размер справочника — байты UTF-8: больше 1 МБ — ошибка, больше 80 % — предупреждение', () => {
    const name = 'ф'.repeat(100);
    expect(catalogBytes({ name })).toBe(JSON.stringify({ name: '' }).length + 200);
    const f = flat();
    expect(texts(validateFlat(f, ctx({ base: f, catalogBytes: CATALOG_MAX_BYTES + 1 })).errors)[0]).toMatch(/больше лимита/);
    const warn = validateFlat(f, ctx({ base: f, catalogBytes: CATALOG_WARN_BYTES + 1 }));
    expect(warn.errors).toEqual([]);
    expect(texts(warn.warnings)[0]).toMatch(/из 1024 КБ/);
  });

  it('предупреждения: зона не для категорий, вне силуэта, многоугольник', () => {
    const f = clone(flat());
    f.categories = ['accessories'];
    const poly = setAreaPolygon(f, 'front', 'chest', [[150, 140], [450, 140], [300, 900]]);
    const r = validateFlat(poly, ctx({ base: poly, flatMm: { front: { w: 600, h: 800 } } }));
    expect(r.errors).toEqual([]);
    const w = texts(r.warnings);
    expect(w).toContain('Зона «Грудь (перед)» не предлагается категориям флэта');
    expect(w).toContain('Зона «chest» выходит за силуэт');
    expect(w.some((t) => /многоугольник/.test(t))).toBe(true);
  });
});

describe('validateFlat — модели только категорий флэта (B1/B5, веха 5в)', () => {
  const tee = { ...(seed as unknown as { flats: GarmentFlat[] }).flats.find((f) => f.categories.includes('tshirts'))!, sku_codes: ['H-002'] };
  it('модель другой категории в sku_codes — ошибка с подсказкой, что делать', () => {
    const r = validateFlat(tee, ctx({ skuCodes: new Set(['H-002']), skuCategory: new Map([['H-002', 'hoodies']]) }));
    expect(r.errors).toContainEqual({ field: 'sku_codes', text: 'Модель H-002 — из категории «Худи», а флэт — для категорий: «Футболки». Уберите модель или добавьте флэту её категорию' });
  });
  it('категория совпадает, модели нет в каталоге или каталог не передан — без этой ошибки', () => {
    const own = { ...tee, sku_codes: ['T-006'] };
    expect(validateFlat(own, ctx({ skuCategory: new Map([['T-006', 'tshirts']]) })).errors.filter((e) => e.text.includes('из категории'))).toEqual([]);
    expect(validateFlat(tee, ctx({ skuCodes: new Set(['H-002']) })).errors.filter((e) => e.text.includes('из категории'))).toEqual([]);
  });
});
