// ── Catalog types ──

export interface SkuCategory {
  id: string;
  name: string;
}

export interface SkuItem {
  code: string;
  name: string;
  category: string;
  fit: 'regular' | 'oversize' | 'free' | null;
  sewingPrice: number;
  mainFabricUsage: number;
  trimCode: string | null;
  trimUsage: number;
  mockupType: string;
  zones: string[];
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

export const FABRIC_SUPPLIERS: string[];

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
