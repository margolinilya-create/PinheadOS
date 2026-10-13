import type { ErpOrderFull } from './types';

/**
 * СПИСОК НЕ ЗАТИРАЕТ ДЕТАЛЬ (правка 05.10, п. 2).
 *
 * `loadAll` (первая загрузка, пересинхронизация после разрыва связи, полное
 * перечитывание realtime) приносит СПИСОЧНЫЕ заказы — без размерной сетки
 * позиции и стоимости сборки. Прежде они заменяли полный заказ целиком,
 * а `detailIds` при этом оставался: форма сдачи считала деталь загруженной
 * и работала без сетки — «Размерная сетка заказа не найдена», стандартная
 * шкала и крой в 3XS/2XS на заказе XS/S/M.
 *
 * Для заказов из `detailIds` колонки, которых в списке нет, берутся из
 * прежней полной строки; всё, что список принёс, — свежее из списка.
 * Позиции и этапы сливаются по `id`, удалённые не воскресают.
 */
export function mergeListOverDetail(
  list: ErpOrderFull[],
  prev: readonly ErpOrderFull[],
  detailIds: readonly string[],
): ErpOrderFull[] {
  if (detailIds.length === 0) return list;
  const detail = new Set(detailIds);
  const prevById = new Map(prev.map((o) => [o.id, o]));
  return list.map((o) => {
    const old = detail.has(o.id) ? prevById.get(o.id) : undefined;
    if (!old) return o;
    const oldItems = new Map((old.items ?? []).map((i) => [i.id, i]));
    return {
      ...old,
      ...o,
      items: (o.items ?? []).map((it) => {
        const oi = oldItems.get(it.id);
        if (!oi) return it;
        const oldStages = new Map((oi.stages ?? []).map((st) => [st.id, st]));
        return {
          ...oi,
          ...it,
          stages: (it.stages ?? []).map((st) => ({ ...oldStages.get(st.id), ...st })),
        };
      }),
    } as ErpOrderFull;
  });
}
