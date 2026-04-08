import { useTasksByOrder } from '../store/useWorkshopStore';
import { WORKSHOP_MAP } from '../data/workshops';
import styles from './OrderTimeline.module.css';

const STATUS_ICONS = {
  done:        '✓',
  in_progress: '▶',
  ready:       '●',
  pending:     '⏳',
  blocked:     '⚠',
};

const STATUS_COLORS = {
  pending:     'var(--status-pending)',
  ready:       'var(--status-ready)',
  in_progress: 'var(--status-in-progress)',
  done:        'var(--status-done)',
  blocked:     'var(--status-blocked)',
};

export default function OrderTimeline({ orderId, currentTaskId, compact = false }) {
  const tasks = useTasksByOrder(orderId);

  if (!tasks.length) return null;

  return (
    <div className={`${styles.timeline}${compact ? ' ' + styles.timelineCompact : ''}`}>
      {tasks.map((task, idx) => {
        const ws = WORKSHOP_MAP[task.workshop_code];
        const isCurrent = task.id === currentTaskId;
        const color = STATUS_COLORS[task.status] || 'var(--status-pending)';
        const icon = STATUS_ICONS[task.status] || '⏳';
        const wsName = ws ? ws.name : task.workshop_code;
        const statusClass = task.status === 'pending' ? styles.stepPending
          : task.status === 'ready' ? styles.stepReady : '';

        return (
          <div key={task.id} className={styles.stepWrap}>
            <div
              className={`${styles.step}${isCurrent ? ' ' + styles.stepCurrent : ''}${statusClass ? ' ' + statusClass : ''}`}
              style={{ '--step-color': color }}
              title={compact ? `${wsName}: ${task.status}` : undefined}
            >
              {!compact && (
                <>
                  <span className={styles.stepIcon}>{icon}</span>
                  <span className={styles.stepName}>{wsName}</span>
                </>
              )}
            </div>
            {idx < tasks.length - 1 && (
              <div className={styles.connector} />
            )}
          </div>
        );
      })}
    </div>
  );
}
