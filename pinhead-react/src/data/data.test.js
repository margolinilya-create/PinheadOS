import { describe, it, expect } from 'vitest';
import {
  PRICES, SKU_CATEGORIES, SKU_CATALOG_DEFAULT,
  FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT,
  MEDASTEX_COLORS, COLOR_GROUPS, COTTONPROM_COLORS, COTTONPROM_GROUPS,
  EXTRAS_CATALOG_DEFAULT, EXTRAS_ICONS, EXTRAS_DESCS,
  LABELS_CATALOG_DEFAULT, LABEL_CONFIG, HARDWARE_CATALOG_DEFAULT,
  SIZES, TYPE_NAMES, FABRIC_NAMES, TECH_NAMES, ZONE_LABELS,
  DEFAULT_USD_RATE, findColorEntry,
  LAYER1_TYPES, LAYER2_TYPES, FABRICS_LAYER1, FABRICS_LAYER2,
} from './index';

// ═══════════════════════════════
// 1. Data integrity
// ═══════════════════════════════
describe('SKU Catalog', () => {
  it('has 19 items', () => {
    expect(SKU_CATALOG_DEFAULT).toHaveLength(19);
  });
  it('has 9 categories', () => {
    expect(SKU_CATEGORIES).toHaveLength(9);
  });
  it('every SKU has required fields', () => {
    SKU_CATALOG_DEFAULT.forEach(s => {
      expect(s).toHaveProperty('code');
      expect(s).toHaveProperty('name');
      expect(s).toHaveProperty('category');
      expect(s).toHaveProperty('sewingPrice');
      expect(s).toHaveProperty('mockupType');
      expect(s).toHaveProperty('zones');
      expect(typeof s.sewingPrice).toBe('number');
    });
  });
  it('all categories referenced by SKUs exist', () => {
    const catIds = SKU_CATEGORIES.map(c => c.id);
    SKU_CATALOG_DEFAULT.forEach(s => {
      expect(catIds).toContain(s.category);
    });
  });
});

describe('Fabrics Catalog', () => {
  it('has 8 fabrics', () => {
    expect(FABRICS_CATALOG_DEFAULT).toHaveLength(8);
  });
  it('has 3 trims', () => {
    expect(TRIM_CATALOG_DEFAULT).toHaveLength(3);
  });
  it('every fabric has priceUSD and forCategories', () => {
    FABRICS_CATALOG_DEFAULT.forEach(f => {
      expect(typeof f.priceUSD).toBe('number');
      expect(Array.isArray(f.forCategories)).toBe(true);
      expect(f.forCategories.length).toBeGreaterThan(0);
    });
  });
});

describe('Colors', () => {
  it('Medastex has 97 colors', () => {
    expect(MEDASTEX_COLORS).toHaveLength(97);
  });
  it('CottonProm has 96 colors', () => {
    expect(COTTONPROM_COLORS).toHaveLength(96);
  });
  it('COLOR_GROUPS has 8 groups', () => {
    expect(COLOR_GROUPS).toHaveLength(8);
  });
  it('COTTONPROM_GROUPS has 15 groups', () => {
    expect(COTTONPROM_GROUPS).toHaveLength(15);
  });
  it('all group codes reference existing colors', () => {
    const medCodes = new Set(MEDASTEX_COLORS.map(c => c.code));
    COLOR_GROUPS.forEach(g => {
      g.codes.forEach(code => {
        expect(medCodes.has(code)).toBe(true);
      });
    });
    const cpCodes = new Set(COTTONPROM_COLORS.map(c => c.code));
    COTTONPROM_GROUPS.forEach(g => {
      g.codes.forEach(code => {
        expect(cpCodes.has(code)).toBe(true);
      });
    });
  });
  it('every color has hex starting with #', () => {
    [...MEDASTEX_COLORS, ...COTTONPROM_COLORS].forEach(c => {
      expect(c.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });
});

describe('findColorEntry', () => {
  it('finds Medastex color', () => {
    const entry = findColorEntry('01-01');
    expect(entry).not.toBeNull();
    expect(entry.name).toBe('Белый');
  });
  it('finds CottonProm color', () => {
    const entry = findColorEntry('5092');
    expect(entry).not.toBeNull();
    expect(entry.name).toBe('Чёрный');
  });
  it('returns null for unknown code', () => {
    expect(findColorEntry('99-99')).toBeNull();
  });
});

describe('Extras & Labels', () => {
  it('extras catalog has items', () => {
    expect(EXTRAS_CATALOG_DEFAULT.length).toBeGreaterThan(0);
  });
  it('every extra has an icon', () => {
    EXTRAS_CATALOG_DEFAULT.forEach(e => {
      expect(EXTRAS_ICONS).toHaveProperty(e.code);
    });
  });
  it('every extra has a description', () => {
    EXTRAS_CATALOG_DEFAULT.forEach(e => {
      expect(EXTRAS_DESCS).toHaveProperty(e.code);
    });
  });
  it('labels catalog has items', () => {
    expect(LABELS_CATALOG_DEFAULT.length).toBeGreaterThan(0);
  });
  it('LABEL_CONFIG has 3 sections', () => {
    expect(LABEL_CONFIG).toHaveProperty('careLabel');
    expect(LABEL_CONFIG).toHaveProperty('mainLabel');
    expect(LABEL_CONFIG).toHaveProperty('hangTag');
  });
  it('hardware catalog has items', () => {
    expect(HARDWARE_CATALOG_DEFAULT.length).toBeGreaterThan(0);
  });
});

describe('PRICES', () => {
  it('has 14 types', () => {
    expect(Object.keys(PRICES.type)).toHaveLength(14);
  });
  it('screen matrix has 4 formats', () => {
    expect(PRICES.screenFormats).toEqual(['A4', 'A3', 'A3+', 'Max']);
  });
  it('screen matrix has 8 color rows per format', () => {
    PRICES.screenFormats.forEach(fmt => {
      expect(Object.keys(PRICES.screenMatrix[fmt])).toHaveLength(8);
    });
  });
  it('each screen row has 6 tier values', () => {
    Object.values(PRICES.screenMatrix).forEach(fmt => {
      Object.values(fmt).forEach(row => {
        expect(row).toHaveLength(6);
      });
    });
  });
  it('fit surcharges exist', () => {
    expect(PRICES.fit.regular).toBe(0);
    expect(PRICES.fit.oversize).toBe(100);
  });
});

describe('Constants', () => {
  it('SIZES has 8 entries', () => {
    expect(SIZES).toEqual(['2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL']);
  });
  it('TYPE_NAMES has 14 types', () => {
    expect(Object.keys(TYPE_NAMES)).toHaveLength(14);
  });
  it('FABRIC_NAMES has 8 entries', () => {
    expect(Object.keys(FABRIC_NAMES)).toHaveLength(8);
  });
  it('TECH_NAMES has 5 entries', () => {
    expect(Object.keys(TECH_NAMES)).toHaveLength(5);
  });
  it('ZONE_LABELS has entries', () => {
    expect(Object.keys(ZONE_LABELS).length).toBeGreaterThan(10);
  });
  it('DEFAULT_USD_RATE is 92', () => {
    expect(DEFAULT_USD_RATE).toBe(92);
  });
  it('Layer types defined', () => {
    expect(LAYER1_TYPES).toEqual(['tee', 'longsleeve', 'tank']);
    expect(LAYER2_TYPES.length).toBeGreaterThan(0);
    expect(FABRICS_LAYER1).toHaveLength(3);
    expect(FABRICS_LAYER2).toHaveLength(5);
  });
});
