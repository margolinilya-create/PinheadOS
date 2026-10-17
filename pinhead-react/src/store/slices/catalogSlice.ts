// Catalog slice: catalogs, prices, usdRate, skuCatalog, fabricsCatalog, categoryRules, etc.
import { loadAllCatalogs } from '../../lib/catalogs';
import { invalidatePricesCache } from '../../utils/pricing';
import { storageGet } from '../../lib/storage';
import { PRICES, SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT, LABELS_CATALOG_DEFAULT, HARDWARE_CATALOG_DEFAULT, ZONES_CATALOG_DEFAULT } from '../../data';
import { toast } from '../useToastStore';
import type { CategoryRules, ZoneDefinition } from '../../types/catalog';
import { SUPPLIERS_SEED, LABEL_LIBRARY_SEED, TZ_SETTINGS_SEED } from '../../orderstudio/catalog/seeds';
import type { LabelLibrary, Supplier, TzSettings } from '../../orderstudio/catalog/types';

/**
 * Откуда справочники заказа (веха 4): `db` — все три ключа (`suppliers`,
 * `labelLibrary`, `tzSettings`) пришли из базы; `fallback` — хоть один взят
 * из сидов кода (не загрузилось, ключа нет, форма не та). На `fallback`
 * заказы считаются по сидам, а редактор не даёт сохранить сиды поверх базы.
 */
export type CatalogSource = 'db' | 'fallback';

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Форма справочника — грубо, по верхнему уровню: глубже её держит сервер (`catalog_put`) */
const isSuppliers = (v: unknown): v is Supplier[] => Array.isArray(v);
const isLabelLibrary = (v: unknown): v is LabelLibrary =>
  isObj(v) && Array.isArray(v.kinds) && Array.isArray(v.schemes);
const isTzSettings = (v: unknown): v is TzSettings => isObj(v) && typeof v.footerText === 'string';

/** Справочники заказа из ответа загрузки: чего нет или не той формы — сид */
export function orderCatalogsFrom(catalogs: Record<string, unknown>): {
  suppliers: Supplier[]; labelLibrary: LabelLibrary; tzSettings: TzSettings; catalogSource: CatalogSource;
} {
  const okSuppliers = isSuppliers(catalogs.suppliers);
  const okLabels = isLabelLibrary(catalogs.labelLibrary);
  const okTz = isTzSettings(catalogs.tzSettings);
  return {
    suppliers: okSuppliers ? (catalogs.suppliers as Supplier[]) : SUPPLIERS_SEED,
    labelLibrary: okLabels ? (catalogs.labelLibrary as LabelLibrary) : LABEL_LIBRARY_SEED,
    tzSettings: okTz ? (catalogs.tzSettings as TzSettings) : TZ_SETTINGS_SEED,
    catalogSource: okSuppliers && okLabels && okTz ? 'db' : 'fallback',
  };
}

/** Прайс из базы поверх умолчаний кода (неглубоко: таблица целиком — из базы) */
export function mergePrices(db: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...(PRICES as Record<string, unknown>), ...(db || {}) };
}

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const catalogSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  prices: PRICES,
  skuCatalog: SKU_CATALOG_DEFAULT,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  labelsCatalog: LABELS_CATALOG_DEFAULT,
  hardwareCatalog: HARDWARE_CATALOG_DEFAULT,
  categoryRules: [] as CategoryRules[],
  zonesCatalog: ZONES_CATALOG_DEFAULT as ZoneDefinition[],
  usdRate: (PRICES as Record<string, unknown>).usdRate as number,
  suppliers: SUPPLIERS_SEED,
  labelLibrary: LABEL_LIBRARY_SEED,
  tzSettings: TZ_SETTINGS_SEED,
  catalogSource: 'fallback' as CatalogSource,

  loadCatalogs: async () => {
    const patch: Record<string, unknown> = {};
    try {
      const catalogs = await loadAllCatalogs();
      if (catalogs.prices) {
        // Прайс базы — ПОВЕРХ умолчаний: ключ, которого в базе ещё нет
        // (накладные, группы наценки — правка 13.10), берётся из кода, а не
        // пропадает целиком, как было при замене объекта
        const merged = mergePrices(catalogs.prices as Record<string, unknown>);
        patch.prices = merged;
        if (merged.usdRate) patch.usdRate = merged.usdRate;
        invalidatePricesCache();
      }
      if (!patch.usdRate && typeof catalogs.usdRate === 'number') patch.usdRate = catalogs.usdRate;
      if (Array.isArray(catalogs.skuCatalog)) patch.skuCatalog = catalogs.skuCatalog;
      if (Array.isArray(catalogs.fabricsCatalog)) patch.fabricsCatalog = catalogs.fabricsCatalog;
      if (Array.isArray(catalogs.extrasCatalog)) patch.extrasCatalog = catalogs.extrasCatalog;
      if (Array.isArray(catalogs.trimCatalog)) patch.trimCatalog = catalogs.trimCatalog;
      if (Array.isArray(catalogs.labelsCatalog)) patch.labelsCatalog = catalogs.labelsCatalog;
      if (Array.isArray(catalogs.hardwareCatalog)) patch.hardwareCatalog = catalogs.hardwareCatalog;
      if (Array.isArray(catalogs.categoryRules)) patch.categoryRules = catalogs.categoryRules;
      if (Array.isArray(catalogs.zonesCatalog)) patch.zonesCatalog = catalogs.zonesCatalog;
      // Справочники заказа (веха 4). Прайс без права чтения (начальник цеха)
      // не приходит вовсе — `prices` остаётся `PRICES` кода, расчёт не падает
      Object.assign(patch, orderCatalogsFrom(catalogs));
    } catch {
      // Fallback: try localStorage (saved by SkuEditor saveAll)
      const lsSku = storageGet('ph_sku');
      const lsFabrics = storageGet('ph_fabrics');
      const lsTrims = storageGet('ph_trims');
      const lsExtras = storageGet('ph_extras');
      const lsUsdRate = storageGet<number>('ph_usd_rate');

      patch.prices = PRICES;
      if (typeof lsUsdRate === 'number') patch.usdRate = lsUsdRate;
      invalidatePricesCache();
      patch.skuCatalog = lsSku || SKU_CATALOG_DEFAULT;
      patch.fabricsCatalog = lsFabrics || FABRICS_CATALOG_DEFAULT;
      patch.trimCatalog = lsTrims || TRIM_CATALOG_DEFAULT;
      patch.extrasCatalog = lsExtras || EXTRAS_CATALOG_DEFAULT;
      const lsHardware = storageGet('ph_hardware');
      patch.hardwareCatalog = lsHardware || HARDWARE_CATALOG_DEFAULT;
      patch.labelsCatalog = LABELS_CATALOG_DEFAULT;
      const lsCategoryRules = storageGet<CategoryRules[]>('ph_category_rules');
      patch.categoryRules = lsCategoryRules || [];
      const lsZones = storageGet<ZoneDefinition[]>('ph_zones');
      patch.zonesCatalog = lsZones || ZONES_CATALOG_DEFAULT;
      Object.assign(patch, orderCatalogsFrom({}));
      toast.warning('Каталоги загружены из локального кэша');
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
});
