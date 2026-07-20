/**
 * Единый матчер заказа по поисковому запросу (правка 5): № заказа/сделки, название,
 * менеджер, изделие (product_type/variant), материал. Пустой запрос — совпадает со всем.
 */
export function matchesOrderQuery(order, q) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return true;
  if ((order.bitrix_id || '').toLowerCase().includes(query)) return true;
  if ((order.order_number || '').toLowerCase().includes(query)) return true;
  if ((order.title || '').toLowerCase().includes(query)) return true;
  if ((order.manager || '').toLowerCase().includes(query)) return true;
  if ((order.items || []).some((it) =>
    (it.product_type || '').toLowerCase().includes(query) ||
    (it.variant || '').toLowerCase().includes(query))) return true;
  if ((order.materials || []).some((m) => (m.name || '').toLowerCase().includes(query))) return true;
  return false;
}
