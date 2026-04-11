import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../store/useStore';

// ── Helpers ──

const makeSku = (overrides = {}) => ({
  code: 'TEST-001',
  name: 'Test Hoodie',
  category: 'hoodies',
  fit: 'regular',
  sewingPrice: 350,
  mainFabricUsage: 1.5,
  trimCode: 'kashkorse',
  trimUsage: 0.15,
  mockupType: 'hoodie',
  zones: ['front', 'back', 'hood'],
  ...overrides,
});

const hoodiesRule = {
  categoryId: 'hoodies',
  defaultExtras: ['zipper-pull', 'wash-label'],
  moq: 10,
  allowedTechs: ['screen', 'flex', 'dtg'],
};

const tshirtsRule = {
  categoryId: 'tshirts',
  defaultExtras: ['overlock'],
  labelPresets: { careLabel: { enabled: true, logoOption: 'standard' } },
};

describe('selectSku with category rules', () => {
  beforeEach(() => {
    useStore.setState({
      categoryRules: [hoodiesRule, tshirtsRule],
      sku: null,
      type: '',
      extras: [],
      zones: [],
      labelConfig: {
        careLabel: { enabled: false, logoOption: 'no-logo' },
        mainLabel: { option: 'none' },
        hangTag: { option: 'none' },
      },
    });
  });

  it('applies defaultExtras from category rules on SKU selection', () => {
    useStore.getState().selectSku(makeSku());
    const { extras } = useStore.getState();
    expect(extras).toEqual(['zipper-pull', 'wash-label']);
  });

  it('applies empty extras when no rules exist', () => {
    useStore.setState({ categoryRules: [] });
    useStore.getState().selectSku(makeSku());
    const { extras } = useStore.getState();
    expect(extras).toEqual([]);
  });

  it('applies defaultExtras for different category', () => {
    useStore.getState().selectSku(makeSku({ category: 'tshirts', code: 'TEE-001', name: 'Test Tee', mockupType: 'tee' }));
    const { extras } = useStore.getState();
    expect(extras).toEqual(['overlock']);
  });

  it('applies labelPresets from rules', () => {
    useStore.getState().selectSku(makeSku({ category: 'tshirts', code: 'TEE-001', mockupType: 'tee' }));
    const { labelConfig } = useStore.getState();
    expect(labelConfig.careLabel.enabled).toBe(true);
    expect(labelConfig.careLabel.logoOption).toBe('standard');
  });

  it('does not reset extras on re-selecting same SKU', () => {
    const sku = makeSku();
    useStore.getState().selectSku(sku);
    // Toggle an extra manually
    useStore.getState().toggleExtra('custom-extra');
    const extrasBefore = useStore.getState().extras;
    expect(extrasBefore).toContain('custom-extra');

    // Re-select same SKU — needReset should be false
    useStore.getState().selectSku(sku);
    const extrasAfter = useStore.getState().extras;
    // Should NOT be reset since it's the same SKU
    expect(extrasAfter).toContain('custom-extra');
  });

  it('resets extras when selecting a different SKU', () => {
    useStore.getState().selectSku(makeSku());
    useStore.getState().toggleExtra('custom-extra');
    // Select different SKU
    useStore.getState().selectSku(makeSku({ code: 'TEST-002', name: 'Test Hoodie 2' }));
    const { extras } = useStore.getState();
    // Should be reset to defaults
    expect(extras).toEqual(['zipper-pull', 'wash-label']);
    expect(extras).not.toContain('custom-extra');
  });

  it('per-SKU override defaultExtras take precedence', () => {
    const sku = makeSku({ overrides: { defaultExtras: ['custom-finish'] } });
    useStore.getState().selectSku(sku);
    const { extras } = useStore.getState();
    expect(extras).toEqual(['custom-finish']);
  });
});

describe('per-SKU filtering fields', () => {
  it('SKU with allowedFabrics is stored in state', () => {
    useStore.setState({ categoryRules: [], sku: null, type: '' });
    const sku = makeSku({ allowedFabrics: ['kulirnaya', 'dvunitka'] });
    useStore.getState().selectSku(sku);
    const { sku: stored } = useStore.getState();
    expect(stored.allowedFabrics).toEqual(['kulirnaya', 'dvunitka']);
  });

  it('SKU with allowedExtras is stored in state', () => {
    useStore.setState({ categoryRules: [], sku: null, type: '' });
    const sku = makeSku({ allowedExtras: ['overlock', 'wash-label'] });
    useStore.getState().selectSku(sku);
    const { sku: stored } = useStore.getState();
    expect(stored.allowedExtras).toEqual(['overlock', 'wash-label']);
  });

  it('SKU with availableSizes is stored in state', () => {
    useStore.setState({ categoryRules: [], sku: null, type: '' });
    const sku = makeSku({ availableSizes: ['S', 'M', 'L'] });
    useStore.getState().selectSku(sku);
    const { sku: stored } = useStore.getState();
    expect(stored.availableSizes).toEqual(['S', 'M', 'L']);
  });

  it('SKU without per-SKU fields defaults to undefined', () => {
    useStore.setState({ categoryRules: [], sku: null, type: '' });
    const sku = makeSku();
    useStore.getState().selectSku(sku);
    const { sku: stored } = useStore.getState();
    expect(stored.allowedFabrics).toBeUndefined();
    expect(stored.allowedExtras).toBeUndefined();
    expect(stored.availableSizes).toBeUndefined();
  });
});
