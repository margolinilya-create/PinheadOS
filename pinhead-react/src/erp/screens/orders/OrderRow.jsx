import { useMemo, useState, memo } from 'react';
import { Link } from 'react-router-dom';
import { deptShortName } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip } from '../../utils/stageUi';
import { orderLinkClick } from '../../store/useOrderDrawer';
import { hasOpenProcurement } from '../../utils/routes';
import {
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
  ORDER_STATUS_LABELS,
  STAGE_STATUS_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
import { Icon } from '../../components/Icon';
import { DueCell } from './DueCell';

/** Строка таблицы заказов (десктоп ≥760px), раскрывается в позиции + чипы этапов */
function OrderRowBase({ order, departments, onDelete, canDelete, onShip }) {
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
        <td>
          {/* aria-expanded был объявлен, а раскрыть строку с клавиатуры нельзя:
              у <tr> нет tabIndex и обработчика клавиш. Кнопка в первой ячейке
              делает жест доступным, не превращая всю строку в кнопку. */}
          <button
            type="button"
            className={styles.rowToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Свернуть' : 'Развернуть'} заказ ${order.title}`}
            onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
          >
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} />
          </button>
          {order.bitrix_id || '—'}
        </td>
        <td>
          <Link
            to={`/orders/${order.id}`}
            onClick={(e) => orderLinkClick(order.id, e)}
            className={styles.cellTitle}
            title={order.title}
          >
            {order.title} <Icon name="externalLink" size={12} />
          </Link>
          {order.notes && order.notes !== 'imported' && (
            <div className={styles.subText}>{order.notes}</div>
          )}
        </td>
        <td>{order.manager || '—'}</td>
        <td>{totalQty}</td>
        <td>{formatDateShort(order.created_at) || '—'}</td>
        <td><DueCell dueDate={order.due_date} completedAt={order.shipped_at || order.delivered_at} /></td>
        <td>
          {ready ? (
            <span className={`${styles.chip} ${styles.chipReady}`}>
              <Icon name="checkCircle" size={13} /> Готов к отгрузке
            </span>
          ) : (
            <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
              {ORDER_STATUS_LABELS[order.status]}
            </span>
          )}
          {hasOpenProcurement(order.procurement_tasks) && (
            <span className={`${styles.chip} ${styles.chipBlocked}`} title="Есть открытая задача дозакупки">
              <Icon name="bell" size={13} /> дозакупка
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
              <Icon name="truck" size={14} /> Отгрузить
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className="btn btn-ghost"
              aria-label={`Удалить заказ ${order.title}`}
              onClick={() => onDelete(order)}
            >
              <Icon name="x" size={15} />
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
                  {st.status === 'done' && <Icon name="check" size={12} />}
                </span>
              ))}
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей
    (канбан во время DnD, очередь цеха, таблица заказов). */
export const OrderRow = memo(OrderRowBase);
