import { useMemo, memo } from 'react';
import { Link } from 'react-router-dom';
import { deptShortName } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { STAGE_CHIP_CLASS, canShipOrder, isOrderReadyToShip } from '../../utils/stageUi';
import { useErpStore } from '../../store/useErpStore';
import { orderProgress } from '../../utils/progress';
import { orderLinkClick } from '../../store/useOrderDrawer';
import { hasOpenProcurement } from '../../utils/routes';
import { ORDER_STATUS_LABELS, STAGE_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';
import { Icon } from '../../components/Icon';
import { DueCell } from './DueCell';
import { formatDateCell } from '../../utils/format';
import { Button } from '../../components/Button';

/** Карточка заказа вместо строки таблицы (мобильный <760px) */
function OrderCardMobileBase({ order, departments, onDelete, canDelete, onShip, onToggleDemo }) {
  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );
  const totalQty = order.items.reduce((s, it) => s + it.qty, 0);
  const progress = orderProgress(order);
  // «Готов к отгрузке» — признак для глаз, его видят все.
  const ready = isOrderReadyToShip(order);
  // А вот РАЗРЕШЕНО ли отгружать — с учётом аварийно снятой проверки:
  // `shipOrder` снятие спрашивает, значит и кнопка обязана.
  const bypasses = useErpStore((s) => s.bypasses);
  const shipAllowed = canShipOrder(order, bypasses);
  /**
   * Готовность и ПРАВО отгрузить — разное. Признак «готов к отгрузке»
   * видят все: цеху полезно знать, что заказ дособран. Кнопку показываем
   * только тем, кому отгрузка разрешена (`onShip` приходит null без права),
   * иначе она отвечала бы отказом стража заказа.
   */
  const canShip = shipAllowed && Boolean(onShip);

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
          <Button variant="ghost" aria-label={`Удалить заказ ${order.title}`} onClick={() => onDelete(order)}>
            <Icon name="x" size={15} />
          </Button>
        )}
      </div>
      <div className={styles.subText}>
        №{order.bitrix_id || '—'}
        {order.manager ? ` · ${order.manager}` : ''} · {totalQty} шт
        {order.created_at ? ` · создан ${formatDateShort(order.created_at)}` : ''}
      </div>
      <div className={styles.orderCardMMeta}>
        {ready ? (
          <span className={`${styles.chip} ${styles.chipReady}`}>
            <Icon name="checkCircle" size={13} /> Готов к отгрузке
          </span>
        ) : (
          <span className={`${styles.chip} ${order.status === 'active' ? styles.chipProgress : styles.chipNeutral}`}>
            {ORDER_STATUS_LABELS[order.status]}
          </span>
        )}
        {order.shipped_at && (
          <span className={styles.subText}>
            отгружен {formatDateCell(order.shipped_at)}
          </span>
        )}
        {hasOpenProcurement(order.procurement_tasks) && (
          <span className={`${styles.chip} ${styles.chipBlocked}`}>
            <Icon name="bell" size={13} /> дозакупка
          </span>
        )}
        {/* Тот же признак, что в десктопной строке: при включённом показе
            демо обязано быть отличимо от боевой работы. */}
        {order.is_demo && (
          <span className={`${styles.chip} ${styles.chipNeutral}`} title="Тестовый заказ — скрыт в обычном режиме">
            тест
          </span>
        )}
        <DueCell dueDate={order.due_date} completedAt={order.shipped_at || order.delivered_at} />
        {progress.total > 0 && (
          <span className={styles.progressCell} aria-label={`Готовность ${progress.pct}%: ${progress.done} из ${progress.total} шт по этапам`}>
            {progress.pct}%
          </span>
        )}
      </div>
      {canShip && (
        <Button variant="primary" className={styles.shipBtn} onClick={() => onShip(order)}>
          <Icon name="truck" size={14} /> Отгрузить
        </Button>
      )}
      {onToggleDemo && (
        <Button variant="ghost" onClick={() => onToggleDemo(order)}>
          <Icon name={order.is_demo ? 'eye' : 'flask'} size={14} />
          {order.is_demo ? ' Вернуть в рабочие' : ' Пометить тестовым'}
        </Button>
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
              {st.status === 'done' && <Icon name="check" size={12} />}
            </span>
          ))}
        </div>
      ))}
    </article>
  );
}

/** Элемент длинного списка: memo отсекает перерисовку при изменениях соседей
    (канбан во время DnD, очередь цеха, таблица заказов). */
export const OrderCardMobile = memo(OrderCardMobileBase);
