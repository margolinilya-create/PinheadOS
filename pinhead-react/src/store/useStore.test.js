import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from './useStore';
import { SKU_CATALOG_DEFAULT } from '../data';

// Reset store before each test
beforeEach(() => {
  useStore.getState().resetOrder();
});

describe('useStore — navigation', () => {
  it('starts at step 0', () => {
    expect(useStore.getState().step).toBe(0);
  });
  it('nextStep increments', () => {
    useStore.getState().nextStep();
    expect(useStore.getState().step).toBe(1);
    expect(useStore.getState().maxStep).toBe(1);
  });
  it('prevStep decrements', () => {
    useStore.getState().nextStep();
    useStore.getState().prevStep();
    expect(useStore.getState().step).toBe(0);
  });
  it('goToStep respects maxStep', () => {
    useStore.getState().goToStep(3);
    expect(useStore.getState().step).toBe(0); // maxStep is 0
    useStore.getState().nextStep();
    useStore.getState().nextStep();
    useStore.getState().goToStep(0);
    expect(useStore.getState().step).toBe(0);
    useStore.getState().goToStep(2);
    expect(useStore.getState().step).toBe(2);
  });
});

describe('useStore — SKU selection', () => {
  it('selectSku sets sku and type', () => {
    const sku = SKU_CATALOG_DEFAULT[0]; // Футболка Classic woman
    useStore.getState().selectSku(sku);
    const s = useStore.getState();
    expect(s.sku).toBe(sku);
    expect(s.type).toBe('tee');
    expect(s.fit).toBe('classic');
    expect(s.fitChosen).toBe(true);
  });
  it('selectSku resets fabric/color on type change', () => {
    const tee = SKU_CATALOG_DEFAULT[0];
    const hoodie = SKU_CATALOG_DEFAULT.find(s => s.category === 'hoodies');
    useStore.getState().selectSku(tee);
    useStore.getState().selectFabric('medas-kulirnaya-100-160');
    useStore.getState().selectColor('01-01');
    useStore.getState().selectSku(hoodie);
    const s = useStore.getState();
    expect(s.fabric).toBe('');
    expect(s.color).toBe('');
  });
  it('setSkuFilter updates filter', () => {
    useStore.getState().setSkuFilter('hoodies');
    expect(useStore.getState().skuFilter).toBe('hoodies');
  });
});

describe('useStore — fabric & color', () => {
  it('selectFabric sets fabric and resets color', () => {
    useStore.getState().selectColor('01-01');
    useStore.getState().selectFabric('medas-kulirnaya-100-300');
    const s = useStore.getState();
    expect(s.fabric).toBe('medas-kulirnaya-100-300');
    expect(s.color).toBe(''); // reset on fabric change
  });
  it('selectColor sets color', () => {
    useStore.getState().selectColor('5001');
    expect(useStore.getState().color).toBe('5001');
  });
  it('setColorSupplier works', () => {
    useStore.getState().setColorSupplier('cottonprom');
    expect(useStore.getState().colorSupplier).toBe('cottonprom');
  });
});

describe('useStore — sizes', () => {
  it('setSize updates specific size', () => {
    useStore.getState().setSize('M', 50);
    expect(useStore.getState().sizes['M']).toBe(50);
  });
  it('setSize handles NaN', () => {
    useStore.getState().setSize('L', 'abc');
    expect(useStore.getState().sizes['L']).toBe(0);
  });
  it('setOneSizeQty sets ONE SIZE', () => {
    useStore.getState().setOneSizeQty(100);
    expect(useStore.getState().sizes).toEqual({ 'ONE SIZE': 100 });
  });
});

describe('useStore — extras', () => {
  it('toggleExtra adds and removes', () => {
    useStore.getState().toggleExtra('grommet');
    expect(useStore.getState().extras).toEqual(['grommet']);
    useStore.getState().toggleExtra('grommet');
    expect(useStore.getState().extras).toEqual([]);
  });
});

describe('useStore — zones & tech', () => {
  it('toggleZone adds zone with defaults', () => {
    useStore.getState().toggleZone('front');
    const s = useStore.getState();
    expect(s.zones).toEqual(['front']);
    expect(s.zoneTechs.front).toBe('screen');
    expect(s.zonePrints.front).toBeDefined();
    expect(s.noPrint).toBe(false);
  });
  it('toggleZone removes zone', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().toggleZone('front');
    expect(useStore.getState().zones).toEqual([]);
  });
  it('setZoneTech changes tech', () => {
    useStore.getState().toggleZone('back');
    useStore.getState().setZoneTech('back', 'dtg');
    const s = useStore.getState();
    expect(s.zoneTechs.back).toBe('dtg');
    expect(s.dtgZones.back).toBeDefined();
  });
  it('setZoneParam updates params', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().setZoneParam('front', 'screen', 'colors', 4);
    expect(useStore.getState().zonePrints.front.colors).toBe(4);
  });
  it('toggleNoPrint clears zones', () => {
    useStore.getState().toggleZone('front');
    useStore.getState().toggleZone('back');
    useStore.getState().toggleNoPrint();
    const s = useStore.getState();
    expect(s.noPrint).toBe(true);
    expect(s.zones).toEqual([]);
  });
});

describe('useStore — details & options', () => {
  it('setField updates arbitrary field', () => {
    useStore.getState().setField('name', 'Test');
    expect(useStore.getState().name).toBe('Test');
  });
  it('togglePack toggles', () => {
    useStore.getState().togglePack();
    expect(useStore.getState().packOption).toBe(true);
    useStore.getState().togglePack();
    expect(useStore.getState().packOption).toBe(false);
  });
  it('toggleUrgent toggles', () => {
    useStore.getState().toggleUrgent();
    expect(useStore.getState().urgentOption).toBe(true);
  });
});

describe('useStore — labels', () => {
  it('toggleCareLabel toggles enabled', () => {
    useStore.getState().toggleCareLabel();
    expect(useStore.getState().labelConfig.careLabel.enabled).toBe(true);
    useStore.getState().toggleCareLabel();
    expect(useStore.getState().labelConfig.careLabel.enabled).toBe(false);
  });
  it('setLabelConfig updates nested value', () => {
    useStore.getState().setLabelConfig('mainLabel', 'option', 'custom');
    expect(useStore.getState().labelConfig.mainLabel.option).toBe('custom');
  });
});

describe('useStore — reset', () => {
  it('resetOrder restores initial state', () => {
    useStore.getState().selectSku(SKU_CATALOG_DEFAULT[0]);
    useStore.getState().nextStep();
    useStore.getState().setField('name', 'Test');
    useStore.getState().resetOrder();
    const s = useStore.getState();
    expect(s.step).toBe(0);
    expect(s.sku).toBeNull();
    expect(s.name).toBe('');
  });
});

describe('useStore — loadOrder', () => {
  beforeEach(() => {
    useStore.getState().resetOrder();
  });

  const makeItem = (overrides = {}) => ({
    type: 'tee', fabric: 'medas-kulirnaya-100-160', color: '01-01',
    sku: { code: SKU_CATALOG_DEFAULT[0].code }, sizes: { M: 10 }, customSizes: [],
    fit: 'regular', fitChosen: true, extras: [], labels: [], zones: ['front'],
    tech: 'screen', textileColor: 'white', zoneTechs: { front: 'screen' },
    zonePrints: { front: { colors: 1, size: 'A4', textile: 'white', fx: 'none' } },
    flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {},
    zoneArtworks: {}, designNotes: '', sizeComment: '', noPrint: false,
    labelConfig: null, colorSupplier: 'medastex', skuFilter: 'all',
    ...overrides,
  });

  it('loads new format order (with items[])', () => {
    const mockOrder = {
      id: 'test-id',
      order_number: 'PH-0001',
      data: {
        items: [makeItem()],
        name: 'Тест Клиент',
      },
    };
    useStore.getState().loadOrder(mockOrder);
    const s = useStore.getState();
    expect(s.step).toBe(4);
    expect(s.items.length).toBe(1);
    expect(s.name).toBe('Тест Клиент');
    expect(s._editingOrderId).toBe('test-id');
    expect(s._editingOrderNumber).toBe('PH-0001');
  });

  it('loads old format order (flat fields)', () => {
    const mockOrder = {
      id: 'old-id',
      order_number: 'PH-0099',
      data: {
        type: 'tee', fabric: 'kulirnaya', color: '01-01',
        sku: { code: SKU_CATALOG_DEFAULT[0].code },
        sizes: { S: 5, M: 10 },
        zones: ['front'],
        zoneTechs: { front: 'screen' },
        zonePrints: { front: { colors: 2, size: 'A4', textile: 'white', fx: 'none' } },
        name: 'Старый Клиент',
      },
    };
    useStore.getState().loadOrder(mockOrder);
    const s = useStore.getState();
    expect(s.step).toBe(4);
    expect(s.items.length).toBe(1);
    expect(s.name).toBe('Старый Клиент');
  });

  it('resolves SKU from catalog by code', () => {
    const mockOrder = {
      id: 'resolve-id',
      order_number: 'PH-0003',
      data: {
        items: [makeItem({ sku: { code: SKU_CATALOG_DEFAULT[0].code } })],
      },
    };
    useStore.getState().loadOrder(mockOrder);
    const s = useStore.getState();
    // SKU should be resolved to full catalog entry
    expect(s.sku).not.toBeNull();
    expect(s.sku.code).toBe(SKU_CATALOG_DEFAULT[0].code);
    expect(s.sku.name).toBe(SKU_CATALOG_DEFAULT[0].name);
  });

  it('SKU not found in catalog → falls back to saved sku data', () => {
    const mockOrder = {
      id: 'notfound-id',
      order_number: 'PH-0004',
      data: {
        items: [makeItem({ sku: { code: 'NONEXISTENT-999' } })],
      },
    };
    useStore.getState().loadOrder(mockOrder);
    const s = useStore.getState();
    expect(s.sku).toEqual({ code: 'NONEXISTENT-999' });
  });

  it('sets step=4 and maxStep=4', () => {
    const mockOrder = {
      id: 'step-id',
      order_number: 'PH-0005',
      data: { items: [makeItem()], name: 'X' },
    };
    useStore.getState().loadOrder(mockOrder);
    const s = useStore.getState();
    expect(s.step).toBe(4);
    expect(s.maxStep).toBe(4);
  });
});
