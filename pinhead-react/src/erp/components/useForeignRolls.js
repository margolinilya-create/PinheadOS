import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * ПЕРЕЧИТЫВАЮТСЯ ПРИ КАЖДОМ ОТКРЫТИИ И ПОСЛЕ СДАЧИ (правка 05.10, п. 5:
 * «после сдачи расхода форма может показывать старый метраж»). Кэш
 * остатков общий для раздела, и форма, открытая после сдачи, брала из него
 * доступный метраж ДО списания — экран расходился с проверкой сервера.
 * Возвращает `{ rolls, reload }`.
 */
export function useForeignRolls(orderId, enabled) {
  const loadFabricLeftovers = useErpStore((st) => st.loadFabricLeftovers);
  const loadOrderForeignRolls = useErpStore((st) => st.loadOrderForeignRolls);
  const leftovers = useErpStore((st) => st.fabricLeftovers);
  const [taken, setTaken] = useState([]);
  const [version, setVersion] = useState(0);

  // Открытие формы и `reload` — всегда свежий список; сброс кэша (`null`)
  // после решения по остатку или правки рулона — тоже
  const inFlight = useRef(false);
  const load = useCallback(() => {
    inFlight.current = true;
    Promise.resolve(loadFabricLeftovers()).finally(() => { inFlight.current = false; });
  }, [loadFabricLeftovers]);
  useEffect(() => {
    if (enabled) load();
  }, [enabled, version, load]);
  useEffect(() => {
    if (enabled && leftovers === null && !inFlight.current) load();
  }, [enabled, leftovers, load]);

  useEffect(() => {
    if (!enabled || !orderId) return undefined;
    let alive = true;
    loadOrderForeignRolls(orderId).then((rows) => { if (alive) setTaken(rows ?? []); });
    return () => { alive = false; };
  }, [enabled, orderId, version, loadOrderForeignRolls]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const rolls = useMemo(
    () => (enabled ? foreignRollOptions([...taken, ...(leftovers ?? [])], orderId) : []),
    [enabled, taken, leftovers, orderId],
  );
  return { rolls, reload };
}
