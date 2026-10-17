import { describe, it, expect } from 'vitest';
import {
  libraryLabelPrice, parseLabelVariant, joinLabelVariant, shownVariantId, shownMaterialKey,
  variantTakesMaterial, labelKindOptions, labelVariantOptions, labelMaterialOptions,
  attachSchemeOptions, nextLibraryId, parseDelta, parsePrice, labelLibraryProblems,
  findLabelKind, RETIRED_MARK, UNKNOWN_MARK,
} from './labels';
import { LABEL_LIBRARY_SEED } from './seeds';
import { salesLabelPrice, legacyLabelPrice, priceItem, DEFAULT_PRICE_RULES } from '../pricing/priceOrder';
import type { PriceCatalogs } from '../pricing/priceOrder';
import { newSalesItem, newSalesLabel } from '../model/factory';
import * as core from '../../utils/pricingCore';
import { PRICES } from '../../data/prices';
import { SKU_CATALOG_DEFAULT } from '../../data/skuCatalog';
import { FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT } from '../../data/fabricsCatalog';
import { EXTRAS_CATALOG_DEFAULT } from '../../data/extras';
import type { SkuItem } from '../../types/catalog';
import type { LabelLibrary } from './types';

const LIB = LABEL_LIBRARY_SEED;
const brand = findLabelKind(LIB, 'brand')!;

/** Копия сида с правкой вида `brand` */
function withBrand(patch: (k: typeof brand) => typeof brand): LabelLibrary {
  return { ...LIB, kinds: LIB.kinds.map((k) => (k.type === 'brand' ? patch(k) : k)) };
}

describe('variant_id: вариант и материал', () => {
  it('разбор и сборка — прежний формат `вариант[:материал]`', () => {
    expect(parseLabelVariant('custom:canvas')).toEqual({ variant: 'custom', material: 'canvas' });
    expect(parseLabelVariant('')).toEqual({ variant: '', material: '' });
    expect(parseLabelVariant(undefined)).toEqual({ variant: '', material: '' });
    expect(joinLabelVariant('custom', 'canvas')).toBe('custom:canvas');
    expect(joinLabelVariant('send-own', '')).toBe('send-own');
  });

  it('варианты сида — прежние id позиций', () => {
    const ids = new Set(LIB.kinds.flatMap((k) => k.variants.map((v) => v.id)));
    expect([...ids].sort()).toEqual(['custom', 'my-logo', 'no-logo', 'send-own', 'standard']);
  });

  it('без варианта — «standard»; материал не выбран — тот, что без надбавки', () => {
    expect(shownVariantId(brand, '')).toBe('standard');
    expect(shownVariantId(brand, 'custom')).toBe('custom');
    expect(shownVariantId(findLabelKind(LIB, 'size'), '')).toBe('');
    expect(shownMaterialKey(brand, '')).toBe('woven');
    expect(shownMaterialKey(brand, 'canvas')).toBe('canvas');
    expect(variantTakesMaterial(brand, 'custom')).toBe(true);
    expect(variantTakesMaterial(brand, 'send-own')).toBe(false);
  });
});

describe('цена из библиотеки = прежняя (сид, все комбинации)', () => {
  it('вид × вариант × материал — как legacyLabelPrice', () => {
    let checked = 0;
    for (const kind of LIB.kinds) {
      const variants = ['', ...kind.variants.map((v) => v.id)];
      const materials = ['', ...kind.materials.map((m) => m.key)];
      for (const v of variants) {
        for (const m of materials) {
          if (!v && m) continue; // материал без варианта не пишется
          const label = { label_type: kind.type, variant_id: joinLabelVariant(v, m) };
          expect(libraryLabelPrice(LIB, label), `${kind.type} ${label.variant_id}`).toBe(legacyLabelPrice(label));
          expect(salesLabelPrice(label, LIB)).toBe(salesLabelPrice(label));
          checked += 1;
        }
      }
    }
    // 8 видов: composition (пусто + 3), brand (пусто + 3×4), hangtag (пусто + 2), пять без вариантов
    expect(checked).toBe(4 + 13 + 3 + 5);
  });

  it('цена позиции с библиотекой сида = без неё', () => {
    const CAT: PriceCatalogs = {
      skuCatalog: SKU_CATALOG_DEFAULT as unknown as SkuItem[],
      fabricsCatalog: FABRICS_CATALOG_DEFAULT,
      trimCatalog: TRIM_CATALOG_DEFAULT,
      extrasCatalog: EXTRAS_CATALOG_DEFAULT,
      usdRate: 92,
    };
    const it0 = newSalesItem({
      kind: 'sku',
      sku_code: CAT.skuCatalog[2].code,
      fabric_code: 'medas-kulirnaya-100-160',
      size_grid: { sizes: ['M'], rows: [{ color: 'Чёрный', sizes: { M: 20 } }] },
      labels: [
        newSalesLabel({ label_type: 'brand', variant_id: 'custom:canvas' }),
        newSalesLabel({ label_type: 'composition', variant_id: 'my-logo' }),
        newSalesLabel({ label_type: 'hangtag' }),
      ],
    });
    const P = PRICES as core.PricesExt;
    const plain = priceItem(it0, P, CAT, DEFAULT_PRICE_RULES, false);
    const lib = priceItem(it0, P, { ...CAT, labelLibrary: LIB }, DEFAULT_PRICE_RULES, false);
    expect(lib.labels_unit).toBe(plain.labels_unit);
    expect(lib.calc_unit).toBe(plain.calc_unit);
    expect(lib.labels_unit).toBe(55 + 30 + 15);
  });
});

describe('цена по библиотеке — правка владельца и запасной путь', () => {
  it('новая цена варианта и надбавка материала идут в расчёт', () => {
    const lib = withBrand((k) => ({
      ...k,
      variants: k.variants.map((v) => (v.id === 'custom' ? { ...v, price: 70 } : v)),
      materials: k.materials.map((m) => (m.key === 'canvas' ? { ...m, priceDelta: 12 } : m)),
    }));
    expect(salesLabelPrice({ label_type: 'brand', variant_id: 'custom:canvas' }, lib)).toBe(82);
    expect(salesLabelPrice({ label_type: 'brand', variant_id: 'custom' }, lib)).toBe(70);
  });

  it('минус материала больше цены варианта — бирка 0 ₽, а не отрицательная цена', () => {
    const lib = withBrand((k) => ({
      ...k,
      variants: k.variants.map((v) => (v.id === 'custom' ? { ...v, price: 10 } : v)),
      materials: k.materials.map((m) => (m.key === 'canvas' ? { ...m, priceDelta: -20 } : m)),
    }));
    expect(libraryLabelPrice(lib, { label_type: 'brand', variant_id: 'custom:canvas' })).toBe(0);
    expect(salesLabelPrice({ label_type: 'brand', variant_id: 'custom:canvas' }, lib)).toBe(0);
  });

  it('снятый вариант считается по своей цене — заказ не меняется', () => {
    const lib = withBrand((k) => ({
      ...k, variants: k.variants.map((v) => (v.id === 'custom' ? { ...v, active: false } : v)),
    }));
    expect(salesLabelPrice({ label_type: 'brand', variant_id: 'custom:canvas' }, lib)).toBe(55);
  });

  it('нет библиотеки, вида или варианта — прежний расчёт', () => {
    const label = { label_type: 'brand', variant_id: 'custom:canvas' };
    expect(libraryLabelPrice(null, label)).toBeNull();
    expect(libraryLabelPrice({ kinds: [], schemes: [] }, label)).toBeNull();
    expect(salesLabelPrice(label, { kinds: [], schemes: [] })).toBe(55);
    expect(libraryLabelPrice(LIB, { label_type: 'brand', variant_id: 'golden' })).toBeNull();
    expect(salesLabelPrice({ label_type: 'brand', variant_id: 'golden' }, LIB)).toBe(legacyLabelPrice({ label_type: 'brand', variant_id: 'golden' }));
  });

  it('новый вариант библиотеки, которого не знала константа', () => {
    const lib = withBrand((k) => ({
      ...k, variants: [...k.variants, { id: 'v-4', name: 'Сатин', price: 40, withMaterial: true, active: true }],
    }));
    expect(salesLabelPrice({ label_type: 'brand', variant_id: 'v-4:polyester' }, lib)).toBe(35);
  });
});

describe('пункты выбора: снятое и незнакомое показаны с пометкой', () => {
  const lib = withBrand((k) => ({
    ...k,
    variants: k.variants.map((v) => (v.id === 'custom' ? { ...v, active: false } : v)),
    materials: k.materials.map((m) => (m.key === 'canvas' ? { ...m, active: false } : m)),
  }));
  const kind = findLabelKind(lib, 'brand');

  it('снятый вариант не предлагается, пока не выбран', () => {
    expect(labelVariantOptions(kind, 'standard').map((o) => o.value)).toEqual(['standard', 'send-own']);
  });

  it('снятый вариант, уже стоящий в бирке, — на месте и помечен', () => {
    const opts = labelVariantOptions(kind, 'custom');
    expect(opts.map((o) => o.value)).toEqual(['standard', 'custom', 'send-own']);
    expect(opts[1]).toEqual({ value: 'custom', label: `Своя (дизайн клиента) (${RETIRED_MARK})`, marked: true });
  });

  it('материал так же', () => {
    expect(labelMaterialOptions(kind, 'woven').map((o) => o.value)).toEqual(['woven', 'polyester']);
    expect(labelMaterialOptions(kind, 'canvas').find((o) => o.value === 'canvas')?.label).toBe(`Хлопковый канвас (${RETIRED_MARK})`);
  });

  it('значения нет в библиотеке — показано как есть с пометкой', () => {
    const opts = labelVariantOptions(kind, 'golden');
    expect(opts.at(-1)).toEqual({ value: 'golden', label: `golden (${UNKNOWN_MARK})`, marked: true });
    expect(attachSchemeOptions(lib, 'Под ярлыком').at(-1)?.label).toBe(`Под ярлыком (${UNKNOWN_MARK})`);
  });

  it('виды и схемы', () => {
    const noHang = { ...lib, kinds: lib.kinds.map((k) => (k.type === 'hangtag' ? { ...k, active: false } : k)) };
    expect(labelKindOptions(noHang, '').map((o) => o.value)).not.toContain('hangtag');
    expect(labelKindOptions(noHang, 'hangtag').find((o) => o.value === 'hangtag')?.marked).toBe(true);
    expect(attachSchemeOptions(LIB, '').map((o) => o.value)).toEqual(['neck', 'inseam']);
  });
});

describe('редактор: id, числа, проверка', () => {
  it('новый id не совпадает с имеющимися', () => {
    expect(nextLibraryId('v', ['standard', 'custom'])).toBe('v-3');
    expect(nextLibraryId('v', ['v-2', 'v-3'])).toBe('v-4');
  });

  it('надбавка: минус и запятая; цена — не меньше нуля', () => {
    expect(parseDelta('-5')).toBe(-5);
    expect(parseDelta('2,5')).toBe(2.5);
    expect(parseDelta('')).toBe(0);
    expect(parseDelta('-')).toBeUndefined();
    expect(parseDelta('abc')).toBeUndefined();
    expect(parsePrice('-5')).toBeUndefined();
    expect(parsePrice('30')).toBe(30);
  });

  it('пустые названия названы до записи', () => {
    expect(labelLibraryProblems(LIB)).toEqual([]);
    const bad = withBrand((k) => ({ ...k, variants: [...k.variants, { id: 'v-4', name: ' ', price: 1, withMaterial: false, active: true }] }));
    expect(labelLibraryProblems({ ...bad, schemes: [...bad.schemes, { id: 's-3', name: '', active: true }] })).toEqual([
      'Брендовая бирка: у варианта 4 нет названия',
      'У схемы 3 нет названия',
    ]);
  });
});
