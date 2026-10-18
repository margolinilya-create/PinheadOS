import { describe, it, expect } from 'vitest';
import { quote, initZoneData, toggleZone, withTech, zonesOf, type ZoneData } from './expressModel';
import { SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT } from '../../../data';
import type { ExtraItem, Fabric, SkuItem, Trim } from '../../../types/catalog';

/**
 * Суммы экспресса до и после рестайла (веха 8, задача 4) равны: числа сняты
 * со старого экрана 18.10 (`ExpressCalc` на `express.css`, курс 90) теми же шагами.
 */
const SKUS = SKU_CATALOG_DEFAULT as unknown as SkuItem[];
const FABRICS = FABRICS_CATALOG_DEFAULT as unknown as Fabric[];
const sku = (code: string) => SKUS.find((s) => s.code === code)!;
const fabric = (code: string) => FABRICS.find((f) => f.code === code)!;

function calc(skuCode: string, fabricCode: string | null, qty: number, zones: ZoneData, extras: string[] = []) {
  return quote({
    sku: sku(skuCode), fabric: fabricCode ? fabric(fabricCode) : null, qty, zones, extras,
    fabricsCatalog: FABRICS, trimCatalog: TRIM_CATALOG_DEFAULT as unknown as Trim[],
    extrasCatalog: EXTRAS_CATALOG_DEFAULT as unknown as ExtraItem[], usdRate: 90,
  });
}

const on = (z: ZoneData, id: string) => toggleZone(z, id);
const set = (z: ZoneData, id: string, patch: object) => ({ ...z, [id]: { ...z[id], ...patch } });

describe('экспресс: цена за штуку округляется, как на рабочем месте (обход, M-3)', () => {
  it('ВВЕРХ до 5 ₽ (`ceilTo(roundTo)` в priceOrder); итог — округлённая цена × тираж', () => {
    const tee = initZoneData(zonesOf(sku('T-003')));
    expect(calc('T-003', 'medas-kulirnaya-100-160', 100, tee)).toMatchObject({ unitRaw: 1267, unitPrice: 1270, total: 127_000 });
    const z = initZoneData(zonesOf(sku('SW-001')));
    const sw = set(on(z, 'back'), 'back', { fmt: 'A3', col: 2, textile: 'color', fx: 'puff' });
    const q = calc('SW-001', 'medas-futher-petlya-65-320', 300, sw);
    expect(q.unitPrice % 5).toBe(0);
    expect(q.unitPrice - q.unitRaw).toBeGreaterThanOrEqual(0);
    expect(q.unitPrice - q.unitRaw).toBeLessThan(5);
    expect(q.total).toBe(q.unitPrice * 300);
  });
});

describe('экспресс: суммы равны снятым со старого экрана', () => {
  const tee = initZoneData(zonesOf(sku('T-003')));

  it('футболка, кулирка, 100 шт, шелкография A4 на груди', () => {
    const q = calc('T-003', 'medas-kulirnaya-100-160', 100, tee);
    expect(q).toMatchObject({ baseRaw: 399, base: 1152, techTotal: 115, unitRaw: 1267, zoneCount: 1 });
    expect(Math.round(q.overheadPct * 100)).toBe(70);
    expect(Math.round(q.markupPct * 100)).toBe(70);
  });

  it('+ спина DTF A3; затем обработки и 40 шт', () => {
    const z = set(on(tee, 'back'), 'back', withTech(undefined, 'dtf'));
    const two = { ...z, back: { ...z.back, active: true, fmt: 'A3' } };
    expect(calc('T-003', 'medas-kulirnaya-100-160', 100, two)).toMatchObject({ techTotal: 607, unitRaw: 1759, zoneCount: 2 });
    const q = calc('T-003', 'medas-kulirnaya-100-160', 40, two, ['hanger-loop', 'double-stitch']);
    expect(q).toMatchObject({ extrasCost: 45, baseRaw: 444, base: 1433, techTotal: 668, unitRaw: 2101 });
    expect(Math.round(q.markupPct * 100)).toBe(90);
  });

  it('свитшот, футер, 300 шт: вышивка, шелкография с эффектом, flex и DTG', () => {
    let z = initZoneData(zonesOf(sku('SW-001')));
    z = set(z, 'front', { ...withTech(z.front, 'embroidery'), fmt: 'm', col: 3 });
    z = set(on(z, 'back'), 'back', { fmt: 'A3', col: 2, textile: 'color', fx: 'puff' });
    z = set(on(z, 'sleeve-l'), 'sleeve-l', { ...withTech(z['sleeve-l'], 'flex'), active: true, col: 2 });
    const three = calc('SW-001', 'medas-futher-petlya-65-320', 300, z);
    expect(three).toMatchObject({ baseRaw: 892, base: 2274, techTotal: 724.5, unitRaw: 2998.5, zoneCount: 3 });
    z = set(on(z, 'sleeve-r'), 'sleeve-r', { ...withTech(z['sleeve-r'], 'dtg'), active: true });
    expect(calc('SW-001', 'medas-futher-petlya-65-320', 300, z)).toMatchObject({ techTotal: 1024.5, unitRaw: 3298.5, zoneCount: 4 });
  });
});

describe('экспресс: зоны и техника', () => {
  it('последняя включённая зона не выключается', () => {
    const z = initZoneData(['front', 'back']);
    expect(toggleZone(z, 'front')).toBe(z);
    const two = toggleZone(z, 'back');
    expect(toggleZone(two, 'front').front.active).toBe(false);
  });

  it('смена техники сбрасывает параметры к умолчанию техники', () => {
    const silk = { active: true, tech: 'screen' as const, fmt: 'Max', col: 6, textile: 'color', fx: 'puff' };
    expect(withTech(silk, 'embroidery')).toMatchObject({ tech: 'embroidery', fmt: 's', col: 1 });
    expect(withTech(silk, 'screen')).toMatchObject({ fmt: 'A4', col: 1, textile: 'white', fx: 'none' });
    expect(withTech(silk, 'dtg')).toMatchObject({ tech: 'dtg', fmt: 'A4', col: 1, active: true });
  });

  it('модель без своих зон — зоны визарда по умолчанию', () => {
    expect(zonesOf({ ...sku('T-003'), zones: [] })).toEqual(['front', 'back', 'sleeve-l', 'sleeve-r']);
    expect(zonesOf(null)).toEqual([]);
  });
});
