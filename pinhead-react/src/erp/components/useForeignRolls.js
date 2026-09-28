import { useEffect, useMemo, useState } from 'react';
import { useErpStore } from '../store/useErpStore';
import { foreignRollOptions } from '../utils/cutRolls';

/**
 * РУЛОНЫ ДРУГИХ ЗАКАЗОВ ДЛЯ ЗАКРОЯ (правка 28.09).
 *
 * «Если рулон используется в нескольких заказах, каждый следующий заказ
 * получает только его доступный остаток». Два источника: пригодные остатки
 * со склада (`erp_fabric_leftovers`) и рулоны чужих заказов, которые этот
 * заказ уже взял в работу (`erp_order_foreign_rolls`) — без второго взятый
 * остаток пропал бы из формы, и ни доиспользовать, ни решить его судьбу
 * было бы негде. Грузятся только у участка, который кроит по рулонам.
 */
export function useForeignRolls(orderId, enabled) {
  const loadFabricLeftovers = useErpStore((st) => st.loadFabricLeftovers);
  const loadOrderForeignRolls = useErpStore((st) => st.loadOrderForeignRolls);
  const leftovers = useErpStore((st) => st.fabricLeftovers);
  const [taken, setTaken] = useState([]);

  // Список остатков общий для раздела: сброс кэша (`null`) после решения
  // по остатку или правки рулона перечитывает его здесь же
  useEffect(() => {
    if (enabled && !leftovers) loadFabricLeftovers();
  }, [enabled, leftovers, loadFabricLeftovers]);

  useEffect(() => {
    if (!enabled || !orderId) return undefined;
    let alive = true;
    loadOrderForeignRolls(orderId).then((rows) => { if (alive) setTaken(rows ?? []); });
    return () => { alive = false; };
  }, [enabled, orderId, loadOrderForeignRolls]);

  return useMemo(
    () => (enabled ? foreignRollOptions([...taken, ...(leftovers ?? [])], orderId) : []),
    [enabled, taken, leftovers, orderId],
  );
}
