import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { orderPreviewUrl } from '../../store/useErpStore';
import { OrderLink } from '../OrderLink';
import { orderLinkTarget } from '../../utils/orderLink';
import { daysLeft, formatTimeIn } from '../../utils/time';
/**
 * Агрегатор, а не `erp.module.css` напрямую (правка 03.09): кнопкам переноса
 * нужен `.moveBtn`, объявленный в `screens.module.css`. Прямой импорт одного
 * модуля дал бы `styles.moveBtn === undefined` — класс молча не применился бы,
 * и кнопки поехали бы без вёрстки. Ровно это и поймал `stylesResolve.test.ts`.
 */
import styles from '../../styles';
import { Icon } from '../Icon';
import { dueLabelCompact, formatDayMonth } from '../../utils/format';

/** Цветная точка дедлайна (как в kontora24 DraggableCard) */
function DeadlineDot({ due }) {
  const d = daysLeft(due);
  if (d === null) return null;
  const color = d < 0 ? 'var(--color-error)' : d <= 3 ? 'var(--color-warning)' : 'var(--color-success)';
  const label = dueLabelCompact(d);
  return (
    <span className={styles.kanbanDue} title={label}>
      <span className={styles.kanbanDot} style={{ background: color }} />
      {formatDayMonth(due)}
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
  canMoveDept = false, prevDept = null, nextDept = null, onMoveDept,
}) {
  const { order, item, stage, group } = entry;
  const [imgError, setImgError] = useState(false);
  const preview = orderPreviewUrl(order);
  const navigate = useNavigate();
  const location = useLocation();
  const openOrder = () => navigate(...orderLinkTarget(order.id, location));
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
      onClick={openOrder}
      // Карточку нельзя было ни открыть, ни тронуть с клавиатуры: ни tabIndex,
      // ни onKeyDown. Канбан Order Studio это умеет — здесь был регресс.
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Enter/Space на вложенной ссылке отдаём ей самой
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        openOrder();
      }}
      role="listitem"
      aria-label={`${order.title}: ${item.product_type}, ${item.qty} шт`}
    >
      {/*
        КЛАВИАТУРНЫЙ ПЕРЕНОС МЕЖДУ ЦЕХАМИ (правка 03.09).
        Перенос был доступен ТОЛЬКО перетаскиванием: `moveStageToDepartment`
        имел одного вызывающего — обработчик броска. Менеджер с правом
        `stage.move_department`, работающий с клавиатуры, не мог выполнить
        операцию нигде (WCAG 2.1.1). Кнопки ходят по СОСЕДНИМ цехам — тем же
        приёмом, что «‹ ›» на доске ЭКС и в плане; дальний перенос
        по-прежнему делается перетаскиванием.
      */}
      {canMoveDept && (prevDept || nextDept) && (
        <div className={styles.kanbanCardMove}>
          <button
            type="button"
            className={styles.moveBtn}
            disabled={!prevDept}
            aria-label={prevDept
              ? `Перенести в «${prevDept.name}»: ${order.title}`
              : 'Перенести в предыдущий цех'}
            title={prevDept ? `Перенести в «${prevDept.name}»` : undefined}
            onClick={(e) => { e.stopPropagation(); if (prevDept) onMoveDept?.(prevDept); }}
          >
            <Icon name="arrowLeft" size={14} />
          </button>
          <button
            type="button"
            className={styles.moveBtn}
            disabled={!nextDept}
            aria-label={nextDept
              ? `Перенести в «${nextDept.name}»: ${order.title}`
              : 'Перенести в следующий цех'}
            title={nextDept ? `Перенести в «${nextDept.name}»` : undefined}
            onClick={(e) => { e.stopPropagation(); if (nextDept) onMoveDept?.(nextDept); }}
          >
            <Icon name="arrowRight" size={14} />
          </button>
        </div>
      )}

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
          <div className={styles.orderThumbStub} aria-hidden="true"><Icon name="image" size={18} /></div>
        )}
        <OrderLink
          orderId={order.id}
          draggable={false}
          className={styles.kanbanCardTitle}
          title={order.title}
        >
          {order.title}
        </OrderLink>
        <DeadlineDot due={order.due_date} />
      </div>
      <div className={styles.subText}>
        №{order.bitrix_id || '—'} · {item.product_type}
        {item.variant ? ` · ${item.variant}` : ''}
      </div>
      <div className={styles.kanbanCardFoot}>
        <span className={styles.queueQty}>{item.qty} шт</span>
        {/* Образец экс-цеха (документ 20.08). Пометка нужна и здесь: доска —
            вторая поверхность, где цех видит задание, и «тираж один-два,
            а не сто» относится к ней ровно так же */}
        {stage.origin === 'experimental' && (
          <span
            className={`${styles.chip} ${styles.chipWaiting}`}
            title="Образец из экспериментального цеха — разработка, а не серия"
          >
            ЭКС
          </span>
        )}
        {stage.qty_rework > 0 && (
          <span className={styles.overdue}>брак {stage.qty_rework}</span>
        )}
        {timeIn && (
          <span className={`${styles.subText} ${styles.cellWithIcon}`}>
            <Icon name="clock" size={12} />{timeIn}
          </span>
        )}
        {group === 'blocked' && stage.block_reason && (
          <span className={styles.overdue} title={stage.block_reason}>
            <Icon name="ban" size={13} />
          </span>
        )}
      </div>
    </div>
  );
}
