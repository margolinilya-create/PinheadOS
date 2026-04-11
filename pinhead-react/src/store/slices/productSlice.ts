// Product slice: SKU, fabric, color, fit, sizes, customSizes, extras, labels, labelConfig
import { SIZES } from '../../data';
import { sizeOrder } from './helpers';
import type { CustomSize, LabelConfig } from '../../types/order';
import type { SkuItem, CategoryRules } from '../../types/catalog';
import { getEffectiveRules } from '../../utils/skuRules';

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const productSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  // Initial state for product fields is provided by defaultItemFields in the main store
  // These are the actions:

  // ─── SKU selection ───
  selectSku: (sku: SkuItem) => set((s: Record<string, unknown>) => {
    const CAT_TO_TYPE: Record<string, string> = {
      tshirts:'tee', longsleeves:'longsleeve', polo:'polo',
      hoodies:'hoodie', sweatshirts:'sweat', ziphoodies:'zip-hoodie',
      halfzips:'half-zip', bombers:'bomber',
      pants:'pants', shorts:'shorts', accessories:'shopper',
    };
    const type = sku.mockupType || CAT_TO_TYPE[sku.category] || sku.category;
    const prevType = s.type as string;
    const currentSku = s.sku as SkuItem | null;
    const needReset = prevType !== type || !currentSku || currentSku.code !== sku.code;

    // Resolve category rules to get defaults
    const categoryRules = (s.categoryRules || []) as CategoryRules[];
    const rules = getEffectiveRules(sku, categoryRules);
    const defaultExtras = rules.defaultExtras?.length ? rules.defaultExtras : [];

    // Apply label presets from rules if available
    const labelConfig = rules.labelPresets
      ? { ...(s.labelConfig as LabelConfig), ...rules.labelPresets }
      : s.labelConfig;

    return {
      sku,
      type,
      fit: sku.fit || 'regular',
      fitChosen: true,
      ...(needReset ? {
        fabric: '',
        color: '',
        extras: defaultExtras,
        labels: [],
        zones: sku.zones?.length ? [sku.zones[0]] : [],
        zoneTechs: {},
        zonePrints: {},
        dtgZones: {},
        embZones: {},
        dtfZones: {},
        labelConfig,
      } : {}),
    };
  }),
  setSkuFilter: (f: string) => set({ skuFilter: f }),
  reorderSku: (fromCode: string, toCode: string) => set((s: Record<string, unknown>) => {
    const arr = [...(s.skuCatalog as SkuItem[])];
    const fromIdx = arr.findIndex(x => x.code === fromCode);
    const toIdx = arr.findIndex(x => x.code === toCode);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return {};
    const [item] = arr.splice(fromIdx, 1);
    arr.splice(toIdx, 0, item);
    return { skuCatalog: arr };
  }),

  // ─── Fabric & Color ───
  selectFabric: (key: string) => set((s: Record<string, unknown>) => ({
    fabric: key,
    ...(s.fabric !== key ? { color: '' } : {}),
  })),
  selectColor: (code: string) => set({ color: code }),
  setColorSupplier: (sup: string) => set({ colorSupplier: sup }),

  // ─── Fit ───
  selectFit: (fit: string) => set((s: Record<string, unknown>) => ({
    fit,
    fitChosen: true,
    ...(s.fit !== fit ? { fabric: '', color: '' } : {}),
  })),

  // ─── Sizes ───
  setSize: (size: string, qty: number | string) => set((s: Record<string, unknown>) => ({
    sizes: { ...(s.sizes as Record<string, number>), [size]: Math.max(0, parseInt(String(qty)) || 0) },
  })),
  setOneSizeQty: (qty: number | string) => set({ sizes: { 'ONE SIZE': Math.max(1, parseInt(String(qty)) || 1) } }),

  // ─── Extras ───
  toggleExtra: (code: string) => set((s: Record<string, unknown>) => ({
    extras: (s.extras as string[]).includes(code)
      ? (s.extras as string[]).filter((c: string) => c !== code)
      : [...(s.extras as string[]), code],
  })),

  // ─── Labels ───
  setLabelConfig: (section: string, key: string, value: unknown) => set((s: Record<string, unknown>) => ({
    labelConfig: {
      ...(s.labelConfig as LabelConfig),
      [section]: { ...((s.labelConfig as Record<string, Record<string, unknown>>)[section]), [key]: value },
    },
  })),
  toggleCareLabel: () => set((s: Record<string, unknown>) => ({
    labelConfig: {
      ...(s.labelConfig as LabelConfig),
      careLabel: { ...(s.labelConfig as LabelConfig).careLabel, enabled: !(s.labelConfig as LabelConfig).careLabel.enabled },
    },
  })),

  // ─── Custom Sizes ───
  addCustomSize: (label: string) => set((s: Record<string, unknown>) => {
    const customSizes = s.customSizes as CustomSize[];
    const raw = (label || '').trim().toUpperCase();
    const xMatch = raw.match(/^(X+)L$/);
    const newLabel = xMatch && xMatch[1].length >= 2
      ? `${xMatch[1].length}XL`
      : raw || `${customSizes.length + 4}XL`;
    const allLabels = [...SIZES, ...customSizes.map((c: CustomSize) => c.label.toUpperCase())];
    if (allLabels.includes(newLabel)) return {};
    const updated = [...customSizes, { label: newLabel, qty: 0 }];
    updated.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
    return { customSizes: updated };
  }),
  removeCustomSize: (idx: number) => set((s: Record<string, unknown>) => ({
    customSizes: (s.customSizes as CustomSize[]).filter((_: CustomSize, i: number) => i !== idx),
  })),
  setCustomSizeQty: (idx: number, qty: number | string) => set((s: Record<string, unknown>) => ({
    customSizes: (s.customSizes as CustomSize[]).map((c: CustomSize, i: number) => i === idx ? { ...c, qty: Math.max(0, parseInt(String(qty)) || 0) } : c),
  })),
  setCustomSizeLabel: (idx: number, label: string) => set((s: Record<string, unknown>) => {
    const updated = (s.customSizes as CustomSize[]).map((c: CustomSize, i: number) => i === idx ? { ...c, label } : c);
    updated.sort((a, b) => sizeOrder(a.label) - sizeOrder(b.label));
    return { customSizes: updated };
  }),
});
