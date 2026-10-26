import { useState } from 'react';
import { transitionOrder } from '../api/salesTransitions';
import { useSalesStore } from '../store/useSalesStore';
import { canFinish, canSendToWork } from '../layout/orderNav';
import { paymentStatusText } from '../payment/paymentText';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { pluralize } from '../../utils/i18n';
import sales from '../screens/Sales.module.css';
import styles from './Workplace.module.css';

/**
 * Шапка рабочего места (веха 6+7, задача 5): бейдж оплаты; «Отправить в работу»
 * — ТОЛЬКО навигация к разделу отправки на «ТЗ и цена» (`?tab=summary#send`)
 * с числом блокирующих пунктов; «Отметить: заказ сдан» (решение 19) — у
 * `canFinish`, с подтверждением, ответ RPC кладёт `applyServer`.
 *
 * @param {{ order: import('../model/types').SalesOrder, user: object, blocking: number, onGoSend: () => void }} props
 */
export default function HeadActions({ order, user, blocking, onGoSend }) {
  const [busy, setBusy] = useState(false);

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
    <>
      <span className={sales.badge}>{paymentStatusText(order)}</span>
      {canSendToWork(user, order) && (
        <button type="button" className={`btn btn-primary ${styles.headBtn}`} onClick={onGoSend}>
          Отправить в работу{blocking > 0 ? ` · ${blocking} ${pluralize(blocking, 'пункт', 'пункта', 'пунктов')}` : ''}
        </button>
      )}
      {canFinish(user, order) && (
        <button type="button" className={`btn btn-ghost ${styles.headBtn}`} disabled={busy} onClick={finish}>
          Отметить: заказ сдан
        </button>
      )}
    </>
  );
}
