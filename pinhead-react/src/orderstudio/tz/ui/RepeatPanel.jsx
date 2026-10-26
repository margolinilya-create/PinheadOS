import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { canCreateOrders } from '../../layout/orderNav';
import { newOrderPath } from '../../screens/newOrder';
import styles from './tz.module.css';

/**
 * «Повторить заказ» (веха 5в, Э8): новый черновик с теми же изделиями,
 * нанесениями, бирками и файлами. На «ТЗ и цена», а не в шапке: вкладка —
 * ленивый чанк, оболочка Order по решению К11 вехи 8 не растёт. Поток —
 * `import()` по нажатию (`workplace/repeatFlow`). Видна тому, кто заводит
 * заказы, и у заказа с позициями.
 */
export default function RepeatPanel({ order, user }) {
  const id = useId();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  if (!canCreateOrders(user) || !order.id || order.items.length === 0) return null;
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { repeatOrder } = await import('../../workplace/repeatFlow');
      await repeatOrder(user, (to) => navigate(newOrderPath(to)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className={styles.panel} aria-labelledby={`${id}-head`}>
      <h2 id={`${id}-head`} className={styles.title}>Повтор заказа</h2>
      <p className={styles.muted}>Новый черновик с теми же изделиями, нанесениями, бирками и файлами. Срок и оплату зададите заново.</p>
      <div className={styles.actions}>
        <button type="button" className="btn" disabled={busy} onClick={run}>
          {busy ? 'Создаю черновик…' : 'Повторить заказ'}
        </button>
      </div>
    </section>
  );
}
