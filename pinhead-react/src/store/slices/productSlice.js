// Product slice: SKU, fabric, color, fit, sizes, customSizes, extras, labels, labelConfig
import { SIZES } from '../../data';
import { sizeOrder } from './helpers';

export const productSlice = (set, _get) => ({
  // Initial state for product fields is provided by defaultItemFields in the main store
  // These are the actions:

  // ─── SKU selection ───
  selectSku: (sku) => set(s => {
    const CAT_TO_TYPE = {
      tshirts:'tee', longsleeves:'longsleeve', tanks:'tank',
      hoodies:'hoodie', sweatshirts:'sweat', ziphoodies:'zip-hoodie',
      pants:'pants', shorts:'shorts', accessories:'shopper',
    };
    const type = sku.mockupType || CAT_TO_TYPE[sku.category] || sku.category;
    const prevType = s.type;
    const needReset = prevType !== type || !s.sku || s.sku.code !== sku.code;
    return {
      sku,
      type,
      fit: sku.fit || 'regular',
      fitChosen: true,
      ...(needReset ? {
        fabric: '',
        color: '',
        extras: [],
        labels: [],
        zones: sku.zones?.length ? [sku.zones[0]] : [],
        zoneTechs: {},
        zonePrints: {},
        dtgZones: {},
        embZones: {},
        dtfZones: {},
      } : {}),
    };
  }),
  setSkuFilter: (f) => set({ skuFilter: f }),
  reorderSku: (fromCode, toCode) => set(s => {
    const arr = [...s.skuCatalog];
    const fromIdx = arr.findIndex(x => x.code === fromCode);
    const toIdx = arr.findIndex(x => x.code === toCode);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return {};
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    return { skuCatalog: arr };
  }),

  // ─── Fabric & Color ───
  selectFabric: (key) => set(s => ({
    fabric: key,
    ...(s.fabric !== key ? { color: '' } : {}),
  })),
  selectColor: (code) => set({ color: code }),
  setColorSupplier: (sup) => set({ colorSupplier: sup }),

  // ─── Fit ───
  selectFit: (fit) => set(s => ({
    fit,
    fitChosen: true,
    ...(s.fit !== fit ? { fabric: '', color: '' } : {}),
  })),

  // ─── Sizes ───
  setSize: (size, qty) => set(s => ({
    sizes: { ...s.sizes, [size]: Math.max(0, parseInt(qty) || 0) },
  })),
  setOneSizeQty: (qty) => set({ sizes: { 'ONE SIZE': Math.max(1, parseInt(qty) || 1) } }),

  // ─── Extras ───
  toggleExtra: (code) => set(s => ({
    extras: s.extras.includes(code)
      ? s.extras.filter(c => c !== code)
      : [...s.extras, code],
  })),

  // ─── Labels ───
  setLabelConfig: (section, key, value) => set(s => ({
    labelConfig: {
      ...s.labelConfig,
      [section]: { ...s.labelConfig[section], [key]: value },
    },
  })),
  toggleCareLabel: () => set(s => ({
    labelConfig: {
      ...s.labelConfig,
      careLabel: { ...s.labelConfig.careLabel, enabled: !s.labelConfig.careLabel.enabled },
    },
  })),

  // ─── Custom Sizes ───
  addCustomSize: (label) => set(s => {
    const raw = (label || '').trim().toUpperCase();
    const xMatch = raw.match(/^(X+)L$/);
    const newLabel = xMatch && xMatch[1].length >= 2
      ? `${xMatch[1].length}XL`
      : raw || `${s.customSizes.length + 4}XL`;
    const allLabels = [...SIZES, ...s.customSizes.map(c => c.label.toUpperCase())];
    if (allLabels.includes(newLabel)) return {};
    const updated = [...s.customSizes, { label: newLabel, qty: 0 }];
    updated.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
    return { customSizes: updated };
  }),
  removeCustomSize: (idx) => set(s => ({
    customSizes: s.customSizes.filter((_, i) => i !== idx),
  })),
  setCustomSizeQty: (idx, qty) => set(s => ({
    customSizes: s.customSizes.map((c, i) => i === idx ? { ...c, qty: Math.max(0, parseInt(qty) || 0) } : c),
  })),
  setCustomSizeLabel: (idx, label) => set(s => {
    const updated = s.customSizes.map((c, i) => i === idx ? { ...c, label } : c);
    updated.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
    return { customSizes: updated };
  }),
});
