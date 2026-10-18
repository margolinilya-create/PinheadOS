import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { transitionOrder } from '../api/salesTransitions';
import { useSalesStore } from '../store/useSalesStore';
import { canFinish } from '../layout/orderNav';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { switchToProduction } from '../switchToProduction';
import { nextInQueue } from './launchView';
import styles from './Launch.module.css';

export const QUEUE_PATH = '/sales?status=ready_to_launch&sort=due';

const TITLES = {
  launched: 'Заказ запущен в производство',
  returned: 'Заказ возвращён менеджеру',
  production: 'Заказ уже запущен',
  draft: 'Заказ вернули менеджеру',
  done: 'Заказ сдан',
};

/**
 * Итог экрана «К запуску»: после запуска или возврата, либо заказ уже не ждёт
 * запуска. Фокус — на заголовок итога (`h2 tabIndex=-1`). «Отметить: заказ
 * сдан» — у `production` с подтверждением (решение 19); «Следующий к запуску»
 * — по сроку, при пустой очереди — «К списку».
 *
 * @param {{ order: import('../model/types').SalesOrder, user: object, kind: string, warnings?: string[] }} props
 */
export default function LaunchOutcome({ order, user, kind, warnings = [] }) {
  const navigate = useNavigate();
  const headRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const { list, loadList } = useSalesStore(useShallow((s) => ({ list: s.list, loadList: s.loadList })));
  const title = TITLES[kind] ?? 'Заказ не ожидает запуска';
  const { next, left } = nextInQueue(list, order.id);
  const erpId = order.erp_order_id;

  useEffect(() => { headRef.current?.focus(); }, [kind]);
  useEffect(() => { void loadList(); }, [loadList]);

  const finish = async () => {
    const ok = await confirm({
      title: `Заказ ${order.number} сдан клиенту?`,
      message: 'Вернуть статус нельзя',
      confirmLabel: 'Отметить: заказ сдан',
    });
    if (!ok) return;
    setBusy(true);
    const res = await transitionOrder(order.id, 'done');
    setBusy(false);
    if (!res) return;
    useSalesStore.getState().applyServer({ ...res, id: order.id });
    toast.success(`Заказ ${order.number} отмечен сданным`);
  };

  return (
    <section className={styles.outcome} aria-labelledby="launch-outcome">
      <h2 id="launch-outcome" ref={headRef} tabIndex={-1} className={styles.outcomeTitle}>{title}</h2>
      {warnings.length > 0 && (
        <ul className={styles.warnList} aria-label="Предупреждения запуска">
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      <div className={styles.outcomeActions}>
        {erpId && (order.status === 'production' || order.status === 'done') && (
          <button type="button" className="btn btn-ghost" onClick={() => switchToProduction(`/orders/${erpId}`)}>
            {order.number ? `Открыть ${order.number} в производстве` : 'Открыть заказ в производстве'}
          </button>
        )}
        {canFinish(user, order) && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={finish}>Отметить: заказ сдан</button>
        )}
        {next ? (
          <button type="button" className="btn btn-primary" onClick={() => navigate(`/sales/${next.id}/launch`)}>
            Следующий к запуску (осталось {left})
          </button>
        ) : (
          <button type="button" className="btn btn-primary" onClick={() => navigate(QUEUE_PATH)}>К списку</button>
        )}
      </div>
    </section>
  );
}
