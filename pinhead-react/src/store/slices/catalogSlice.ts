// Catalog slice: catalogs, prices, usdRate, skuCatalog, fabricsCatalog, etc.
import { loadAllCatalogs } from '../../lib/catalogs';
import { invalidatePricesCache } from '../../utils/pricing';
import { storageGet } from '../../lib/storage';
import { PRICES, SKU_CATALOG_DEFAULT, FABRICS_CATALOG_DEFAULT, TRIM_CATALOG_DEFAULT, EXTRAS_CATALOG_DEFAULT, LABELS_CATALOG_DEFAULT } from '../../data';
import { toast } from '../useToastStore';

type SetFn = (update: Record<string, unknown> | ((s: Record<string, unknown>) => Record<string, unknown>)) => void;

export const catalogSlice = (set: SetFn, _get: () => Record<string, unknown>) => ({
  prices: PRICES,
  skuCatalog: SKU_CATALOG_DEFAULT,
  fabricsCatalog: FABRICS_CATALOG_DEFAULT,
  trimCatalog: TRIM_CATALOG_DEFAULT,
  extrasCatalog: EXTRAS_CATALOG_DEFAULT,
  labelsCatalog: LABELS_CATALOG_DEFAULT,
  usdRate: 92,

  loadCatalogs: async () => {
    const patch: Record<string, unknown> = {};
    try {
      const catalogs = await loadAllCatalogs();
      if (catalogs.prices) {
        patch.prices = catalogs.prices;
        if ((catalogs.prices as Record<string, unknown>).usdRate) patch.usdRate = (catalogs.prices as Record<string, unknown>).usdRate;
        invalidatePricesCache();
      }
      if (Array.isArray(catalogs.skuCatalog)) patch.skuCatalog = catalogs.skuCatalog;
      if (Array.isArray(catalogs.fabricsCatalog)) patch.fabricsCatalog = catalogs.fabricsCatalog;
      if (Array.isArray(catalogs.extrasCatalog)) patch.extrasCatalog = catalogs.extrasCatalog;
      if (Array.isArray(catalogs.trimCatalog)) patch.trimCatalog = catalogs.trimCatalog;
      if (Array.isArray(catalogs.labelsCatalog)) patch.labelsCatalog = catalogs.labelsCatalog;
    } catch {
      // Fallback: try localStorage (saved by SkuEditor saveAll)
      const lsSku = storageGet('ph_sku');
      const lsFabrics = storageGet('ph_fabrics');
      const lsTrims = storageGet('ph_trims');
      const lsExtras = storageGet('ph_extras');

      patch.prices = PRICES;
      invalidatePricesCache();
      patch.skuCatalog = lsSku || SKU_CATALOG_DEFAULT;
      patch.fabricsCatalog = lsFabrics || FABRICS_CATALOG_DEFAULT;
      patch.trimCatalog = lsTrims || TRIM_CATALOG_DEFAULT;
      patch.extrasCatalog = lsExtras || EXTRAS_CATALOG_DEFAULT;
      patch.labelsCatalog = LABELS_CATALOG_DEFAULT;
      toast.warning('Каталоги загружены из локального кэша');
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
});
