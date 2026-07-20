import { daysLeft, formatDateShort } from '../../utils/time';
import styles from '../../erp.module.css';

/** Срок сдачи с подсветкой (просрочен/скоро) и остатком дней */
export function DueCell({ dueDate }) {
  const d = daysLeft(dueDate);
  if (d === null) return <span className={styles.subText}>—</span>;
  const cls = d < 0 ? styles.overdue : d <= 3 ? styles.dueSoon : undefined;
  return (
    <span className={cls}>
      {formatDateShort(dueDate)}
      <span className={styles.subText}> ({d >= 0 ? `${d} дн.` : `просрочен ${-d} дн.`})</span>
    </span>
  );
}
