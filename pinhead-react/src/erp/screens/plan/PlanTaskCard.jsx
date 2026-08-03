import { Link } from 'react-router-dom';
import { orderLinkClick } from '../../store/useOrderDrawer';
import { Icon } from '../../components/Icon';
import { itemTzDocument } from '../../utils/tz';
import { tzFileUrl } from '../../utils/tzFile';
import { daysLeft, formatDateShort } from '../../utils/time';
import {
  PLAN_STATE_CHIP, PLAN_STATE_LABELS, planCardState, planOverdue, planRemaining,
} from '../../utils/planCard';
import styles from '../../erp.module.css';

/**
 * Карточка задачи производственного плана.
 *
 * Показывает всё, что перечислено в требовании 5.6, чтобы руководителю не нужно
 * было открывать заказ ради «сколько сегодня и сколько сделали»: заказ и сделка,
 * заказчик, изделие и вариант, этап и цех, общее количество, план на день, факт,
 * остаток, брак, приоритет, срок и дни до него, готовность материалов, статус,
 * проблема, комментарии и ссылка на единое ТЗ позиции.
 *
 * Цвет — дополнительный сигнал: текстовый статус стоит рядом с ним всегда
 * (правило доступности проекта и прямое требование заказчика).
 */
export function PlanTaskCard({
  slot, ctx, today, commentsCount = 0, unread = false,
  draggable = false, onDragStart, onDragEnd, onOpen,
}) {
  const { order, item, stage, dept, awaitingMaterials } = ctx ?? {};
  const state = planCardState(slot, today, awaitingMaterials);
  const overdue = planOverdue(slot, today);
  const remaining = planRemaining(slot);
  const due = order?.due_date ?? null;
  const d = daysLeft(due);
  const tzDoc = order && item ? itemTzDocument(order, item.id) : null;

  return (
    <article
      className={`${styles.planCard} ${styles[`planCard_${state}`] || ''}`}
      draggable={draggable}
      onDragStart={(e) => onDragStart?.(e, slot)}
      onDragEnd={onDragEnd}
      aria-label={`${order?.title || 'Задача'} — ${PLAN_STATE_LABELS[state]}`}
    >
      <header className={styles.planCardHead}>
        <span className={styles.planCardTitle}>
          {order ? (
            <Link
              to={`/orders/${order.id}`}
              onClick={(e) => orderLinkClick(order.id, e)}
              className={styles.queueCardTitleLink}
              draggable={false}
            >
              №{order.bitrix_id || '—'} · {order.title}
            </Link>
          ) : 'Задача плана'}
        </span>
        {slot.priority > 0 && (
          <span className={`${styles.chip} ${styles.chipDanger}`} title="Повышенный приоритет">
            <Icon name="alert" size={12} /> приоритет
          </span>
        )}
      </header>

      <div className={styles.subText}>
        {[
          order?.customer,
          item ? [item.product_type, item.variant].filter(Boolean).join(' ') : null,
          item ? `${item.qty} шт по этапу` : null,
          dept?.name,
        ].filter(Boolean).join(' · ')}
      </div>

      {/* План / факт / остаток — то, ради чего экран и существует */}
      <div className={styles.planFigures}>
        <span><b>{slot.qty_planned}</b> план</span>
        <span><b>{slot.qty_done ?? 0}</b> факт</span>
        <span className={remaining > 0 ? styles.planRemain : undefined}>
          <b>{remaining}</b> остаток
        </span>
        {slot.qty_defect > 0 && (
          <span className={styles.overdue}><b>{slot.qty_defect}</b> брак</span>
        )}
      </div>

      <div className={styles.planCardFoot}>
        {/* Цвет дублируется текстом: состояние должно читаться и без цвета */}
        <span className={`${styles.chip} ${styles[PLAN_STATE_CHIP[state]]}`}>
          {PLAN_STATE_LABELS[state]}
        </span>
        {overdue && state !== 'overdue' && (
          <span className={`${styles.chip} ${styles.chipBlocked}`}>
            <Icon name="clock" size={12} /> просрочено
          </span>
        )}
        {slot.problem_type && (
          <span className={`${styles.chip} ${styles.chipBlocked}`} title={slot.problem_note || ''}>
            <Icon name="alert" size={12} /> проблема
          </span>
        )}
        {due && (
          <span className={d !== null && d < 0 ? styles.overdue : styles.subText}>
            срок {formatDateShort(due)}
            {d !== null && (d >= 0 ? ` · ${d} дн.` : ` · просрочен ${-d} дн.`)}
          </span>
        )}
        {tzDoc && (
          <a
            href={tzFileUrl(tzDoc.file_path)}
            target="_blank"
            rel="noreferrer"
            className={styles.subText}
            title={`ТЗ: ${tzDoc.file_name || 'файл'}`}
            draggable={false}
          >
            <span className={styles.cellWithIcon}><Icon name="file" size={13} /> ТЗ</span>
          </a>
        )}
        {commentsCount > 0 && (
          // Значок с числом: руководитель не должен открывать каждую карточку,
          // чтобы понять, где появилась новая информация
          <span
            className={unread ? `${styles.chip} ${styles.chipInfo}` : styles.subText}
            title={unread ? 'Есть непрочитанное' : 'Комментарии'}
          >
            <span className={styles.cellWithIcon}>
              <Icon name="tag" size={13} />{commentsCount}{unread ? ' новое' : ''}
            </span>
          </span>
        )}
      </div>

      {slot.comment && (
        <div className={styles.subText}>
          <span className={styles.cellWithIcon}><Icon name="user" size={13} />{slot.comment}</span>
        </div>
      )}
      {slot.fact_comment && (
        <div className={styles.subText}>
          <span className={styles.cellWithIcon}><Icon name="needle" size={13} />{slot.fact_comment}</span>
        </div>
      )}

      <div className={styles.planCardActions}>
        {stage && (
          <Link to={`/task/${stage.id}`} className="btn btn-ghost" draggable={false}>
            Задание
          </Link>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => onOpen?.(slot)}>
          Открыть
        </button>
      </div>
    </article>
  );
}
