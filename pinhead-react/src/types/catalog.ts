// ── Catalog types ──

export interface SkuCategory {
  id: string;
  name: string;
}

/** Category-level rules for wizard filtering and defaults */
export interface CategoryRules {
  categoryId: string;
  /** Allowed print techniques, null/undefined = all */
  allowedTechs?: string[] | null;
  /** Per-zone tech restrictions, e.g. { hood: ['flex', 'dtg'] } */
  allowedZoneTechs?: Record<string, string[]> | null;
  /** Allowed color codes, null/undefined = all */
  allowedColors?: string[] | null;
  /** Auto-selected extras on SKU selection */
  defaultExtras?: string[];
  /** Minimum order quantity */
  moq?: number;
  /** Available sizes for this category */
  availableSizes?: string[];
  /** Default label presets */
  labelPresets?: Record<string, unknown> | null;
}

/** Fields that can be overridden per-SKU */
export type CategoryRulesOverrides = Partial<Omit<CategoryRules, 'categoryId'>>;

export interface SkuItem {
  code: string;
  name: string;
  category: string;
  fit: 'regular' | 'oversize' | 'free' | 'classic' | null;
  sewingPrice: number;
  mainFabricUsage: number;
  trimCode: string | null;
  trimUsage: number;
  mockupType: string | null;
  zones: string[];
  photos?: string[];
  description?: string;
  shortDesc?: string;
  sizeChart?: { headers: string[]; rows: (string | number)[][] } | null;
  article?: string;
  /** Per-SKU overrides of category rules */
  overrides?: CategoryRulesOverrides;
  /** Price multiplier: 1.1 = +10% to cost */
  priceMultiplier?: number;
}

export interface Fabric {
  code: string;
  name: string;
  supplier: string;
  composition: string;
  density: number | null;
  priceUSD: number;
  forCategories: string[];
}

export interface Trim {
  code: string;
  name: string;
  supplier: string;
  priceUSD: number;
}

export declare const FABRIC_SUPPLIERS: string[];

export interface ColorEntry {
  code: string;
  name: string;
  hex: string;
}

export interface ColorGroup {
  label: string;
  codes: string[];
}

export interface ExtraItem {
  code: string;
  name: string;
  price: number;
  forCategories: string[];
}

export interface LabelItem {
  code: string;
  name: string;
  price: number;
  forCategories: string[];
}

export interface HardwareGroup {
  id: string;
  name: string;
}

export interface HardwareItem {
  code: string;
  name: string;
  price: number;
  group: string;
}

export interface CareLabelOption {
  key: string;
  name: string;
  priceDelta: number;
}

export interface MainLabelOption {
  key: string;
  name: string;
  price: number;
}

export interface MainLabelPlacement {
  key: string;
  name: string;
}

export interface MainLabelMaterial {
  key: string;
  name: string;
  priceDelta: number;
}

export interface MainLabelColor {
  key: string;
  name: string;
  hex: string;
}

export interface HangTagOption {
  key: string;
  name: string;
  price: number;
}

export interface LabelConfigCatalog {
  careLabel: {
    id: string;
    name: string;
    nameShort: string;
    basePrice: number;
    options: CareLabelOption[];
  };
  mainLabel: {
    id: string;
    name: string;
    nameShort: string;
    options: MainLabelOption[];
    placements: MainLabelPlacement[];
    materials: MainLabelMaterial[];
    colors: MainLabelColor[];
    dimensions: { width: number; height: number; unit: string };
  };
  hangTag: {
    id: string;
    name: string;
    nameShort: string;
    options: HangTagOption[];
  };
}
