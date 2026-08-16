import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { orderPreviewUrl, lastDefectPhotoUrl } from '../../store/useErpStore';
import { OrderLink } from '../../components/OrderLink';
import { daysLeft, formatDateShort, stageOverdue } from '../../utils/time';
import styles from '../../erp.module.css';
import { Icon } from '../../components/Icon';
import { Lightbox } from './Lightbox';
import { StageActionsPanel } from './StageActionsPanel';
import { MaterialWait } from './MaterialWait';
import { dueLabelCompact } from '../../utils/format';
import { ButtonLink } from '../../components/Button';

/**
 * Карточка задания — мобильный вид очереди цеха (<760px), где строка не помещается.
 * Действия и формы общие со строкой и страницей задания (StageActionsPanel).
 */
export function QueueCard({ entry, perms, rework, deptShortById, actions }) {
  const location = useLocation();
  const { order, item, stage, reason, group, missingMaterials } = entry;
  const overdue = stageOverdue(stage.planned_end, stage.status);
  const reworkPhoto = rework ? lastDefectPhotoUrl(order) : null;
  const qtyDone = stage.qty_done ?? 0;
  const [zoom, setZoom] = useState(false);
  const [imgError, setImgError] = useState(false);
  const d = daysLeft(order.due_date);
  const preview = orderPreviewUrl(order);
  const cardCls = [
    styles.queueCard,
    group === 'ready' && styles.queueCardReady,
    group === 'in_progress' && styles.queueCardProgress,
    group === 'blocked' && styles.queueCardBlocked,
    ((d !== null && d < 0) || overdue) && styles.queueCardUrgent,
  ].filter(Boolean).join(' ');

  return (
    <div className={cardCls}>
      <div className={styles.queueCardHead}>
        {preview && !imgError && (
          <button
            type="button"
            className={styles.queueThumbBtn}
            aria-label={`Открыть превью макета: ${order.title}`}
            onClick={() => setZoom(true)}
          >
            <img
              src={preview}
              alt=""
              className={styles.queueThumb}
              onError={() => setImgError(true)}
            />
          </button>
        )}
        {preview && imgError && (
          <div className={styles.queueThumbStub} aria-hidden="true"><Icon name="image" size={20} /></div>
        )}
        <div className={styles.queueCardHeadText}>
          <OrderLink
            orderId={order.id}
            className={`${styles.queueCardTitle} ${styles.queueCardTitleLink}`}
            title={`№${order.bitrix_id || '—'} · ${order.title}`}
          >
            №{order.bitrix_id || '—'} · {order.title}
          </OrderLink>
          <div
            className={styles.subText}
            title={[item.product_type, item.variant, order.customer].filter(Boolean).join(' · ')}
          >
            {item.product_type}
            {item.variant ? ` · ${item.variant}` : ''}
            {order.customer ? ` · ${order.customer}` : ''}
          </div>
        </div>
        <div className={styles.queueDue}>
          <div className={styles.queueQty}>{item.qty} шт</div>
          {order.due_date && (
            <div className={d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : styles.subText}>
              до {formatDateShort(order.due_date)}
              {d !== null && ` · ${dueLabelCompact(d)}`}
            </div>
          )}
        </div>
      </div>

      {zoom && preview && !imgError && (
        <Lightbox src={preview} alt={`Макет: ${order.title}`} onClose={() => setZoom(false)} />
      )}

      {group === 'awaiting_materials' && <MaterialWait materials={missingMaterials} />}
      {reason && group !== 'awaiting_materials' && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}><Icon name="clock" size={14} />{reason}</span>
        </div>
      )}
      {stage.status === 'blocked' && stage.block_reason && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}><Icon name="ban" size={14} />{stage.block_reason}</span>
        </div>
      )}
      {overdue && stage.overdue_ack_at && stage.overdue_comment && (
        <div className={styles.subText}>
          <span className={styles.cellWithIcon}>
            <Icon name="clock" size={13} />Просрочка: {stage.overdue_comment}
          </span>
        </div>
      )}
      {stage.assignee && (
        <div className={styles.subText}>
          <span className={styles.cellWithIcon}><Icon name="user" size={13} />{stage.assignee}</span>
        </div>
      )}
      {rework && (
        <div className={styles.queueReason}>
          <span className={styles.cellWithIcon}>
            <Icon name="undo" size={14} />
            На переделку: {rework.qty_rework} шт · {(rework.comment || '').replace(' (фото во вложениях)', '')}
          </span>
          {reworkPhoto && (
            <>
              {' · '}
              <a href={reworkPhoto} target="_blank" rel="noreferrer">
                <span className={styles.cellWithIcon}><Icon name="image" size={13} />фото</span>
              </a>
            </>
          )}
        </div>
      )}

      {group === 'in_progress' && qtyDone > 0 && (
        <div className={styles.progressLine} aria-label={`Сделано ${qtyDone} из ${item.qty}`}>
          <div className={styles.progressTrack}>
            <div
              className={styles.progressFill}
              style={{ width: `${Math.min(Math.round((qtyDone / item.qty) * 100), 100)}%` }}
            />
          </div>
          <span className={styles.progressCell}>{qtyDone}/{item.qty}</span>
        </div>
      )}

      <ButtonLink
        to={`/task/${stage.id}`}
        state={{ from: `${location.pathname}${location.search}` }}
        variant="ghost"
      >
        Открыть задание ↗
      </ButtonLink>

      <StageActionsPanel
        entry={entry}
        perms={perms}
        deptShortById={deptShortById}
        actions={actions}
      />
    </div>
  );
}
