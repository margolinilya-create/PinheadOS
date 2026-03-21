// ── Order types ──

import type { SkuItem } from './catalog';

export type OrderStatus = 'draft' | 'review' | 'approved' | 'production' | 'done';

export interface Order {
  id: string;
  order_number: string;
  status: OrderStatus;
  data: OrderData;
  total_sum: number;
  total_qty: number;
  item_type: string;
  bitrix_deal: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at?: string;
}

export interface OrderData {
  items: OrderItem[];
  name: string;
  contact: string;
  email: string;
  phone: string;
  messenger: string;
  bitrixDeal: string;
  deadline: string;
  address: string;
  notes: string;
  role: string;
  packOption: boolean;
  urgentOption: boolean;
  managerName: string;
  total?: number;
  totalQty?: number;
  type?: string;
}

export interface ZonePrintParams {
  colors: number | string;
  size: string;
  textile: 'white' | 'color';
  fx: string;
}

export interface FlexZoneParams {
  colors: number | string;
  size: string;
}

export interface DtgZoneParams {
  size: string;
  textile: 'white' | 'color';
}

export interface EmbZoneParams {
  colors: number | string;
  area: 's' | 'm' | 'l';
}

export interface DtfZoneParams {
  size: string;
}

export interface CustomSize {
  label: string;
  qty: number | string;
  measurements?: string;
}

export interface CareLabelConfig {
  enabled: boolean;
  logoOption: 'my-logo' | 'no-logo' | 'standard';
  composition: string;
  country: string;
  uploadData: string | null;
  comments: string;
}

export interface MainLabelConfig {
  option: 'none' | 'send-own' | 'standard' | 'custom';
  placement: 'neck' | 'inseam';
  material: 'woven' | 'polyester' | 'canvas';
  color: 'white' | 'black';
  uploadData: string | null;
  comments: string;
}

export interface HangTagConfig {
  option: 'none' | 'standard' | 'custom';
  uploadData: string | null;
  comments: string;
}

export interface LabelConfig {
  careLabel: CareLabelConfig;
  mainLabel: MainLabelConfig;
  hangTag: HangTagConfig;
}

export interface OrderItem {
  sku: SkuItem | null;
  type: string;
  fabric: string;
  color: string;
  fit: 'regular' | 'oversize' | 'free';
  sizes: Record<string, number>;
  customSizes: CustomSize[];
  zones: string[];
  zoneTechs: Record<string, string>;
  zonePrints: Record<string, ZonePrintParams>;
  flexZones: Record<string, FlexZoneParams>;
  dtgZones: Record<string, DtgZoneParams>;
  embZones: Record<string, EmbZoneParams>;
  dtfZones: Record<string, DtfZoneParams>;
  extras: string[];
  labels: string[];
  labelConfig: LabelConfig;
  tech: string;
  textileColor: string;
  zoneArtworks: Record<string, string>;
  designNotes: string;
  sizeComment: string;
  noPrint: boolean;
  fitChosen: boolean;
  colorSupplier: string;
  skuFilter: string;
}

export interface StatusColors {
  bg: string;
  text: string;
  bar: string;
}
