import useWorkshopStore from '../../store/useWorkshopStore';
import { getDeadlineInfo } from '../TaskCard';
import styles from '../TaskDetail.module.css';

export default function TaskDetailHeader({ task, order }) {
  const closeTask = useWorkshopStore(s => s.closeTask);
  const deadline = getDeadlineInfo(task.due_date);

  return (
    <div className={styles.panelHeader}>
      <div className={styles.panelTitle}>
        <span className={styles.orderNum}>{order?.order_number || '—'}</span>
        {deadline && (
          <span className={styles.deadlineBadge} style={{ color: deadline.color, borderColor: deadline.color }}>
            {deadline.label}
          </span>
        )}
      </div>
      <button className={styles.printBtn} onClick={() => window.print()} title="Печать ТЗ">🖨️</button>
      <button className={styles.close} onClick={closeTask} aria-label="Закрыть">✕</button>
    </div>
  );
}
