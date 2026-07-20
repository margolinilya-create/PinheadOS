import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { deptShortName } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip } from '../../utils/stageUi';
import {
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  STAGE_STATUS_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
import { DueCell } from './DueCell';

/** Строка таблицы заказов (десктоп ≥760px), раскрывается в позиции + чипы этапов */
export function OrderRow({ order, departments, onDelete, canDelete, onShip }) {
  const [open, setOpen] = useState(false);
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const ready = isOrderReadyToShip(order);

  return (
    <>
      <tr
        className={styles.rowClickable}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <td>{order.bitrix_id || '—'}</td>
        <td>
          <Link
            to={`/orders/${order.id}`}
            onClick={(e) => e.stopPropagation()}
            className={styles.cellTitle}
            title={order.title}
          >
            {order.title} ↗
          </Link>
          {order.notes && order.notes !== 'imported' && (
            <div className={styles.subText}>{order.notes}</div>
          )}
        </td>
        <td>{order.manager || '—'}</td>
        <td>{totalQty}</td>
        <td>{formatDateShort(order.created_at) || '—'}</td>
        <td><DueCell dueDate={order.due_date} /></td>
        <td>
          {ready ? (
            <span className={`${styles.chip} ${styles.chipReady}`}>✅ Готов к отгрузке</span>
          ) : (
            <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          )}
          {order.shipped_at && (
            <div className={styles.subText}>
              отгружен {new Date(order.shipped_at).toLocaleDateString('ru-RU')}
            </div>
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {ready && (
            <button
              type="button"
              className={`btn btn-primary ${styles.shipBtn}`}
              onClick={() => onShip(order)}
            >
              🚚 Отгрузить
            </button>
          )}
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
        </td>
      </tr>
      {open && order.items.map((it) => (
        <tr key={it.id}>
          <td />
          <td colSpan={7}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{it.product_type}</strong>
              {it.variant && <span className={styles.subText}>{it.variant}</span>}
              <span>× {it.qty}</span>
              <span className={`${styles.chip} ${styles.chipNeutral}`}>
                {PRODUCTION_TYPE_LABELS[it.production_type]}
              </span>
              {it.branding_methods.map((m) => (
                <span key={m} className={`${styles.chip} ${styles.chipNeutral}`}>
                  {BRANDING_METHOD_LABELS[m]}
                </span>
              ))}
            </div>
            <div className={styles.stageChips} style={{ marginTop: 6 }}>
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
          </td>
        </tr>
      ))}
    </>
  );
}
