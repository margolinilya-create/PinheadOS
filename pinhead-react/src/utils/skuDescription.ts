// ═══════════════════════════════════════════
// Описание изделия из выбранной ткани (правка CRM 13.10, п. 11)
// ═══════════════════════════════════════════
/**
 * Описание модели хранило ткань текстом — «хлопок 240 г/м²» у всех футболок,
 * какая бы ткань ни была выбрана. Теперь фраза о ткани из текста убирается,
 * а состав, плотность и поставщик подставляются из выбранной (или первой
 * подходящей) ткани каталога.
 */
import type { Fabric, SkuItem } from '../types/catalog';

/** «хлопок 240 г/м²», «100% хлопок 180 г/м²» и т. п. — устаревшая фраза о ткани */
const LEGACY_FABRIC = /,?\s*(?:\d+\s*%\s*)?хлопок\s*\d+\s*г\/м²/gi;

export function fabricLine(f: Pick<Fabric, 'name' | 'composition' | 'density' | 'supplier'> | null | undefined): string {
  if (!f) return '';
  return [f.name, f.composition, f.density ? `${f.density} г/м²` : '', f.supplier].filter(Boolean).join(', ');
}

export function skuDescription(
  sku: Pick<SkuItem, 'description' | 'category'>, fabricCode: string | null | undefined, fabrics: Fabric[],
): string {
  const base = (sku.description || '').replace(LEGACY_FABRIC, '').replace(/\s{2,}/g, ' ').trim();
  const fabric = (fabricCode && fabrics.find((f) => f.code === fabricCode))
    || fabrics.find((f) => (f.forCategories || []).includes(sku.category));
  const line = fabricLine(fabric);
  if (!line) return base;
  return base ? `${base}. Ткань: ${line}` : `Ткань: ${line}`;
}
