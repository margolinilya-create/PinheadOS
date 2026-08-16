import { useMemo, useState, memo } from 'react';
import { deptShortName } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { STAGE_CHIP_CLASS, isOrderReadyToShip } from '../../utils/stageUi';
import { OrderLink } from '../../components/OrderLink';
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
import { formatDateCell } from '../../utils/format';
import { Button } from '../../components/Button';

/** Строка таблицы заказов (десктоп ≥760px), раскрывается в позиции + чипы этапов */
function OrderRowBase({ order, departments, onDelete, canDelete, onShip, onToggleDemo }) {
  const [open, setOpen] = useState(false);
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const ready = isOrderReadyToShip(order);
  /**
   * Готовность и ПРАВО отгрузить — разное. Признак «готов к отгрузке»
   * видят все: цеху полезно знать, что заказ дособран. Кнопку показываем
   * только тем, кому отгрузка разрешена (`onShip` приходит null без права),
   * иначе она отвечала бы отказом стража заказа.
   */
  const canShip = ready && Boolean(onShip);

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
          <OrderLink
            orderId={order.id}
            className={styles.cellTitle}
            title={order.title}
          >
            {order.title} <Icon name="externalLink" size={12} />
          </OrderLink>
          {/* Когда показ демо включён, тестовый заказ обязан быть отличим:
              иначе список выглядит боевым и человек снова считает по нему сроки. */}
          {order.is_demo && (
            <span className={`${styles.chip} ${styles.chipNeutral}`} title="Тестовый заказ — скрыт в обычном режиме">
              тест
            </span>
          )}
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
              отгружен {formatDateCell(order.shipped_at)}
            </div>
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {canShip && (
            <Button variant="primary" className={styles.shipBtn} onClick={() => onShip(order)}>
              <Icon name="truck" size={14} /> Отгрузить
            </Button>
          )}
          {onToggleDemo && (
            <Button
              variant="ghost"
              aria-label={order.is_demo
                ? `Снять пометку «тестовый» с заказа ${order.title}`
                : `Пометить заказ ${order.title} тестовым`}
              title={order.is_demo ? 'Снять пометку «тестовый»' : 'Пометить тестовым — заказ пропадёт из рабочих списков, но не будет удалён'}
              onClick={() => onToggleDemo(order)}>
              <Icon name={order.is_demo ? 'eye' : 'flask'} size={15} />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghost"
              aria-label={`Удалить заказ ${order.title}`}
              onClick={() => onDelete(order)}>
              <Icon name="x" size={15} />
            </Button>
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
            <div className={`${styles.stageChips} ${styles.stageChipsRow}`}>
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
