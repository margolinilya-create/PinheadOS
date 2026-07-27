import { useState } from 'react';
import { Link } from 'react-router-dom';
import { orderLinkClick } from '../../store/useOrderDrawer';
import { daysLeft, formatDateShort, stageOverdue } from '../../utils/time';
import { stageQtyProgress } from '../../utils/progress';
import { STAGE_STATUS_LABELS } from '../../types';
import { STAGE_CHIP_CLASS } from '../../utils/stageUi';
import { stageTzDocument } from '../../utils/tz';
import styles from '../../erp.module.css';
import { StageActionsPanel } from './StageActionsPanel';

/**
 * Компактная строка рабочей очереди цеха (правка 2) — вместо крупной карточки.
 * Показывает приоритет, № и название заказа, изделие/вариант, количество, срок
 * и просрочку, статус, причину блокировки, исполнителя и процент готовности.
 *
 * Красным выделяется только просрочка/проблема (чип и колонка срока), а не вся
 * строка — правило docs/DESIGN.md. Развёрнутая строка показывает ТЗ и действия.
 */
export function QueueRow({
  entry, index, canAct, canReorder, rework, deptShortById, actions,
  dragging, dropBefore, dropAfter,
  onDragStart, onDragEnd, onDragOverRow,
}) {
  const { order, item, stage, reason, group } = entry;
  const [open, setOpen] = useState(false);
  const d = daysLeft(order.due_date);
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const needsAck = overdue && !stage.overdue_ack_at;
  const progress = stageQtyProgress(stage, item.qty);
  const display = group === 'ready' ? 'ready' : stage.status;
  // Индикатор ТЗ: сначала реальный PDF цеха (волна 4), иначе структурное ТЗ позиции
  const tzDoc = stageTzDocument(order, item.id, stage.department_id);
  const hasTz = (item.prints ?? []).length > 0 || (item.size_grid ?? []).length > 0;

  return (
    <div
      className={[
        styles.queueRow,
        dragging && styles.queueRowDragging,
        dropBefore && styles.queueRowDropBefore,
        dropAfter && styles.queueRowDropAfter,
      ].filter(Boolean).join(' ')}
      draggable={canReorder}
      onDragStart={(e) => canReorder && onDragStart(e, entry)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => canReorder && onDragOverRow(e, entry)}
    >
      <div className={styles.queueRowMain}>
        <span
          className={styles.queueRowPriority}
          title={canReorder ? 'Перетащите, чтобы изменить приоритет' : 'Приоритет в очереди'}
          aria-label={`Приоритет ${index + 1}`}
        >
          {canReorder && <span className={styles.dragHandle} aria-hidden="true">⠿</span>}
          {index + 1}
        </span>

        <span className={styles.queueRowTitle}>
          <Link
            to={`/orders/${order.id}`}
            onClick={(e) => orderLinkClick(order.id, e)}
            className={styles.queueCardTitleLink}
            title={`Открыть заказ №${order.bitrix_id || '—'}`}
            draggable={false}
          >
            №{order.bitrix_id || '—'} · {order.title}
          </Link>
          <span className={styles.subText}>
            {item.product_type}{item.variant ? ` · ${item.variant}` : ''}
            {order.customer ? ` · ${order.customer}` : ''}
          </span>
        </span>

        <span className={styles.queueRowQty}>{item.qty} шт</span>

        <span className={styles.queueRowDue}>
          {order.due_date ? formatDateShort(order.due_date) : '—'}
          {d !== null && (
            <span className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
              {d >= 0 ? ` · ${d} дн.` : ` · просрочен ${-d} дн.`}
            </span>
          )}
        </span>

        <span className={styles.queueRowStatus}>
          <span className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[display]]}`}>
            {STAGE_STATUS_LABELS[display]}
          </span>
          {overdue && <span className={`${styles.chip} ${styles.chipBlocked}`}>⏰ просрочен этап</span>}
          {tzDoc ? (
            <span
              className={styles.subText}
              title={`ТЗ: ${tzDoc.file_name || 'файл'}${tzDoc.version > 1 ? `, версия ${tzDoc.version}` : ''}`}
            >
              📄
            </span>
          ) : hasTz && (
            <span className={styles.subText} title="Есть ТЗ позиции">📋</span>
          )}
        </span>

        <span className={styles.queueRowAssignee} title="Исполнитель">
          {stage.assignee || <span className={styles.subText}>не закреплено</span>}
        </span>

        <span className={styles.queueRowProgress} title={`Сделано ${progress.done} из ${progress.total} шт`}>
          <span className={styles.progressTrack} aria-hidden="true">
            <span className={styles.progressFill} style={{ width: `${progress.pct}%` }} />
          </span>
          <span className={styles.progressCell}>{progress.pct}%</span>
        </span>

        <span className={styles.queueRowActions}>
          <Link to={`/task/${stage.id}`} className="btn btn-ghost" draggable={false}>
            Открыть
          </Link>
          <button
            type="button"
            className="btn btn-secondary"
            aria-expanded={open}
            aria-label={open ? 'Свернуть задание' : 'Развернуть задание'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? '▲' : '▼'}
          </button>
        </span>
      </div>

      {(reason || (group === 'blocked' && stage.block_reason) || rework || needsAck) && (
        <div className={styles.queueRowNotes}>
          {reason && <span className={styles.queueReason}>⏳ {reason}</span>}
          {group === 'blocked' && stage.block_reason && (
            <span className={`${styles.queueReason} ${styles.overdue}`}>🚫 {stage.block_reason}</span>
          )}
          {rework && (
            <span className={styles.queueReason}>
              ↩ На переделку: {rework.qty_rework} шт · {(rework.comment || '').replace(' (фото во вложениях)', '')}
            </span>
          )}
          {needsAck && canAct && (
            <span className={styles.overdue}>⏰ Этап просрочен — нужен комментарий (разверните строку)</span>
          )}
        </div>
      )}

      {open && (
        <div className={styles.queueRowPanel}>
          <StageActionsPanel
            entry={entry}
            canAct={canAct}
            deptShortById={deptShortById}
            actions={actions}
          />
        </div>
      )}
    </div>
  );
}
