import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderPreviewUrl } from '../../store/useErpStore';
import { orderLinkClick, useOrderDrawer } from '../../store/useOrderDrawer';
import { daysLeft, formatTimeIn } from '../../utils/time';
import styles from '../../erp.module.css';

/** Цветная точка дедлайна (как в kontora24 DraggableCard) */
function DeadlineDot({ due }) {
  const d = daysLeft(due);
  if (d === null) return null;
  const color = d < 0 ? 'var(--color-error)' : d <= 3 ? 'var(--color-warning)' : 'var(--color-success)';
  const label = d < 0 ? `просрочен ${-d} дн` : `${d} дн до срока`;
  return (
    <span className={styles.kanbanDue} title={label}>
      <span className={styles.kanbanDot} style={{ background: color }} />
      {due && new Date(due + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
    </span>
  );
}

/**
 * Карточка канбана: этап позиции заказа.
 * Перетаскивается вертикально (приоритет), между дорожками (статус) и в другую
 * колонку (перенос в другой цех) — обработку жестов держит ErpKanban.
 */
export function KanbanCard({
  entry, onDragStart, onDragEnd, onDragOverCard, dragging, dropBefore, dropAfter,
}) {
  const { order, item, stage, group } = entry;
  const [imgError, setImgError] = useState(false);
  const preview = orderPreviewUrl(order);
  const timeIn = group === 'in_progress'
    ? formatTimeIn(stage.started_at)
    : formatTimeIn(stage.updated_at);

  return (
    <div
      className={[
        styles.kanbanCard,
        dragging && styles.kanbanCardDragging,
        group === 'blocked' && styles.kanbanCardBlocked,
        dropBefore && styles.queueRowDropBefore,
        dropAfter && styles.queueRowDropAfter,
      ].filter(Boolean).join(' ')}
      draggable={group !== 'blocked'}
      onDragStart={(e) => onDragStart(e, entry)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => onDragOverCard?.(e, entry)}
      onClick={() => useOrderDrawer.getState().open(order.id)}
      // Карточку нельзя было ни открыть, ни тронуть с клавиатуры: ни tabIndex,
      // ни onKeyDown. Канбан Order Studio это умеет — здесь был регресс.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Enter/Space на вложенной ссылке отдаём ей самой
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        useOrderDrawer.getState().open(order.id);
      }}
      role="listitem"
      aria-label={`${order.title}: ${item.product_type}, ${item.qty} шт`}
    >
      <div className={styles.kanbanCardHead}>
        {preview && !imgError && (
          <img
            src={preview}
            alt={`Макет: ${order.title}`}
            className={styles.orderThumb}
            draggable={false}
            onError={() => setImgError(true)}
          />
        )}
        {preview && imgError && (
          <div className={styles.orderThumbStub} aria-hidden="true">🖼</div>
        )}
        <Link
          to={`/orders/${order.id}`}
          onClick={(e) => orderLinkClick(order.id, e)}
          draggable={false}
          className={styles.kanbanCardTitle}
          title={order.title}
        >
          {order.title}
        </Link>
        <DeadlineDot due={order.due_date} />
      </div>
      <div className={styles.subText}>
        №{order.bitrix_id || '—'} · {item.product_type}
        {item.variant ? ` · ${item.variant}` : ''}
      </div>
      <div className={styles.kanbanCardFoot}>
        <span className={styles.queueQty}>{item.qty} шт</span>
        {stage.qty_rework > 0 && (
          <span className={styles.overdue}>брак {stage.qty_rework}</span>
        )}
        {timeIn && <span className={styles.subText}>⏱ {timeIn}</span>}
        {group === 'blocked' && stage.block_reason && (
          <span className={styles.overdue} title={stage.block_reason}>🚫</span>
        )}
      </div>
    </div>
  );
}
