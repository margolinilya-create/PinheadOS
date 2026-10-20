import { useCallback, useEffect, useMemo, useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { BIZ_TASK_ACTIVE } from '../../utils/bizTasks';

/**
 * Задачи заказа из стора — одна строка на id (`bizTasks`), её же читают общий
 * раздел и карточка задачи. Выбирается сама карта: ссылка на неё меняется
 * только с записью, и новый массив на каждый рендер здесь не рождается.
 */
export function useOrderTaskRows(orderId) {
  const all = useErpStore((s) => s.bizTasks);
  return useMemo(
    () => Object.values(all ?? {}).filter((t) => t.order_id === orderId),
    [all, orderId],
  );
}

/**
 * ЗАГРУЗКА ЗАДАЧ ЗАКАЗА — в карточке, а не во вкладке: подпись вкладки
 * («Бизнес-задачи · 3») видна до того, как вкладку открыли, — тот же довод,
 * что у счётчика непрочитанного чата. Перечитывается на звонок realtime
 * (`bizTaskPing`), а ленивая панель получает готовые строки и состояние.
 */
export function useOrderBizTasks(orderId) {
  const load = useErpStore((s) => s.loadOrderBizTasks);
  const ping = useErpStore((s) => s.bizTaskPing);
  const tasks = useOrderTaskRows(orderId);
  /** Состояние — ПО ЗАКАЗУ: переход на другой заказ не показывает чужое «загружено» */
  const [state, setState] = useState({ orderId: null, loaded: false, failed: false });

  const apply = useCallback((id, rows) => setState((prev) => {
    const was = prev.orderId === id && prev.loaded;
    // Сбой перечитывания не стирает уже показанное: строки в сторе остаются
    return rows ? { orderId: id, loaded: true, failed: false } : { orderId: id, loaded: was, failed: !was };
  }), []);

  useEffect(() => {
    if (!orderId || !load) return undefined;
    let alive = true;
    load(orderId).then((rows) => { if (alive) apply(orderId, rows); });
    return () => { alive = false; };
  }, [orderId, load, ping, apply]);

  const reload = useCallback(async () => {
    if (!orderId || !load) return;
    apply(orderId, await load(orderId));
  }, [orderId, load, apply]);

  const mine = state.orderId === orderId;
  const openCount = useMemo(
    () => tasks.filter((t) => BIZ_TASK_ACTIVE.includes(t.status)).length,
    [tasks],
  );
  return { tasks, openCount, loaded: mine && state.loaded, failed: mine && state.failed, reload };
}
