import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { deptShortName } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip, stageProgress } from '../../utils/stageUi';
import { orderLinkClick } from '../../store/useOrderDrawer';
import { hasOpenProcurement } from '../../utils/routes';
import { ORDER_STATUS_LABELS, STAGE_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';
import { DueCell } from './DueCell';

/** Карточка заказа вместо строки таблицы (мобильный <760px) */
export function OrderCardMobile({ order, departments, onDelete, canDelete, onShip }) {
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const progress = stageProgress(order.items.flatMap((it) => it.stages));
  const ready = isOrderReadyToShip(order);

  return (
    <article className={styles.orderCardM} aria-label={`Заказ ${order.title}`}>
      <div className={styles.orderCardMHead}>
        <Link
          to={`/orders/${order.id}`}
          onClick={(e) => orderLinkClick(order.id, e)}
          className={styles.orderCardMTitle}
          title={order.title}
        >
          {order.title} ↗
        </Link>
        {canDelete && (
          <button
            type="button"
            className="btn btn-ghost"
            aria-label={`Удалить заказ ${order.title}`}
            onClick={() => onDelete(order)}
          >
            ✕
          </button>
        )}
      </div>
      <div className={styles.subText}>
        №{order.bitrix_id || '—'}
        {order.manager ? ` · ${order.manager}` : ''} · {totalQty} шт
        {order.created_at ? ` · создан ${formatDateShort(order.created_at)}` : ''}
      </div>
      <div className={styles.orderCardMMeta}>
        {ready ? (
          <span className={`${styles.chip} ${styles.chipReady}`}>✅ Готов к отгрузке</span>
        ) : (
          <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        )}
        {order.shipped_at && (
          <span className={styles.subText}>
            отгружен {new Date(order.shipped_at).toLocaleDateString('ru-RU')}
          </span>
        )}
        {hasOpenProcurement(order.procurement_tasks) && (
          <span className={`${styles.chip} ${styles.chipBlocked}`}>🔔 дозакупка</span>
        )}
        <DueCell dueDate={order.due_date} completedAt={order.shipped_at || order.delivered_at} />
        {progress.total > 0 && (
          <span className={styles.progressCell} aria-label={`Этапов готово: ${progress.done} из ${progress.total}`}>
            {progress.done}/{progress.total}
          </span>
        )}
      </div>
      {ready && (
        <button
          type="button"
          className={`btn btn-primary ${styles.shipBtn}`}
          onClick={() => onShip(order)}
        >
          🚚 Отгрузить
        </button>
      )}
      {order.items.map((it) => (
        <div key={it.id} className={styles.orderCardMItem}>
          <span className={styles.subText}>{it.product_type} × {it.qty}</span>
          {it.stages.map((st) => (
            <span
              key={st.id}
              className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[st.status]]}`}
              title={`${deptById.get(st.department_id)?.name || '?'} · ${STAGE_STATUS_LABELS[st.status]}`}
            >
              {(() => {
                const dd = deptById.get(st.department_id);
                return dd ? deptShortName(dd.code, dd.name) : '?';
              })()}
              {st.status === 'done' && ' ✓'}
            </span>
          ))}
        </div>
      ))}
    </article>
  );
}
