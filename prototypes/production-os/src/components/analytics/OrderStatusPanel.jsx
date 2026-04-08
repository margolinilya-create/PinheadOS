import { useMemo } from 'react';
import styles from '../AnalyticsView.module.css';

export default function OrderStatusPanel({ tasks, orders }) {
  const stats = useMemo(() => {
    const orderIds = Object.keys(orders);
    let fullyDone = 0;
    let inProgress = 0;
    let hasBlocked = 0;
    let notStarted = 0;

    for (const oid of orderIds) {
      const orderTasks = tasks.filter(t => t.order_id === oid);
      if (!orderTasks.length) continue;

      const allDone = orderTasks.every(t => t.status === 'done');
      const anyBlocked = orderTasks.some(t => t.status === 'blocked');
      const anyActive = orderTasks.some(t => t.status === 'in_progress' || t.status === 'ready');
      const allPending = orderTasks.every(t => t.status === 'pending');

      if (allDone) fullyDone++;
      else if (anyBlocked) hasBlocked++;
      else if (anyActive || orderTasks.some(t => t.status === 'done')) inProgress++;
      else if (allPending) notStarted++;
      else inProgress++;
    }

    return { fullyDone, inProgress, hasBlocked, notStarted, total: orderIds.length };
  }, [tasks, orders]);

  const cards = [
    { label: 'Завершены', value: stats.fullyDone, color: 'var(--color-success)', bg: '#F0FFF4' },
    { label: 'В работе', value: stats.inProgress, color: 'var(--color-warning)', bg: '#FFFBEA' },
    { label: 'Заблокированы', value: stats.hasBlocked, color: 'var(--color-error)', bg: '#FFF1F0' },
    { label: 'Не начаты', value: stats.notStarted, color: 'var(--text-dim)', bg: 'var(--bg3)' },
  ];

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Статус заказов</span>
        <span className={styles.panelSub}>{stats.total} заказов в производстве</span>
      </div>
      <div className={styles.statRow}>
        {cards.map(c => (
          <div key={c.label} className={styles.statCard} style={{ background: c.bg, borderColor: c.color + '44' }}>
            <span className={styles.statValue} style={{ color: c.color }}>{c.value}</span>
            <span className={styles.statLabel}>{c.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
