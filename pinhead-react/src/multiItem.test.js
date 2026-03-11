import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './store/useStore';
import { ITEM_FIELDS, snapshotItem, restoreItem, defaultItemFields } from './store/useStore';
import {
  calcTotal, getUnitPrice, getTotalQty, getSkuEstPrice, getTotalSurcharge,
  getLabelConfigPrice, isAccessory, hasNoPrint, getVolumeDiscount,
  calcItemTotal, getItemUnitPrice, getItemTotalQty,
  screenLookup, flexLookup, getZoneSurcharge,
} from './utils/pricing';
import {
  SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT,
  EXTRAS_CATALOG_DEFAULT, SIZES, TYPE_NAMES, FABRIC_NAMES, TECH_NAMES,
  ZONE_LABELS, findColorEntry,
} from './data';

// ── Fixtures ──
const TEE = SKU_CATALOG_DEFAULT.find(s => s.code === 'T-001');
const TEE_OVER = SKU_CATALOG_DEFAULT.find(s => s.code === 'T-003');
const HOODIE = SKU_CATALOG_DEFAULT.find(s => s.code === 'H-001');
const HOODIE_OVER = SKU_CATALOG_DEFAULT.find(s => s.code === 'H-002');
const SWEAT = SKU_CATALOG_DEFAULT.find(s => s.code === 'SW-001');
const ZIP = SKU_CATALOG_DEFAULT.find(s => s.code === 'ZH-001');
const PANTS = SKU_CATALOG_DEFAULT.find(s => s.code === 'P-001');
const SHORTS = SKU_CATALOG_DEFAULT.find(s => s.code === 'SH-001');
const SHOPPER = SKU_CATALOG_DEFAULT.find(s => s.code === 'BAG-001');
const CAP = SKU_CATALOG_DEFAULT.find(s => s.code === 'CAP-001');
const SOCKS = SKU_CATALOG_DEFAULT.find(s => s.code === 'SOX-001');
const LONGSLEEVE = SKU_CATALOG_DEFAULT.find(s => s.code === 'LS-001');
const TANK = SKU_CATALOG_DEFAULT.find(s => s.code === 'TK-001');

const catalogs = {
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  usdRate: 92,
  packOption: false,
  urgentOption: false,
};

function makeItemState(overrides = {}) {
  return {
    type: 'tee', fabric: 'kulirnaya', color: '01-01', sku: TEE,
    fit: 'regular', fitChosen: true,
    sizes: { S: 10, M: 20, L: 10 }, customSizes: [],
    extras: [], labels: [], zones: [], tech: 'screen', textileColor: 'white',
    zoneTechs: {}, zonePrints: {}, flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {},
    zoneArtworks: {}, designNotes: '', sizeComment: '', noPrint: false,
    labelConfig: {
      careLabel: { enabled: false, logoOption: 'no-logo', composition: '', country: '', uploadData: null, comments: '' },
      mainLabel: { option: 'none', placement: 'neck', material: 'woven', color: 'white', uploadData: null, comments: '' },
      hangTag: { option: 'none', uploadData: null, comments: '' },
    },
    colorSupplier: 'medastex', skuFilter: 'all',
    ...overrides,
  };
}

function makeFullState(overrides = {}) {
  return { ...makeItemState(overrides), ...catalogs };
}

function fillTeeOrder() {
  const store = useStore.getState();
  store.selectSku(TEE);
  store.selectFabric('kulirnaya');
  store.selectColor('01-01');
  store.setSize('S', 10);
  store.setSize('M', 20);
  store.setSize('L', 10);
}

function fillHoodieOrder() {
  const store = useStore.getState();
  store.selectSku(HOODIE);
  store.selectFabric('futher-350-petlya');
  store.selectColor('01-01');
  store.setSize('M', 15);
  store.setSize('L', 15);
}

function advanceToItems() {
  // Step 0 → 1 → 2 → 3 (Items)
  useStore.getState().nextStep(); // 0→1
  useStore.getState().nextStep(); // 1→2
  useStore.getState().nextStep(); // 2→3 (auto-saves item)
}

beforeEach(() => {
  useStore.getState().resetOrder();
});

// ═══════════════════════════════════════════════
// PART 1: Store — Multi-item Management (50 tests)
// ═══════════════════════════════════════════════

describe('Multi-item: snapshotItem & restoreItem', () => {
  it('snapshotItem captures all ITEM_FIELDS', () => {
    const state = makeItemState();
    const snap = snapshotItem(state);
    for (const key of ITEM_FIELDS) {
      expect(snap).toHaveProperty(key);
    }
  });

  it('snapshotItem deep-copies objects', () => {
    const state = makeItemState();
    const snap = snapshotItem(state);
    snap.sizes.S = 999;
    expect(state.sizes.S).toBe(10); // original unchanged
  });

  it('snapshotItem deep-copies labelConfig', () => {
    const state = makeItemState();
    const snap = snapshotItem(state);
    snap.labelConfig.careLabel.enabled = true;
    expect(state.labelConfig.careLabel.enabled).toBe(false);
  });

  it('snapshotItem handles null sku', () => {
    const state = makeItemState({ sku: null });
    const snap = snapshotItem(state);
    expect(snap.sku).toBeNull();
  });

  it('snapshotItem copies arrays (extras, zones)', () => {
    const state = makeItemState({ extras: ['double-stitch'], zones: ['front', 'back'] });
    const snap = snapshotItem(state);
    snap.extras.push('grommet');
    expect(state.extras).toEqual(['double-stitch']);
  });

  it('restoreItem produces a patch with all fields', () => {
    const item = makeItemState({ type: 'hoodie', fabric: 'futher-350-petlya' });
    const patch = restoreItem(item);
    expect(patch.type).toBe('hoodie');
    expect(patch.fabric).toBe('futher-350-petlya');
  });

  it('restoreItem deep-copies objects', () => {
    const item = makeItemState();
    const patch = restoreItem(item);
    patch.sizes.M = 999;
    expect(item.sizes.M).toBe(20);
  });

  it('restoreItem handles empty zones', () => {
    const item = makeItemState({ zones: [] });
    const patch = restoreItem(item);
    expect(patch.zones).toEqual([]);
  });

  it('ITEM_FIELDS contains all product fields', () => {
    expect(ITEM_FIELDS).toContain('type');
    expect(ITEM_FIELDS).toContain('fabric');
    expect(ITEM_FIELDS).toContain('color');
    expect(ITEM_FIELDS).toContain('sku');
    expect(ITEM_FIELDS).toContain('sizes');
    expect(ITEM_FIELDS).toContain('extras');
    expect(ITEM_FIELDS).toContain('zones');
    expect(ITEM_FIELDS).toContain('labelConfig');
    expect(ITEM_FIELDS).toContain('noPrint');
  });

  it('ITEM_FIELDS does NOT contain shared fields', () => {
    expect(ITEM_FIELDS).not.toContain('name');
    expect(ITEM_FIELDS).not.toContain('phone');
    expect(ITEM_FIELDS).not.toContain('email');
    expect(ITEM_FIELDS).not.toContain('deadline');
    expect(ITEM_FIELDS).not.toContain('packOption');
    expect(ITEM_FIELDS).not.toContain('urgentOption');
  });

  it('defaultItemFields has all ITEM_FIELDS keys', () => {
    for (const key of ITEM_FIELDS) {
      expect(defaultItemFields).toHaveProperty(key);
    }
  });
});

describe('Multi-item: items array management', () => {
  it('initial state has empty items', () => {
    expect(useStore.getState().items).toEqual([]);
    expect(useStore.getState().activeItemIdx).toBe(-1);
  });

  it('nextStep at step 2 saves current item to items[]', () => {
    fillTeeOrder();
    advanceToItems();
    const s = useStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].type).toBe('tee');
    expect(s.items[0].sku.code).toBe('T-001');
    expect(s.step).toBe(3);
  });

  it('activeItemIdx points to last saved item', () => {
    fillTeeOrder();
    advanceToItems();
    expect(useStore.getState().activeItemIdx).toBe(0);
  });

  it('saveCurrentItem updates existing item', () => {
    fillTeeOrder();
    advanceToItems();
    // Go back, change size, save again
    useStore.getState().prevStep(); // back to step 2
    useStore.getState().setSize('XL', 5);
    useStore.getState().saveCurrentItem();
    expect(useStore.getState().items[0].sizes.XL).toBe(5);
  });

  it('saveCurrentItem adds new item when activeItemIdx is -1', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem(); // resets to step 0, activeItemIdx = -1
    fillHoodieOrder();
    useStore.getState().saveCurrentItem();
    expect(useStore.getState().items).toHaveLength(2);
    expect(useStore.getState().items[1].type).toBe('hoodie');
  });

  it('addNewItem resets product fields', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    const s = useStore.getState();
    expect(s.sku).toBeNull();
    expect(s.type).toBe('');
    expect(s.fabric).toBe('');
    expect(s.color).toBe('');
    expect(s.step).toBe(0);
    expect(s.activeItemIdx).toBe(-1);
  });

  it('addNewItem preserves existing items', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    expect(useStore.getState().items).toHaveLength(1);
    expect(useStore.getState().items[0].type).toBe('tee');
  });

  it('editItem loads item into current fields', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    // Now edit first item
    useStore.getState().editItem(0);
    const s = useStore.getState();
    expect(s.type).toBe('tee');
    expect(s.sku.code).toBe('T-001');
    expect(s.activeItemIdx).toBe(0);
    expect(s.step).toBe(0);
  });

  it('editItem with invalid index does nothing', () => {
    fillTeeOrder();
    advanceToItems();
    const before = useStore.getState().step;
    useStore.getState().editItem(5);
    expect(useStore.getState().step).toBe(before);
  });

  it('editItem with negative index does nothing', () => {
    useStore.getState().editItem(-1);
    expect(useStore.getState().step).toBe(0);
  });

  it('removeItem removes item by index', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().removeItem(0);
    expect(useStore.getState().items).toHaveLength(1);
    expect(useStore.getState().items[0].type).toBe('hoodie');
  });

  it('removeItem adjusts activeItemIdx when removing before current', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    // activeItemIdx is 1 (hoodie)
    useStore.getState().removeItem(0);
    expect(useStore.getState().activeItemIdx).toBe(0);
  });

  it('removeItem resets activeItemIdx when removing current', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().removeItem(0);
    expect(useStore.getState().activeItemIdx).toBe(-1);
  });

  it('removeItem does not change activeItemIdx when removing after current', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    // activeItemIdx is 1 (last saved), set it to 0 manually to test
    useStore.setState({ activeItemIdx: 0 });
    useStore.getState().removeItem(1);
    expect(useStore.getState().activeItemIdx).toBe(0);
  });
});

describe('Multi-item: navigation with items', () => {
  it('step 2→3 transition auto-saves item', () => {
    fillTeeOrder();
    useStore.getState().nextStep(); // 0→1
    useStore.getState().nextStep(); // 1→2
    expect(useStore.getState().items).toHaveLength(0);
    useStore.getState().nextStep(); // 2→3 (auto-save)
    expect(useStore.getState().items).toHaveLength(1);
  });

  it('step 3→2 transition restores item', () => {
    fillTeeOrder();
    advanceToItems();
    // Clear current fields to prove prevStep restores them
    useStore.setState({ type: '', sku: null });
    useStore.getState().prevStep(); // 3→2
    expect(useStore.getState().type).toBe('tee');
    expect(useStore.getState().sku.code).toBe('T-001');
  });

  it('max step is correctly set to 5 for full flow', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().nextStep(); // 3→4
    useStore.getState().setField('name', 'Test');
    useStore.getState().nextStep(); // 4→5
    expect(useStore.getState().maxStep).toBe(5);
    expect(useStore.getState().step).toBe(5);
  });

  it('prevStep from step 1 goes to step 0', () => {
    useStore.getState().nextStep();
    useStore.getState().prevStep();
    expect(useStore.getState().step).toBe(0);
  });

  it('prevStep from step 4 goes to step 3', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().nextStep(); // 3→4
    useStore.getState().prevStep(); // 4→3
    expect(useStore.getState().step).toBe(3);
  });

  it('prevStep from step 5 goes to step 4', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().nextStep(); // 3→4
    useStore.getState().setField('name', 'Test');
    useStore.getState().nextStep(); // 4→5
    useStore.getState().prevStep(); // 5→4
    expect(useStore.getState().step).toBe(4);
  });

  it('step never exceeds 5', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().nextStep(); // 3→4
    useStore.getState().setField('name', 'Test');
    useStore.getState().nextStep(); // 4→5
    useStore.getState().nextStep(); // should stay at 5
    expect(useStore.getState().step).toBe(5);
  });

  it('goToStep to items step (3) works when maxStep >= 3', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().nextStep(); // 3→4
    useStore.getState().goToStep(3);
    expect(useStore.getState().step).toBe(3);
  });

  it('goToStep cannot go beyond maxStep', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().goToStep(5);
    expect(useStore.getState().step).toBe(3); // maxStep is 3
  });
});

describe('Multi-item: editing existing item re-saves correctly', () => {
  it('editing item 0 and re-advancing saves changes', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().editItem(0);
    useStore.getState().setSize('XL', 50);
    advanceToItems();
    expect(useStore.getState().items[0].sizes.XL).toBe(50);
    expect(useStore.getState().items).toHaveLength(1); // not duplicated
  });

  it('editing item preserves other items', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().editItem(0);
    useStore.getState().setSize('XL', 50);
    advanceToItems();
    expect(useStore.getState().items).toHaveLength(2);
    expect(useStore.getState().items[0].sizes.XL).toBe(50);
    expect(useStore.getState().items[1].type).toBe('hoodie');
  });
});

describe('Multi-item: resetOrder clears items', () => {
  it('resetOrder empties items array', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().resetOrder();
    expect(useStore.getState().items).toEqual([]);
    expect(useStore.getState().activeItemIdx).toBe(-1);
    expect(useStore.getState().step).toBe(0);
  });
});

// ═══════════════════════════════════════════════
// PART 2: Pricing — Multi-item (40 tests)
// ═══════════════════════════════════════════════

describe('calcItemTotal', () => {
  it('returns same as calcTotal for a single item', () => {
    const state = makeFullState();
    const fromCalcTotal = calcTotal(state);
    const item = makeItemState();
    const fromCalcItem = calcItemTotal(item, catalogs);
    expect(fromCalcItem).toBe(fromCalcTotal);
  });

  it('returns 0 for item with zero qty', () => {
    const item = makeItemState({ sizes: { S: 0, M: 0, L: 0 } });
    expect(calcItemTotal(item, catalogs)).toBe(0);
  });

  it('calculates tee with screen print', () => {
    const item = makeItemState({
      zones: ['front'], zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
    });
    const total = calcItemTotal(item, catalogs);
    expect(total).toBeGreaterThan(0);
  });

  it('calculates hoodie with extras', () => {
    const item = makeItemState({
      type: 'hoodie', sku: HOODIE, fabric: 'futher-350-petlya',
      sizes: { M: 25, L: 25 }, extras: ['grommet', 'lace-flat'],
    });
    const total = calcItemTotal(item, catalogs);
    const totalWithout = calcItemTotal({ ...item, extras: [] }, catalogs);
    expect(total).toBeGreaterThan(totalWithout);
  });

  it('calculates accessory (shopper)', () => {
    const item = makeItemState({
      type: 'shopper', sku: SHOPPER, fabric: 'kulirnaya',
      sizes: { 'ONE SIZE': 100 },
    });
    const total = calcItemTotal(item, catalogs);
    expect(total).toBeGreaterThan(0);
  });

  it('pack option adds 15 per unit', () => {
    const item = makeItemState();
    const withoutPack = calcItemTotal(item, { ...catalogs, packOption: false });
    const withPack = calcItemTotal(item, { ...catalogs, packOption: true });
    expect(withPack - withoutPack).toBe(40 * 15); // 40 units × 15₽
  });

  it('urgent adds 20%', () => {
    const item = makeItemState();
    const normal = calcItemTotal(item, { ...catalogs, urgentOption: false });
    const urgent = calcItemTotal(item, { ...catalogs, urgentOption: true });
    expect(urgent).toBe(Math.round(normal * 1.2));
  });

  it('dtg print adds cost', () => {
    const base = makeItemState();
    const withDtg = makeItemState({
      zones: ['front'], zoneTechs: { front: 'dtg' },
      dtgZones: { front: { size: 'A4', textile: 'white' } },
    });
    expect(calcItemTotal(withDtg, catalogs)).toBeGreaterThan(calcItemTotal(base, catalogs));
  });

  it('embroidery print adds cost', () => {
    const base = makeItemState();
    const withEmb = makeItemState({
      zones: ['front'], zoneTechs: { front: 'embroidery' },
      embZones: { front: { colors: 3, area: 's' } },
    });
    expect(calcItemTotal(withEmb, catalogs)).toBeGreaterThan(calcItemTotal(base, catalogs));
  });

  it('dtf print adds cost', () => {
    const base = makeItemState();
    const withDtf = makeItemState({
      zones: ['front'], zoneTechs: { front: 'dtf' },
      dtfZones: { front: { size: 'A4' } },
    });
    expect(calcItemTotal(withDtf, catalogs)).toBeGreaterThan(calcItemTotal(base, catalogs));
  });

  it('flex print adds cost', () => {
    const base = makeItemState();
    const withFlex = makeItemState({
      zones: ['front'], zoneTechs: { front: 'flex' },
      flexZones: { front: { colors: 1, size: 'A4' } },
    });
    expect(calcItemTotal(withFlex, catalogs)).toBeGreaterThan(calcItemTotal(base, catalogs));
  });

  it('multiple zones add up', () => {
    const oneZone = makeItemState({
      zones: ['front'], zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    });
    const twoZones = makeItemState({
      zones: ['front', 'back'],
      zoneTechs: { front: 'screen', back: 'screen' },
      zonePrints: {
        front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' },
        back: { colors: 1, size: 'A4', textile: 'white', fx: 'none' },
      },
    });
    expect(calcItemTotal(twoZones, catalogs)).toBeGreaterThan(calcItemTotal(oneZone, catalogs));
  });

  it('custom sizes counted in total', () => {
    const item = makeItemState({ customSizes: [{ label: '4XL', qty: 10 }] });
    const itemNo = makeItemState();
    expect(getItemTotalQty(item)).toBe(50); // 10+20+10+10
    expect(calcItemTotal(item, catalogs)).toBeGreaterThan(calcItemTotal(itemNo, catalogs));
  });

  it('labels cost adds to price', () => {
    const base = makeItemState();
    const withLabels = makeItemState({
      labelConfig: {
        careLabel: { enabled: true, logoOption: 'my-logo' },
        mainLabel: { option: 'custom', material: 'canvas' },
        hangTag: { option: 'standard' },
      },
    });
    expect(calcItemTotal(withLabels, catalogs)).toBeGreaterThan(calcItemTotal(base, catalogs));
  });
});

describe('getItemUnitPrice', () => {
  it('returns unit price for item', () => {
    const item = makeItemState();
    const unit = getItemUnitPrice(item, catalogs);
    expect(unit).toBeGreaterThan(0);
    expect(unit).toBe(Math.round(calcItemTotal(item, catalogs) / 40));
  });

  it('returns 0 for zero qty', () => {
    const item = makeItemState({ sizes: {} });
    expect(getItemUnitPrice(item, catalogs)).toBe(0);
  });
});

describe('getItemTotalQty', () => {
  it('sums standard sizes', () => {
    const item = makeItemState({ sizes: { S: 5, M: 10, L: 5 } });
    expect(getItemTotalQty(item)).toBe(20);
  });

  it('includes custom sizes', () => {
    const item = makeItemState({ customSizes: [{ label: '4XL', qty: 3 }, { label: '5XL', qty: 2 }] });
    expect(getItemTotalQty(item)).toBe(40 + 5); // 10+20+10 + 3+2
  });

  it('returns 0 for empty sizes', () => {
    const item = makeItemState({ sizes: {}, customSizes: [] });
    expect(getItemTotalQty(item)).toBe(0);
  });

  it('handles ONE SIZE', () => {
    const item = makeItemState({ sizes: { 'ONE SIZE': 100 } });
    expect(getItemTotalQty(item)).toBe(100);
  });
});

describe('Multi-item grand total', () => {
  it('grand total = sum of item totals', () => {
    const tee = makeItemState();
    const hoodie = makeItemState({
      type: 'hoodie', sku: HOODIE, fabric: 'futher-350-petlya',
      sizes: { M: 15, L: 15 },
    });
    const teeTotal = calcItemTotal(tee, catalogs);
    const hoodieTotal = calcItemTotal(hoodie, catalogs);
    expect(teeTotal + hoodieTotal).toBeGreaterThan(teeTotal);
    expect(teeTotal + hoodieTotal).toBeGreaterThan(hoodieTotal);
  });

  it('3-item order totals correctly', () => {
    const items = [
      makeItemState(),
      makeItemState({ type: 'hoodie', sku: HOODIE, fabric: 'futher-350-petlya', sizes: { M: 10 } }),
      makeItemState({ type: 'shopper', sku: SHOPPER, fabric: 'kulirnaya', sizes: { 'ONE SIZE': 50 } }),
    ];
    const grand = items.reduce((sum, it) => sum + calcItemTotal(it, catalogs), 0);
    expect(grand).toBe(
      calcItemTotal(items[0], catalogs) +
      calcItemTotal(items[1], catalogs) +
      calcItemTotal(items[2], catalogs)
    );
  });
});

// ═══════════════════════════════════════════════
// PART 3: Full Order Flow (50 tests)
// ═══════════════════════════════════════════════

describe('Single-item full flow', () => {
  it('complete tee order: SKU → fabric → color → sizes → advance', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().nextStep(); // → Details
    useStore.getState().setField('name', 'John');
    useStore.getState().setField('email', 'john@example.com');
    useStore.getState().nextStep(); // → Summary
    const s = useStore.getState();
    expect(s.step).toBe(5);
    expect(s.items).toHaveLength(1);
    expect(s.items[0].sku.code).toBe('T-001');
    expect(s.name).toBe('John');
  });

  it('complete hoodie order with extras and zones', () => {
    fillHoodieOrder();
    useStore.getState().toggleExtra('grommet');
    useStore.getState().toggleExtra('lace-flat');
    useStore.getState().nextStep(); // 0→1
    useStore.getState().nextStep(); // 1→2
    // selectSku already sets first zone ('front'), add 'back' as second zone
    useStore.getState().toggleZone('back');
    useStore.getState().setZoneTech('back', 'dtg');
    useStore.getState().nextStep(); // 2→3
    const s = useStore.getState();
    expect(s.items[0].extras).toContain('grommet');
    expect(s.items[0].extras).toContain('lace-flat');
    expect(s.items[0].zones).toContain('front');
    expect(s.items[0].zones).toContain('back');
    expect(s.items[0].zoneTechs.back).toBe('dtg');
  });

  it('accessory order (shopper) completes', () => {
    useStore.getState().selectSku(SHOPPER);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setOneSizeQty(200);
    advanceToItems();
    expect(useStore.getState().items[0].sizes['ONE SIZE']).toBe(200);
  });

  it('socks order (no zones)', () => {
    useStore.getState().selectSku(SOCKS);
    useStore.getState().setOneSizeQty(500);
    advanceToItems();
    const item = useStore.getState().items[0];
    expect(item.type).toBe('socks');
    expect(item.zones).toEqual([]);
  });

  it('oversize tee has correct fit', () => {
    useStore.getState().selectSku(TEE_OVER);
    advanceToItems();
    expect(useStore.getState().items[0].fit).toBe('oversize');
  });

  it('zip-hoodie order', () => {
    useStore.getState().selectSku(ZIP);
    useStore.getState().selectFabric('futher-350-petlya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setSize('M', 20);
    advanceToItems();
    expect(useStore.getState().items[0].type).toBe('zip-hoodie');
  });

  it('pants order', () => {
    useStore.getState().selectSku(PANTS);
    useStore.getState().selectFabric('futher-350-petlya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setSize('L', 30);
    advanceToItems();
    expect(useStore.getState().items[0].type).toBe('pants');
  });

  it('shorts order', () => {
    useStore.getState().selectSku(SHORTS);
    useStore.getState().selectFabric('futher-350-petlya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setSize('M', 40);
    advanceToItems();
    expect(useStore.getState().items[0].type).toBe('shorts');
  });

  it('longsleeve order', () => {
    useStore.getState().selectSku(LONGSLEEVE);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setSize('S', 15);
    advanceToItems();
    expect(useStore.getState().items[0].type).toBe('longsleeve');
  });

  it('tank order', () => {
    useStore.getState().selectSku(TANK);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setSize('M', 25);
    advanceToItems();
    expect(useStore.getState().items[0].type).toBe('tank');
  });
});

describe('Multi-item full flow', () => {
  it('tee + hoodie = 2 items', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    expect(useStore.getState().items).toHaveLength(2);
  });

  it('3 items: tee + hoodie + shopper', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    useStore.getState().selectSku(SHOPPER);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setOneSizeQty(100);
    advanceToItems();
    expect(useStore.getState().items).toHaveLength(3);
    expect(useStore.getState().items[2].type).toBe('shopper');
  });

  it('edit middle item preserves all', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    useStore.getState().selectSku(SWEAT);
    useStore.getState().selectFabric('futher-350-petlya');
    useStore.getState().selectColor('01-01');
    useStore.getState().setSize('M', 10);
    advanceToItems();
    // Edit item 1 (hoodie)
    useStore.getState().editItem(1);
    useStore.getState().setSize('XL', 30);
    advanceToItems();
    const items = useStore.getState().items;
    expect(items).toHaveLength(3);
    expect(items[0].type).toBe('tee');
    expect(items[1].type).toBe('hoodie');
    expect(items[1].sizes.XL).toBe(30);
    expect(items[2].type).toBe('sweat');
  });

  it('remove first item shifts others', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().removeItem(0);
    expect(useStore.getState().items).toHaveLength(1);
    expect(useStore.getState().items[0].type).toBe('hoodie');
  });

  it('remove last item leaves first', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().removeItem(1);
    expect(useStore.getState().items).toHaveLength(1);
    expect(useStore.getState().items[0].type).toBe('tee');
  });

  it('add 5 items', () => {
    const skus = [TEE, HOODIE, SWEAT, PANTS, SHORTS];
    skus.forEach(sku => {
      useStore.getState().addNewItem();
      useStore.getState().selectSku(sku);
      useStore.getState().setSize('M', 10);
      advanceToItems();
    });
    expect(useStore.getState().items).toHaveLength(5);
  });

  it('navigate through details to summary with multiple items', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().nextStep(); // 3→4 Details
    useStore.getState().setField('name', 'Multi Corp');
    useStore.getState().nextStep(); // 4→5 Summary
    const s = useStore.getState();
    expect(s.step).toBe(5);
    expect(s.items).toHaveLength(2);
    expect(s.name).toBe('Multi Corp');
  });
});

// ═══════════════════════════════════════════════
// PART 4: Load Order & Backward Compatibility (30 tests)
// ═══════════════════════════════════════════════

describe('loadOrder — new format (with items[])', () => {
  it('loads order with items array', () => {
    const order = {
      id: 'id-1', order_number: 'PH-001',
      data: {
        items: [
          { type: 'tee', sku: { code: 'T-001' }, fabric: 'kulirnaya', color: '01-01', fit: 'regular',
            sizes: { S: 10, M: 20 }, customSizes: [], extras: [], zones: ['front'],
            zoneTechs: { front: 'screen' }, zonePrints: {}, flexZones: {}, dtgZones: {},
            embZones: {}, dtfZones: {}, zoneArtworks: {}, designNotes: '', sizeComment: '',
            noPrint: false, labelConfig: defaultItemFields.labelConfig,
            textileColor: 'white', colorSupplier: 'medastex', skuFilter: 'all' },
        ],
        name: 'Test Corp', contact: '@test', email: 'test@test.com',
        phone: '+7999', deadline: '2025-06-01', address: 'Moscow',
        notes: 'Test notes', packOption: true, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    const s = useStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].type).toBe('tee');
    expect(s.items[0].sku.code).toBe('T-001');
    expect(s.name).toBe('Test Corp');
    expect(s.packOption).toBe(true);
    expect(s.step).toBe(5);
  });

  it('resolves SKU from catalog in items', () => {
    const order = {
      id: 'id-2', order_number: 'PH-002',
      data: {
        items: [
          { type: 'hoodie', sku: { code: 'H-001' }, fabric: 'futher-350-petlya',
            color: '01-01', fit: 'regular', sizes: { M: 10 }, customSizes: [],
            extras: [], zones: [], zoneTechs: {}, zonePrints: {}, flexZones: {},
            dtgZones: {}, embZones: {}, dtfZones: {}, zoneArtworks: {},
            designNotes: '', sizeComment: '', noPrint: true,
            labelConfig: defaultItemFields.labelConfig,
            textileColor: 'white', colorSupplier: 'medastex', skuFilter: 'all' },
        ],
        name: 'Corp', packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    // SKU should be resolved to full catalog object
    expect(useStore.getState().items[0].sku).toBe(HOODIE);
  });

  it('loads multi-item order', () => {
    const order = {
      id: 'id-3', order_number: 'PH-003',
      data: {
        items: [
          { type: 'tee', sku: { code: 'T-001' }, sizes: { M: 10 }, extras: [], zones: [],
            zoneTechs: {}, zonePrints: {}, flexZones: {}, dtgZones: {}, embZones: {},
            dtfZones: {}, zoneArtworks: {}, customSizes: [], designNotes: '',
            sizeComment: '', noPrint: true, labelConfig: defaultItemFields.labelConfig,
            fabric: 'kulirnaya', color: '01-01', fit: 'regular', textileColor: 'white',
            colorSupplier: 'medastex', skuFilter: 'all' },
          { type: 'hoodie', sku: { code: 'H-001' }, sizes: { L: 20 }, extras: ['grommet'],
            zones: ['front'], zoneTechs: { front: 'screen' }, zonePrints: {},
            flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {}, zoneArtworks: {},
            customSizes: [], designNotes: '', sizeComment: '', noPrint: false,
            labelConfig: defaultItemFields.labelConfig, fabric: 'futher-350-petlya',
            color: '01-01', fit: 'regular', textileColor: 'white',
            colorSupplier: 'medastex', skuFilter: 'all' },
        ],
        name: 'Multi', packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    const s = useStore.getState();
    expect(s.items).toHaveLength(2);
    expect(s.items[0].type).toBe('tee');
    expect(s.items[1].type).toBe('hoodie');
    expect(s.items[1].extras).toContain('grommet');
  });
});

describe('loadOrder — old format (without items[])', () => {
  it('creates items from flat fields', () => {
    const order = {
      id: 'id-old', order_number: 'PH-OLD',
      data: {
        type: 'tee', fabric: 'kulirnaya', color: '01-01', fit: 'regular',
        sizes: { S: 10, M: 20 }, customSizes: [],
        extras: [], zones: [], zoneTechs: {},
        sku: { code: 'T-001' }, name: 'Old Format',
        packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    const s = useStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].type).toBe('tee');
    expect(s.items[0].sizes.S).toBe(10);
    expect(s.name).toBe('Old Format');
  });

  it('old format resolves SKU', () => {
    const order = {
      id: 'id-old2', order_number: 'PH-OLD2',
      data: {
        type: 'hoodie', sku: { code: 'H-001' }, fabric: 'futher-350-petlya',
        color: '01-01', sizes: { M: 10 }, name: 'Old',
        packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    // snapshotItem serializes SKU, so we compare by code
    expect(useStore.getState().items[0].sku.code).toBe('H-001');
    expect(useStore.getState().items[0].sku.name).toBe(HOODIE.name);
  });

  it('old format with zones', () => {
    const order = {
      id: 'id-old3', order_number: 'PH-OLD3',
      data: {
        type: 'tee', sku: { code: 'T-001' }, fabric: 'kulirnaya', color: '01-01',
        sizes: { M: 10 }, zones: ['front', 'back'],
        zoneTechs: { front: 'screen', back: 'dtg' },
        zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
        dtgZones: { back: { size: 'A4', textile: 'white' } },
        name: 'Zones', packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    const item = useStore.getState().items[0];
    expect(item.zones).toEqual(['front', 'back']);
    expect(item.zoneTechs.front).toBe('screen');
    expect(item.zoneTechs.back).toBe('dtg');
  });

  it('old format with empty data', () => {
    const order = { id: 'id-empty', order_number: 'PH-E', data: {} };
    useStore.getState().loadOrder(order);
    const s = useStore.getState();
    expect(s.items).toHaveLength(1);
    expect(s.items[0].type).toBe('');
    expect(s.step).toBe(5);
  });

  it('old format with extras', () => {
    const order = {
      id: 'id-ext', order_number: 'PH-EXT',
      data: {
        type: 'hoodie', sku: { code: 'H-001' }, fabric: 'futher-350-petlya',
        color: '01-01', sizes: { M: 10 }, extras: ['grommet', 'lace-flat'],
        zones: [], name: 'Extras', packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    expect(useStore.getState().items[0].extras).toEqual(['grommet', 'lace-flat']);
  });

  it('old format with labelConfig', () => {
    const order = {
      id: 'id-lbl', order_number: 'PH-LBL',
      data: {
        type: 'tee', sku: { code: 'T-001' }, fabric: 'kulirnaya', color: '01-01',
        sizes: { M: 10 }, zones: [], name: 'Labels',
        labelConfig: {
          careLabel: { enabled: true, logoOption: 'my-logo' },
          mainLabel: { option: 'standard', material: 'woven' },
          hangTag: { option: 'none' },
        },
        packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    expect(useStore.getState().items[0].labelConfig.careLabel.enabled).toBe(true);
  });

  it('old format sets editing state', () => {
    const order = { id: 'id-edit', order_number: 'PH-EDIT', data: { name: 'Edit' } };
    useStore.getState().loadOrder(order);
    const s = useStore.getState();
    expect(s._editingOrderId).toBe('id-edit');
    expect(s._editingOrderNumber).toBe('PH-EDIT');
  });

  it('old format with bitrix_deal from order level', () => {
    const order = { id: 'id-bx', order_number: 'PH-BX', bitrix_deal: 'BX-100', data: { name: 'BX' } };
    useStore.getState().loadOrder(order);
    expect(useStore.getState().bitrixDeal).toBe('BX-100');
  });

  it('old format with customSizes', () => {
    const order = {
      id: 'id-cs', order_number: 'PH-CS',
      data: {
        type: 'tee', sku: { code: 'T-001' }, sizes: { M: 5 },
        customSizes: [{ label: '4XL', qty: 3 }], name: 'CS',
        packOption: false, urgentOption: false,
      },
    };
    useStore.getState().loadOrder(order);
    expect(useStore.getState().items[0].customSizes).toEqual([{ label: '4XL', qty: 3 }]);
  });
});

// ═══════════════════════════════════════════════
// PART 5: Validation & Edge Cases (30 tests)
// ═══════════════════════════════════════════════

describe('Edge cases: sizes', () => {
  it('setSize with 0 keeps size at 0', () => {
    useStore.getState().setSize('M', 0);
    expect(useStore.getState().sizes.M).toBe(0);
  });

  it('setSize with negative clamps to 0', () => {
    useStore.getState().setSize('M', -5);
    expect(useStore.getState().sizes.M).toBe(0);
  });

  it('setSize with large number', () => {
    useStore.getState().setSize('M', 99999);
    expect(useStore.getState().sizes.M).toBe(99999);
  });

  it('setSize with float truncates to int', () => {
    useStore.getState().setSize('M', 10.7);
    expect(useStore.getState().sizes.M).toBe(10);
  });

  it('setSize with empty string = 0', () => {
    useStore.getState().setSize('M', '');
    expect(useStore.getState().sizes.M).toBe(0);
  });

  it('custom size label auto-sorts', () => {
    useStore.getState().addCustomSize('5XL');
    useStore.getState().addCustomSize('4XL');
    const labels = useStore.getState().customSizes.map(c => c.label);
    expect(labels.indexOf('4XL')).toBeLessThan(labels.indexOf('5XL'));
  });

  it('removeCustomSize works', () => {
    useStore.getState().addCustomSize('4XL');
    useStore.getState().addCustomSize('5XL');
    useStore.getState().removeCustomSize(0);
    expect(useStore.getState().customSizes).toHaveLength(1);
  });

  it('setCustomSizeQty with negative clamps to 0', () => {
    useStore.getState().addCustomSize('4XL');
    useStore.getState().setCustomSizeQty(0, -10);
    expect(useStore.getState().customSizes[0].qty).toBe(0);
  });
});

describe('Edge cases: extras toggle', () => {
  it('toggling same extra twice returns to empty', () => {
    useStore.getState().toggleExtra('grommet');
    useStore.getState().toggleExtra('grommet');
    expect(useStore.getState().extras).toEqual([]);
  });

  it('multiple extras accumulate', () => {
    useStore.getState().toggleExtra('grommet');
    useStore.getState().toggleExtra('lace-flat');
    useStore.getState().toggleExtra('double-stitch');
    expect(useStore.getState().extras).toHaveLength(3);
  });

  it('remove middle extra preserves order', () => {
    useStore.getState().toggleExtra('grommet');
    useStore.getState().toggleExtra('lace-flat');
    useStore.getState().toggleExtra('double-stitch');
    useStore.getState().toggleExtra('lace-flat');
    expect(useStore.getState().extras).toEqual(['grommet', 'double-stitch']);
  });
});

describe('Edge cases: zones', () => {
  it('toggle zone adds defaults then removes cleanly', () => {
    useStore.getState().toggleZone('front');
    expect(useStore.getState().zoneTechs.front).toBe('screen');
    useStore.getState().toggleZone('front');
    expect(useStore.getState().zones).toEqual([]);
  });

  it('multiple zones', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().toggleZone('back');
    useStore.getState().toggleZone('sleeve-l');
    expect(useStore.getState().zones).toHaveLength(3);
  });

  it('noPrint clears all zones', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().toggleZone('back');
    useStore.getState().toggleNoPrint();
    expect(useStore.getState().zones).toEqual([]);
    expect(useStore.getState().noPrint).toBe(true);
  });

  it('toggling noPrint back allows adding zones', () => {
    useStore.getState().toggleNoPrint();
    useStore.getState().toggleNoPrint();
    expect(useStore.getState().noPrint).toBe(false);
    useStore.getState().toggleZone('front');
    expect(useStore.getState().zones).toEqual(['front']);
  });

  it('setZoneTech to flex creates flexZones entry', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().setZoneTech('front', 'flex');
    expect(useStore.getState().flexZones.front).toBeDefined();
  });

  it('setZoneTech to embroidery creates embZones entry', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().setZoneTech('front', 'embroidery');
    expect(useStore.getState().embZones.front).toBeDefined();
    expect(useStore.getState().embZones.front.area).toBe('s');
  });

  it('setZoneTech to dtf creates dtfZones entry', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().setZoneTech('front', 'dtf');
    expect(useStore.getState().dtfZones.front).toBeDefined();
  });

  it('setZoneParam updates specific param', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().setZoneTech('front', 'embroidery');
    useStore.getState().setZoneParam('front', 'embroidery', 'colors', 5);
    expect(useStore.getState().embZones.front.colors).toBe(5);
  });

  it('setZoneParam for invalid tech returns empty', () => {
    useStore.getState().setZoneParam('front', 'invalid', 'x', 1);
    // Should not crash
    expect(useStore.getState().zones).toEqual([]);
  });
});

describe('Edge cases: SKU switching', () => {
  it('switching SKU type resets fabric/color', () => {
    useStore.getState().selectSku(TEE);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectColor('01-01');
    useStore.getState().selectSku(HOODIE);
    expect(useStore.getState().fabric).toBe('');
    expect(useStore.getState().color).toBe('');
  });

  it('switching within same type preserves fabric', () => {
    useStore.getState().selectSku(TEE);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectColor('01-01');
    useStore.getState().selectSku(TEE_OVER); // same category: tshirts
    // Type stays 'tee' but code changes, so reset happens
    expect(useStore.getState().sku.code).toBe('T-003');
  });

  it('fit is set from SKU', () => {
    useStore.getState().selectSku(TEE_OVER);
    expect(useStore.getState().fit).toBe('oversize');
  });

  it('selectFit changes fit and resets fabric/color if different', () => {
    useStore.getState().selectSku(TEE);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectColor('01-01');
    useStore.getState().selectFit('oversize');
    expect(useStore.getState().fit).toBe('oversize');
    expect(useStore.getState().fabric).toBe('');
    expect(useStore.getState().color).toBe('');
  });

  it('selectFit same fit does not reset', () => {
    useStore.getState().selectSku(TEE);
    useStore.getState().selectFabric('kulirnaya');
    useStore.getState().selectFit('regular');
    expect(useStore.getState().fabric).toBe('kulirnaya');
  });
});

describe('Edge cases: label config', () => {
  it('toggling care label on/off', () => {
    useStore.getState().toggleCareLabel();
    expect(useStore.getState().labelConfig.careLabel.enabled).toBe(true);
    useStore.getState().toggleCareLabel();
    expect(useStore.getState().labelConfig.careLabel.enabled).toBe(false);
  });

  it('setLabelConfig updates nested', () => {
    useStore.getState().setLabelConfig('careLabel', 'composition', '100% cotton');
    expect(useStore.getState().labelConfig.careLabel.composition).toBe('100% cotton');
  });

  it('setLabelConfig hangTag option', () => {
    useStore.getState().setLabelConfig('hangTag', 'option', 'custom');
    expect(useStore.getState().labelConfig.hangTag.option).toBe('custom');
  });
});

describe('Edge cases: setField', () => {
  it('sets name', () => {
    useStore.getState().setField('name', 'Test');
    expect(useStore.getState().name).toBe('Test');
  });
  it('sets email', () => {
    useStore.getState().setField('email', 'a@b.com');
    expect(useStore.getState().email).toBe('a@b.com');
  });
  it('sets phone', () => {
    useStore.getState().setField('phone', '+7999');
    expect(useStore.getState().phone).toBe('+7999');
  });
  it('sets deadline', () => {
    useStore.getState().setField('deadline', '2025-12-31');
    expect(useStore.getState().deadline).toBe('2025-12-31');
  });
  it('sets address', () => {
    useStore.getState().setField('address', 'Moscow');
    expect(useStore.getState().address).toBe('Moscow');
  });
  it('sets notes', () => {
    useStore.getState().setField('notes', 'Rush order');
    expect(useStore.getState().notes).toBe('Rush order');
  });
  it('sets messenger', () => {
    useStore.getState().setField('messenger', '@user');
    expect(useStore.getState().messenger).toBe('@user');
  });
  it('sets bitrixDeal', () => {
    useStore.getState().setField('bitrixDeal', 'BX-123');
    expect(useStore.getState().bitrixDeal).toBe('BX-123');
  });
  it('sets role', () => {
    useStore.getState().setField('role', 'client');
    expect(useStore.getState().role).toBe('client');
  });
});

// ═══════════════════════════════════════════════
// PART 6: Pricing Deep Dive (50 tests)
// ═══════════════════════════════════════════════

describe('Volume discount', () => {
  it('no discount for small qty', () => {
    expect(getVolumeDiscount(10)).toBe(0);
  });
  it('discount increases with qty', () => {
    const d50 = getVolumeDiscount(50);
    const d100 = getVolumeDiscount(100);
    const d500 = getVolumeDiscount(500);
    expect(d100).toBeGreaterThanOrEqual(d50);
    expect(d500).toBeGreaterThanOrEqual(d100);
  });
});

describe('Screen lookup — extended', () => {
  it('A4/2c/100', () => { expect(screenLookup('A4', 2, 100)).toBeGreaterThan(0); });
  it('A3/4c/200', () => { expect(screenLookup('A3', 4, 200)).toBeGreaterThan(0); });
  it('A3+/6c/300', () => { expect(screenLookup('A3+', 6, 300)).toBeGreaterThan(0); });
  it('Max/1c/500', () => { expect(screenLookup('Max', 1, 500)).toBeGreaterThan(0); });
  it('more colors = higher price', () => {
    expect(screenLookup('A4', 4, 100)).toBeGreaterThan(screenLookup('A4', 1, 100));
  });
  it('more qty = lower per-unit (or same)', () => {
    expect(screenLookup('A4', 1, 500)).toBeLessThanOrEqual(screenLookup('A4', 1, 50));
  });
  it('bigger format = higher price', () => {
    expect(screenLookup('A3', 1, 100)).toBeGreaterThanOrEqual(screenLookup('A4', 1, 100));
  });
});

describe('Flex lookup — extended', () => {
  it('A6/1c/50', () => { expect(flexLookup('A6', 1, 50)).toBeGreaterThan(0); });
  it('A4/2c/100', () => { expect(flexLookup('A4', 2, 100)).toBeGreaterThan(0); });
  it('A3/1c/200', () => { expect(flexLookup('A3', 1, 200)).toBeGreaterThan(0); });
  it('single piece is expensive', () => {
    expect(flexLookup('A4', 1, 1)).toBeGreaterThan(flexLookup('A4', 1, 100));
  });
});

describe('getSkuEstPrice — all SKU types', () => {
  const FC = FABRICS_CATALOG_DEFAULT;
  const TC = TRIM_CATALOG_DEFAULT;

  it('tee regular', () => { expect(getSkuEstPrice(TEE, FC, TC, 92)).toBeGreaterThan(0); });
  it('tee oversize', () => { expect(getSkuEstPrice(TEE_OVER, FC, TC, 92)).toBeGreaterThan(getSkuEstPrice(TEE, FC, TC, 92)); });
  it('hoodie regular', () => { expect(getSkuEstPrice(HOODIE, FC, TC, 92)).toBeGreaterThan(getSkuEstPrice(TEE, FC, TC, 92)); });
  it('hoodie oversize', () => { expect(getSkuEstPrice(HOODIE_OVER, FC, TC, 92)).toBeGreaterThan(getSkuEstPrice(HOODIE, FC, TC, 92)); });
  it('sweatshirt', () => { expect(getSkuEstPrice(SWEAT, FC, TC, 92)).toBeGreaterThan(0); });
  it('zip-hoodie', () => { expect(getSkuEstPrice(ZIP, FC, TC, 92)).toBeGreaterThan(getSkuEstPrice(HOODIE, FC, TC, 92)); });
  it('pants', () => { expect(getSkuEstPrice(PANTS, FC, TC, 92)).toBeGreaterThan(0); });
  it('shorts', () => { expect(getSkuEstPrice(SHORTS, FC, TC, 92)).toBeGreaterThan(0); });
  it('shopper (accessory)', () => { expect(getSkuEstPrice(SHOPPER, FC, TC, 92)).toBeGreaterThan(0); });
  it('cap', () => { expect(getSkuEstPrice(CAP, FC, TC, 92)).toBeGreaterThan(0); });
  it('socks', () => { expect(getSkuEstPrice(SOCKS, FC, TC, 92)).toBeGreaterThan(0); });
  it('longsleeve', () => { expect(getSkuEstPrice(LONGSLEEVE, FC, TC, 92)).toBeGreaterThan(0); });
  it('tank', () => { expect(getSkuEstPrice(TANK, FC, TC, 92)).toBeGreaterThan(0); });

  it('higher USD rate = higher price', () => {
    const p92 = getSkuEstPrice(TEE, FC, TC, 92);
    const p100 = getSkuEstPrice(TEE, FC, TC, 100);
    expect(p100).toBeGreaterThan(p92);
  });
});

describe('calcTotal — various scenarios', () => {
  it('tee 40 pcs no print', () => {
    const s = makeFullState();
    expect(calcTotal(s)).toBeGreaterThan(0);
  });

  it('hoodie 30 pcs with screen front', () => {
    const s = makeFullState({
      type: 'hoodie', sku: HOODIE, fabric: 'futher-350-petlya',
      sizes: { M: 15, L: 15 },
      zones: ['front'], zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
    });
    expect(calcTotal(s)).toBeGreaterThan(0);
  });

  it('oversize hoodie costs more than regular', () => {
    const reg = makeFullState({ type: 'hoodie', sku: HOODIE, fabric: 'futher-350-petlya', sizes: { M: 10 } });
    const over = makeFullState({ type: 'hoodie', sku: HOODIE_OVER, fabric: 'futher-350-petlya', sizes: { M: 10 } });
    expect(calcTotal(over)).toBeGreaterThan(calcTotal(reg));
  });

  it('more qty = higher total', () => {
    const small = makeFullState({ sizes: { M: 10 } });
    const big = makeFullState({ sizes: { M: 100 } });
    expect(calcTotal(big)).toBeGreaterThan(calcTotal(small));
  });

  it('pack + urgent combined', () => {
    const base = makeFullState();
    const both = makeFullState();
    both.packOption = true;
    both.urgentOption = true;
    expect(calcTotal(both)).toBeGreaterThan(calcTotal(base));
  });

  it('multiple extras add up', () => {
    const none = makeFullState();
    const multi = makeFullState({ extras: ['double-stitch', 'hanger-loop', 'reinforced-seam'] });
    expect(calcTotal(multi)).toBeGreaterThan(calcTotal(none));
  });

  it('labels add cost', () => {
    const none = makeFullState();
    const labels = makeFullState({
      labelConfig: {
        careLabel: { enabled: true, logoOption: 'my-logo' },
        mainLabel: { option: 'custom', material: 'canvas' },
        hangTag: { option: 'custom' },
      },
    });
    expect(calcTotal(labels)).toBeGreaterThan(calcTotal(none));
  });

  it('4 zone prints more expensive than 1', () => {
    const zones1 = makeFullState({
      zones: ['front'], zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    });
    const zones4 = makeFullState({
      zones: ['front', 'back', 'sleeve-l', 'sleeve-r'],
      zoneTechs: { front: 'screen', back: 'screen', 'sleeve-l': 'screen', 'sleeve-r': 'screen' },
      zonePrints: {
        front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' },
        back: { colors: 1, size: 'A4', textile: 'white', fx: 'none' },
        'sleeve-l': { colors: 1, size: 'A4', textile: 'white', fx: 'none' },
        'sleeve-r': { colors: 1, size: 'A4', textile: 'white', fx: 'none' },
      },
    });
    expect(calcTotal(zones4)).toBeGreaterThan(calcTotal(zones1));
  });

  it('getUnitPrice = total / qty', () => {
    const s = makeFullState();
    const total = calcTotal(s);
    const unit = getUnitPrice(s);
    const qty = getTotalQty(s);
    expect(unit).toBe(Math.round(total / qty));
  });

  it('getUnitPrice returns 0 for empty', () => {
    const s = makeFullState({ sizes: {} });
    expect(getUnitPrice(s)).toBe(0);
  });
});

describe('isAccessory / hasNoPrint — extended', () => {
  it('shopper is accessory', () => { expect(isAccessory('shopper')).toBe(true); });
  it('basecap is accessory', () => { expect(isAccessory('basecap')).toBe(true); });
  it('dad-cap is accessory', () => { expect(isAccessory('dad-cap')).toBe(true); });
  it('5panel is accessory', () => { expect(isAccessory('5panel')).toBe(true); });
  it('socks is accessory', () => { expect(isAccessory('socks')).toBe(true); });
  it('hoodie is not accessory', () => { expect(isAccessory('hoodie')).toBe(false); });
  it('pants is not accessory', () => { expect(isAccessory('pants')).toBe(false); });
  it('longsleeve is not accessory', () => { expect(isAccessory('longsleeve')).toBe(false); });
  it('hasNoPrint: socks', () => { expect(hasNoPrint('socks')).toBe(true); });
  it('hasNoPrint: tee', () => { expect(hasNoPrint('tee')).toBe(false); });
  it('hasNoPrint: hoodie', () => { expect(hasNoPrint('hoodie')).toBe(false); });
  it('hasNoPrint: shopper', () => { expect(hasNoPrint('shopper')).toBe(false); });
});

describe('getLabelConfigPrice — extended', () => {
  it('care only no-logo', () => {
    expect(getLabelConfigPrice({
      careLabel: { enabled: true, logoOption: 'no-logo' },
      mainLabel: { option: 'none' }, hangTag: { option: 'none' },
    })).toBe(10);
  });
  it('care only send-own (no delta match)', () => {
    // send-own is not in the delta list, so delta = 0, total = 10
    expect(getLabelConfigPrice({
      careLabel: { enabled: true, logoOption: 'send-own' },
      mainLabel: { option: 'none' }, hangTag: { option: 'none' },
    })).toBe(10);
  });
  it('main only standard woven', () => {
    // standard = 30, woven delta = 0
    expect(getLabelConfigPrice({
      careLabel: { enabled: false },
      mainLabel: { option: 'standard', material: 'woven' },
      hangTag: { option: 'none' },
    })).toBe(30);
  });
  it('hang only standard', () => {
    expect(getLabelConfigPrice({
      careLabel: { enabled: false },
      mainLabel: { option: 'none' },
      hangTag: { option: 'standard' },
    })).toBe(15);
  });
  it('null/undefined config returns 0', () => {
    expect(getLabelConfigPrice(null)).toBe(0);
    expect(getLabelConfigPrice(undefined)).toBe(0);
  });
});

describe('getTotalSurcharge — multi-zone', () => {
  it('single zone screen', () => {
    const s = makeFullState({
      zones: ['front'], zoneTechs: { front: 'screen' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    });
    expect(getTotalSurcharge(s)).toBeGreaterThan(0);
  });

  it('two zones sum', () => {
    const s = makeFullState({
      zones: ['front', 'back'],
      zoneTechs: { front: 'screen', back: 'dtg' },
      zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
      dtgZones: { back: { size: 'A4', textile: 'white' } },
    });
    const total = getTotalSurcharge(s);
    const front = getZoneSurcharge('front', s);
    const back = getZoneSurcharge('back', s);
    expect(total).toBe(front + back);
  });

  it('no zones = 0 surcharge', () => {
    const s = makeFullState();
    expect(getTotalSurcharge(s)).toBe(0);
  });
});

describe('Zone surcharge — dtf extended', () => {
  it('dtf A4', () => {
    const s = makeFullState({ zones: ['front'], zoneTechs: { front: 'dtf' }, dtfZones: { front: { size: 'A4' } } });
    expect(getZoneSurcharge('front', s)).toBe(180 + 50); // base + A4
  });
  it('dtf A3', () => {
    const s = makeFullState({ zones: ['front'], zoneTechs: { front: 'dtf' }, dtfZones: { front: { size: 'A3' } } });
    expect(getZoneSurcharge('front', s)).toBe(180 + 100);
  });
});

describe('Zone surcharge — embroidery extended', () => {
  it('emb small area 1 color', () => {
    const s = makeFullState({ zones: ['front'], zoneTechs: { front: 'embroidery' }, embZones: { front: { colors: 1, area: 's' } } });
    expect(getZoneSurcharge('front', s)).toBe(350);
  });
  it('emb medium area 5 colors', () => {
    const s = makeFullState({ zones: ['front'], zoneTechs: { front: 'embroidery' }, embZones: { front: { colors: 5, area: 'm' } } });
    expect(getZoneSurcharge('front', s)).toBeGreaterThan(350);
  });
});

// ═══════════════════════════════════════════════
// PART 7: Additional Coverage (20 tests)
// ═══════════════════════════════════════════════

describe('Multi-item: concurrent add/remove cycles', () => {
  it('add 3, remove middle, add 1 more', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    useStore.getState().selectSku(SWEAT);
    useStore.getState().setSize('M', 5);
    advanceToItems();
    expect(useStore.getState().items).toHaveLength(3);
    useStore.getState().removeItem(1); // remove hoodie
    expect(useStore.getState().items).toHaveLength(2);
    useStore.getState().addNewItem();
    useStore.getState().selectSku(PANTS);
    useStore.getState().setSize('L', 8);
    advanceToItems();
    expect(useStore.getState().items).toHaveLength(3);
    expect(useStore.getState().items[0].type).toBe('tee');
    expect(useStore.getState().items[1].type).toBe('sweat');
    expect(useStore.getState().items[2].type).toBe('pants');
  });

  it('remove all items one by one', () => {
    fillTeeOrder();
    advanceToItems();
    useStore.getState().addNewItem();
    fillHoodieOrder();
    advanceToItems();
    useStore.getState().removeItem(1);
    useStore.getState().removeItem(0);
    expect(useStore.getState().items).toEqual([]);
  });
});

describe('Multi-item pricing: pack/urgent affect all items', () => {
  it('pack adds cost per unit across all items', () => {
    const tee = makeItemState({ sizes: { M: 10 } });
    const hoodie = makeItemState({ type: 'hoodie', sku: HOODIE, fabric: 'futher-350-petlya', sizes: { L: 10 } });
    const noPack = calcItemTotal(tee, catalogs) + calcItemTotal(hoodie, catalogs);
    const withPack = calcItemTotal(tee, { ...catalogs, packOption: true }) + calcItemTotal(hoodie, { ...catalogs, packOption: true });
    expect(withPack - noPack).toBe(20 * 15); // 10+10 units × 15₽
  });

  it('urgent 20% applies to each item separately', () => {
    const tee = makeItemState({ sizes: { M: 10 } });
    const normal = calcItemTotal(tee, catalogs);
    const urgent = calcItemTotal(tee, { ...catalogs, urgentOption: true });
    expect(urgent).toBe(Math.round(normal * 1.2));
  });
});

describe('Data references in items', () => {
  it('TYPE_NAMES resolves tee', () => { expect(TYPE_NAMES.tee).toBe('Футболка'); });
  it('TYPE_NAMES resolves hoodie', () => { expect(TYPE_NAMES.hoodie).toBe('Худи'); });
  it('TYPE_NAMES resolves sweat', () => { expect(TYPE_NAMES.sweat).toBe('Свитшот'); });
  it('TYPE_NAMES resolves pants', () => { expect(TYPE_NAMES.pants).toBe('Штаны'); });
  it('FABRIC_NAMES resolves kulirnaya', () => { expect(FABRIC_NAMES.kulirnaya).toContain('Кулирка'); });
  it('TECH_NAMES resolves screen', () => { expect(TECH_NAMES.screen).toBe('Шелкография'); });
  it('TECH_NAMES resolves dtf', () => { expect(TECH_NAMES.dtf).toBe('DTF Transfer'); });
  it('ZONE_LABELS resolves front', () => { expect(ZONE_LABELS.front).toBeDefined(); });
  it('findColorEntry finds white', () => { expect(findColorEntry('01-01').name).toBe('Белый'); });
  it('findColorEntry returns null for invalid', () => { expect(findColorEntry('INVALID')).toBeNull(); });
});

describe('Store: reorderSku', () => {
  it('reorders SKU catalog', () => {
    const first = useStore.getState().skuCatalog[0].code;
    const second = useStore.getState().skuCatalog[1].code;
    useStore.getState().reorderSku(second, first);
    expect(useStore.getState().skuCatalog[0].code).toBe(second);
    expect(useStore.getState().skuCatalog[1].code).toBe(first);
  });

  it('reorder with same code does nothing', () => {
    const before = [...useStore.getState().skuCatalog];
    useStore.getState().reorderSku('T-001', 'T-001');
    expect(useStore.getState().skuCatalog.map(s => s.code)).toEqual(before.map(s => s.code));
  });

  it('reorder with invalid code does nothing', () => {
    const before = useStore.getState().skuCatalog.length;
    useStore.getState().reorderSku('INVALID', 'T-001');
    expect(useStore.getState().skuCatalog).toHaveLength(before);
  });
});

describe('Store: setOneSizeQty edge cases', () => {
  it('minimum 1', () => {
    useStore.getState().setOneSizeQty(0);
    expect(useStore.getState().sizes['ONE SIZE']).toBe(1);
  });

  it('replaces all sizes with ONE SIZE', () => {
    useStore.getState().setSize('M', 50);
    useStore.getState().setOneSizeQty(100);
    expect(useStore.getState().sizes).toEqual({ 'ONE SIZE': 100 });
    expect(useStore.getState().sizes.M).toBeUndefined();
  });
});

describe('Store: zoneArtwork', () => {
  it('setZoneArtwork stores url', () => {
    useStore.getState().setZoneArtwork('front', 'data:image/png;base64,abc');
    expect(useStore.getState().zoneArtworks.front).toBe('data:image/png;base64,abc');
  });
});
