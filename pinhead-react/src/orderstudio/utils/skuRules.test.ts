import { describe, it, expect } from 'vitest';
import {
  getEffectiveRules,
  isTechAllowed,
  isSizeAvailable,
  buildDefaultCategoryRules,
  getAvailableZonesForSku,
  getZoneName,
} from './skuRules';
import type { CategoryRules, ZoneDefinition } from '../../types/catalog';

// ── Helpers ──

const makeSku = (category: string, overrides?: Record<string, unknown>) => ({
  category,
  overrides,
});

const hoodiesRule: CategoryRules = {
  categoryId: 'hoodies',
  allowedTechs: ['screen', 'flex', 'dtg'],
  allowedZoneTechs: { hood: ['flex', 'dtg'] },
  allowedColors: null,
  defaultExtras: ['zipper-pull'],
  moq: 10,
  availableSizes: ['S', 'M', 'L', 'XL', '2XL'],
};

const tshirtsRule: CategoryRules = {
  categoryId: 'tshirts',
  allowedTechs: ['screen', 'flex', 'dtg', 'embroidery', 'dtf'],
  moq: 5,
};

const rules: CategoryRules[] = [hoodiesRule, tshirtsRule];

// ── Tests ──

describe('getEffectiveRules', () => {
  it('returns category rules for a matching SKU', () => {
    const result = getEffectiveRules(makeSku('hoodies'), rules);
    expect(result.categoryId).toBe('hoodies');
    expect(result.allowedTechs).toEqual(['screen', 'flex', 'dtg']);
    expect(result.allowedZoneTechs).toEqual({ hood: ['flex', 'dtg'] });
    expect(result.defaultExtras).toEqual(['zipper-pull']);
    expect(result.moq).toBe(10);
    expect(result.availableSizes).toEqual(['S', 'M', 'L', 'XL', '2XL']);
  });

  it('returns permissive defaults for a category with no rules', () => {
    const result = getEffectiveRules(makeSku('bombers'), rules);
    expect(result.categoryId).toBe('bombers');
    expect(result.allowedTechs).toBeNull();
    expect(result.allowedZoneTechs).toBeNull();
    expect(result.allowedColors).toBeNull();
    expect(result.defaultExtras).toEqual([]);
    expect(result.moq).toBe(1);
    expect(result.availableSizes).toBeNull();
    expect(result.labelPresets).toBeNull();
  });

  it('per-SKU overrides take precedence over category rules', () => {
    const sku = makeSku('hoodies', {
      allowedTechs: ['screen', 'flex'],
      moq: 50,
    });
    const result = getEffectiveRules(sku, rules);
    expect(result.allowedTechs).toEqual(['screen', 'flex']);
    expect(result.moq).toBe(50);
    // Non-overridden fields fall back to category
    expect(result.allowedZoneTechs).toEqual({ hood: ['flex', 'dtg'] });
    expect(result.defaultExtras).toEqual(['zipper-pull']);
  });

  it('override can set null to remove restrictions', () => {
    const sku = makeSku('hoodies', {
      allowedTechs: null,
      availableSizes: null,
    });
    const result = getEffectiveRules(sku, rules);
    expect(result.allowedTechs).toBeNull();
    expect(result.availableSizes).toBeNull();
  });

  it('override can set empty array to block all', () => {
    const sku = makeSku('hoodies', { allowedTechs: [] });
    const result = getEffectiveRules(sku, rules);
    expect(result.allowedTechs).toEqual([]);
  });

  it('zone tech override replaces entire zone map', () => {
    const sku = makeSku('hoodies', {
      allowedZoneTechs: { hood: ['screen'] },
    });
    const result = getEffectiveRules(sku, rules);
    expect(result.allowedZoneTechs).toEqual({ hood: ['screen'] });
  });

  it('zone tech override null removes zone restrictions', () => {
    const sku = makeSku('hoodies', { allowedZoneTechs: null });
    const result = getEffectiveRules(sku, rules);
    expect(result.allowedZoneTechs).toBeNull();
  });

  it('handles tshirts category with partial rules', () => {
    const result = getEffectiveRules(makeSku('tshirts'), rules);
    expect(result.moq).toBe(5);
    expect(result.allowedTechs).toEqual(['screen', 'flex', 'dtg', 'embroidery', 'dtf']);
    // Fields not defined in category rule → defaults
    expect(result.allowedColors).toBeNull();
    expect(result.defaultExtras).toEqual([]);
    expect(result.availableSizes).toBeNull();
  });

  it('handles empty rules array', () => {
    const result = getEffectiveRules(makeSku('hoodies'), []);
    expect(result.categoryId).toBe('hoodies');
    expect(result.allowedTechs).toBeNull();
    expect(result.moq).toBe(1);
  });

  it('override defaultExtras replaces category defaults', () => {
    const sku = makeSku('hoodies', { defaultExtras: ['wash-label'] });
    const result = getEffectiveRules(sku, rules);
    expect(result.defaultExtras).toEqual(['wash-label']);
  });

  it('override labelPresets works', () => {
    const sku = makeSku('tshirts', { labelPresets: { mainLabel: 'woven' } });
    const result = getEffectiveRules(sku, rules);
    expect(result.labelPresets).toEqual({ mainLabel: 'woven' });
  });
});

describe('isTechAllowed', () => {
  it('returns true when no restrictions', () => {
    const result = getEffectiveRules(makeSku('bombers'), []);
    expect(isTechAllowed(result, 'screen')).toBe(true);
    expect(isTechAllowed(result, 'dtf')).toBe(true);
  });

  it('returns false for disallowed tech', () => {
    const result = getEffectiveRules(makeSku('hoodies'), rules);
    expect(isTechAllowed(result, 'screen')).toBe(true);
    expect(isTechAllowed(result, 'embroidery')).toBe(false);
    expect(isTechAllowed(result, 'dtf')).toBe(false);
  });

  it('checks zone-level restrictions', () => {
    const result = getEffectiveRules(makeSku('hoodies'), rules);
    // hood zone: only flex and dtg
    expect(isTechAllowed(result, 'screen', 'hood')).toBe(false);
    expect(isTechAllowed(result, 'flex', 'hood')).toBe(true);
    expect(isTechAllowed(result, 'dtg', 'hood')).toBe(true);
    // front zone: no zone restriction → falls back to global
    expect(isTechAllowed(result, 'screen', 'front')).toBe(true);
    expect(isTechAllowed(result, 'flex', 'front')).toBe(true);
  });

  it('zone restriction still respects global allowedTechs', () => {
    const result = getEffectiveRules(makeSku('hoodies'), rules);
    // embroidery is not in global allowedTechs, even if zone doesn't restrict it
    expect(isTechAllowed(result, 'embroidery', 'front')).toBe(false);
  });
});

describe('isSizeAvailable', () => {
  it('returns true when no size restrictions', () => {
    const result = getEffectiveRules(makeSku('bombers'), []);
    expect(isSizeAvailable(result, 'XS')).toBe(true);
    expect(isSizeAvailable(result, '10XL')).toBe(true);
  });

  it('returns true for allowed size', () => {
    const result = getEffectiveRules(makeSku('hoodies'), rules);
    expect(isSizeAvailable(result, 'M')).toBe(true);
    expect(isSizeAvailable(result, 'XL')).toBe(true);
  });

  it('returns false for disallowed size', () => {
    const result = getEffectiveRules(makeSku('hoodies'), rules);
    expect(isSizeAvailable(result, 'XS')).toBe(false);
    expect(isSizeAvailable(result, '3XL')).toBe(false);
  });
});

describe('buildDefaultCategoryRules', () => {
  it('creates minimal rules with just categoryId', () => {
    const result = buildDefaultCategoryRules('pants');
    expect(result).toEqual({ categoryId: 'pants' });
  });
});

// ── Dynamic Zones Tests ──

const zonesCatalog: ZoneDefinition[] = [
  { id: 'front', name: 'Грудь (перед)', forCategories: null, sortOrder: 1 },
  { id: 'back', name: 'Спина', forCategories: null, sortOrder: 2 },
  { id: 'sleeve-l', name: 'Левый рукав', forCategories: null, sortOrder: 3 },
  { id: 'sleeve-r', name: 'Правый рукав', forCategories: null, sortOrder: 4 },
  { id: 'hood', name: 'Капюшон', forCategories: ['hoodies', 'ziphoodies', 'halfzips'], sortOrder: 5 },
  { id: 'pocket', name: 'Карман', forCategories: null, sortOrder: 6 },
  { id: 'side-a', name: 'Сторона A', forCategories: ['accessories'], sortOrder: 7 },
  { id: 'side-b', name: 'Сторона B', forCategories: ['accessories'], sortOrder: 8 },
];

describe('getAvailableZonesForSku', () => {
  it('returns all universal zones for tshirts', () => {
    const result = getAvailableZonesForSku(zonesCatalog, 'tshirts');
    const ids = result.map(z => z.id);
    expect(ids).toContain('front');
    expect(ids).toContain('back');
    expect(ids).toContain('sleeve-l');
    expect(ids).toContain('pocket');
    expect(ids).not.toContain('hood');
    expect(ids).not.toContain('side-a');
  });

  it('includes hood for hoodies', () => {
    const result = getAvailableZonesForSku(zonesCatalog, 'hoodies');
    const ids = result.map(z => z.id);
    expect(ids).toContain('hood');
    expect(ids).toContain('front');
    expect(ids).not.toContain('side-a');
  });

  it('returns only side-a/side-b for accessories', () => {
    const result = getAvailableZonesForSku(zonesCatalog, 'accessories');
    const ids = result.map(z => z.id);
    expect(ids).toContain('side-a');
    expect(ids).toContain('side-b');
    // Universal zones (forCategories: null) are also included
    expect(ids).toContain('front');
  });

  it('returns sorted by sortOrder', () => {
    const result = getAvailableZonesForSku(zonesCatalog, 'hoodies');
    for (let i = 1; i < result.length; i++) {
      expect((result[i].sortOrder ?? 99) >= (result[i - 1].sortOrder ?? 99)).toBe(true);
    }
  });

  it('handles empty catalog', () => {
    expect(getAvailableZonesForSku([], 'tshirts')).toEqual([]);
  });

  it('handles unknown category', () => {
    const result = getAvailableZonesForSku(zonesCatalog, 'unknown');
    // Should return only zones with forCategories: null (universal)
    const ids = result.map(z => z.id);
    expect(ids).toContain('front');
    expect(ids).not.toContain('hood');
    expect(ids).not.toContain('side-a');
  });
});

describe('getZoneName', () => {
  it('returns name from dynamic catalog', () => {
    expect(getZoneName('front', zonesCatalog)).toBe('Грудь (перед)');
    expect(getZoneName('hood', zonesCatalog)).toBe('Капюшон');
  });

  it('falls back to ZONE_LABELS for unknown zone IDs', () => {
    expect(getZoneName('chest', zonesCatalog)).toBe('Грудь');
    expect(getZoneName('left-sleeve', zonesCatalog)).toBe('Лев. рукав');
  });

  it('returns zone ID itself when not found anywhere', () => {
    expect(getZoneName('completely-unknown', zonesCatalog)).toBe('completely-unknown');
  });

  it('handles empty catalog with fallback', () => {
    expect(getZoneName('front', [])).toBe('Лицевая сторона'); // from ZONE_LABELS
    expect(getZoneName('unknown', [])).toBe('unknown');
  });
});
