// Catalog slice: catalogs, prices, usdRate, skuCatalog, fabricsCatalog, etc.
import { loadAllCatalogs } from '../../lib/catalogs';
import { invalidatePricesCache } from '../../utils/pricing';
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
      if (catalogs.skuCatalog) patch.skuCatalog = catalogs.skuCatalog;
      if (catalogs.fabricsCatalog) patch.fabricsCatalog = catalogs.fabricsCatalog;
      if (catalogs.extrasCatalog) patch.extrasCatalog = catalogs.extrasCatalog;
      if (catalogs.trimCatalog) patch.trimCatalog = catalogs.trimCatalog;
      if (catalogs.labelsCatalog) patch.labelsCatalog = catalogs.labelsCatalog;
    } catch {
      patch.prices = PRICES;
      invalidatePricesCache();
      patch.skuCatalog = SKU_CATALOG_DEFAULT;
      patch.fabricsCatalog = FABRICS_CATALOG_DEFAULT;
      patch.extrasCatalog = EXTRAS_CATALOG_DEFAULT;
      patch.trimCatalog = TRIM_CATALOG_DEFAULT;
      patch.labelsCatalog = LABELS_CATALOG_DEFAULT;
      toast.warning('Каталоги загружены в офлайн-режиме. Цены могут быть устаревшими.');
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
});
