import { daysLeft, formatDateShort } from '../../utils/time';
import styles from '../../styles';
import { dueLabelCompact } from '../../utils/format';

/**
 * Срок сдачи с подсветкой (просрочен/скоро) и остатком дней.
 * Для завершённого заказа (передан `completedAt` — дата отгрузки/сдачи) срок уже неактуален:
 * показываем просто дату без «просрочен», а «сдан вовремя/заранее» отражает статус-колонка (ERP-03).
 */
export function DueCell({ dueDate, completedAt }) {
  if (completedAt) {
    return <span className={styles.subText}>{formatDateShort(dueDate) || '—'}</span>;
  }
  const d = daysLeft(dueDate);
  if (d === null) return <span className={styles.subText}>—</span>;
  const overdue = d < 0;
  const cls = overdue ? styles.overdue : d <= 3 ? styles.dueSoon : undefined;
  return (
    <span className={cls}>
      {formatDateShort(dueDate)}
      {/* У просрочки хвост наследует красный: .subText задаёт свой color и раньше
          перебивал наследование — самая важная часть оставалась приглушённой */}
      <span className={overdue ? undefined : styles.subText}>
        {' '}({dueLabelCompact(d)})
      </span>
    </span>
  );
}
