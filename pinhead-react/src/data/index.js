// ═══════════════════════════════════════════
// Единая точка входа для всех данных
// ═══════════════════════════════════════════

export { PRICES } from './prices';
export { SKU_CATEGORIES, SKU_CATALOG_DEFAULT } from './skuCatalog';
export {
  FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT,
  LAYER1_TYPES, LAYER2_TYPES,
  FABRICS_LAYER1, FABRICS_LAYER2
} from './fabricsCatalog';
export {
  MEDASTEX_COLORS, COLOR_GROUPS,
  COTTONPROM_COLORS, COTTONPROM_GROUPS,
  findColorEntry
} from './colors';
export {
  EXTRAS_CATALOG_DEFAULT, EXTRAS_ICONS, EXTRAS_DESCS,
  LABELS_CATALOG_DEFAULT, LABEL_CONFIG,
  HARDWARE_GROUPS, HARDWARE_CATALOG_DEFAULT
} from './extras';
export {
  SIZES, TYPE_NAMES, FABRIC_NAMES, TECH_NAMES,
  ZONE_LABELS, DEFAULT_USD_RATE
} from './constants';
