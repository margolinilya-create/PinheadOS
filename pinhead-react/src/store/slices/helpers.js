// Shared helpers and constants used across slices
import { SIZES } from '../../data';

// Начальные размеры {2XS:0, XS:0, ...}
export const initSizes = () => Object.fromEntries(SIZES.map(s => [s, 0]));

// Порядок размеров для сортировки (от маленького к большому)
const SIZE_ORDER_MAP = { '3XS': 1, '2XS': 2, 'XS': 3, 'S': 4, 'M': 5, 'L': 6, 'XL': 7, '2XL': 8, '3XL': 9, '4XL': 10, '5XL': 11, '6XL': 12, '7XL': 13, '8XL': 14, '9XL': 15, '10XL': 16 };
export function sizeOrder(label) {
  const up = (label || '').toUpperCase().trim();
  if (SIZE_ORDER_MAP[up]) return SIZE_ORDER_MAP[up];
  const num = parseInt(up);
  if (!isNaN(num)) return 100 + num;
  return 999;
}

// ─── Поля позиции (line item) ───
export const ITEM_FIELDS = [
  'type', 'fabric', 'color', 'sku', 'sizes', 'customSizes', 'fit', 'fitChosen',
  'extras', 'labels', 'zones', 'tech', 'textileColor', 'zoneTechs', 'zonePrints',
  'flexZones', 'dtgZones', 'embZones', 'dtfZones', 'zoneArtworks', 'designNotes',
  'sizeComment', 'noPrint', 'labelConfig', 'colorSupplier', 'skuFilter',
];

export const defaultItemFields = {
  type: '', fabric: '', color: '', sku: null,
  sizes: initSizes(), customSizes: [], fit: 'regular', fitChosen: false,
  extras: [], labels: [],
  zones: [], tech: 'screen', textileColor: 'white',
  zoneTechs: {}, zonePrints: {}, flexZones: {}, dtgZones: {}, embZones: {}, dtfZones: {},
  zoneArtworks: {}, designNotes: '', sizeComment: '', noPrint: false,
  labelConfig: {
    careLabel: { enabled: false, logoOption: 'no-logo', composition: '', country: '', uploadData: null, comments: '' },
    mainLabel: { option: 'none', placement: 'neck', material: 'woven', color: 'white', uploadData: null, comments: '' },
    hangTag:   { option: 'none', uploadData: null, comments: '' },
  },
  colorSupplier: 'medastex', skuFilter: 'all',
};

export function snapshotItem(state) {
  const item = {};
  for (const k of ITEM_FIELDS) {
    const v = state[k];
    item[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
  }
  return item;
}

export function restoreItem(item) {
  const patch = {};
  for (const k of ITEM_FIELDS) {
    if (k in item) {
      const v = item[k];
      patch[k] = (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    }
  }
  return patch;
}
