import { useMemo } from 'react';
import { WORKSHOPS } from '../../data/workshops';
import styles from '../AnalyticsView.module.css';

export default function ThroughputPanel({ tasks }) {
  const counts = useMemo(() => {
    const map = {};
    for (const ws of WORKSHOPS) map[ws.code] = 0;
    for (const t of tasks) {
      if (t.status === 'done') map[t.workshop_code] = (map[t.workshop_code] || 0) + 1;
    }
    return map;
  }, [tasks]);

  const maxCount = Math.max(1, ...Object.values(counts));

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Пропускная способность</span>
        <span className={styles.panelSub}>Завершённые задачи по цехам</span>
      </div>
      <div className={styles.barList}>
        {WORKSHOPS.map(ws => {
          const count = counts[ws.code] || 0;
          const pct = Math.round((count / maxCount) * 100);
          return (
            <div key={ws.code} className={styles.barRow}>
              <div className={styles.barLabel}>
                <span className={styles.barIcon}>{ws.icon}</span>
                <span className={styles.barName}>{ws.name}</span>
              </div>
              <div className={styles.barTrack}>
                <div
                  className={styles.barFill}
                  style={{ width: `${pct}%`, background: ws.color }}
                />
              </div>
              <span className={styles.barCount}>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
