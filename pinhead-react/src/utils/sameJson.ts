/**
 * Смысловое равенство JSON — как `=` у jsonb на сервере: порядок ключей
 * не важен, ключ со значением `undefined` равен отсутствующему (в JSON его нет).
 *
 * Общее для редакторов справочников: `/sku` (useSkuSave, PricingTabContent)
 * и «Справочников заказа» (useCatalogEditor) — база записи сверяется с правкой.
 */
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameJson(x, b[i]));
  }
  if (!isObj(a) || !isObj(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (!sameJson(a[k], b[k])) return false;
  }
  return true;
}
