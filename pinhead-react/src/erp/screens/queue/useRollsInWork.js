import { useMemo } from 'react';
import { rollsAwaitingFate } from '../../utils/cutRolls';

const NONE = [];

/**
 * Рулоны «в работе» с остатком: рулоны с сохранённым расходом (`options`)
 * и те, что держат закрытие последнего этапа участка (`rollsAwaitingFate` —
 * охват всего заказа). Один список для формы записи и экрана задания.
 */
export function useRollsInWork({ order, item, stage, options = NONE, extraRolls = NONE }) {
  const awaitingFate = useMemo(
    () => (stage ? rollsAwaitingFate(order?.materials, item?.id, stage, order?.items, extraRolls) : []),
    [order, item, stage, extraRolls],
  );
  const inWork = useMemo(() => {
    const seen = new Set();
    return [...awaitingFate, ...options].filter((o) => {
      if (seen.has(o.roll.id)) return false;
      seen.add(o.roll.id);
      return o.roll.status === 'in_use' && !o.roll.leftover_kind
        && Number(o.roll.length_left_m ?? o.roll.qty_left ?? 0) > 0.0005;
    });
  }, [awaitingFate, options]);
  return { awaitingFate, inWork };
}
