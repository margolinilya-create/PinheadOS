import { useMemo } from 'react';
import styles from '../AnalyticsView.module.css';

function dayLabel(date) {
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function DailyLoadPanel({ tasks }) {
  const days = useMemo(() => {
    const result = [];
    const now = new Date();
    now.setHours(23, 59, 59, 999);

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dayStr = d.toISOString().split('T')[0];
      const count = tasks.filter(
        t => t.status === 'done' && t.completed_at && t.completed_at.startsWith(dayStr)
      ).length;
      result.push({ label: dayLabel(d), dayStr, count });
    }
    return result;
  }, [tasks]);

  const maxCount = Math.max(1, ...days.map(d => d.count));
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Загрузка по дням</span>
        <span className={styles.panelSub}>Завершённые задачи за 7 дней</span>
      </div>
      <div className={styles.dailyList}>
        {days.map(d => {
          const pct = Math.round((d.count / maxCount) * 100);
          const isToday = d.dayStr === today;
          return (
            <div key={d.dayStr} className={`${styles.dailyRow}${isToday ? ' ' + styles.dailyRowToday : ''}`}>
              <span className={styles.dailyLabel}>{d.label}</span>
              <div className={styles.dailyTrack}>
                <div
                  className={styles.dailyFill}
                  style={{
                    width: `${pct}%`,
                    background: isToday ? 'var(--accent)' : 'var(--color-success)',
                  }}
                />
              </div>
              <span className={styles.dailyCount}>{d.count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
