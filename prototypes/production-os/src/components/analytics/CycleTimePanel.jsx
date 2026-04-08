import { useMemo } from 'react';
import { WORKSHOPS } from '../../data/workshops';
import styles from '../AnalyticsView.module.css';

function formatDuration(ms) {
  if (!ms || ms <= 0) return '—';
  const totalMinutes = Math.round(ms / 60000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}м`;
  if (m === 0) return `${h}ч`;
  return `${h}ч ${m}м`;
}

export default function CycleTimePanel({ tasks }) {
  const rows = useMemo(() => {
    const result = [];
    for (const ws of WORKSHOPS) {
      const doneTasks = tasks.filter(
        t => t.workshop_code === ws.code &&
          t.status === 'done' &&
          t.started_at &&
          t.completed_at
      );
      if (!doneTasks.length) continue;
      const totalMs = doneTasks.reduce((sum, t) => {
        return sum + (new Date(t.completed_at) - new Date(t.started_at));
      }, 0);
      const avgMs = totalMs / doneTasks.length;
      result.push({ ws, avgMs, count: doneTasks.length });
    }
    return result;
  }, [tasks]);

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <span className={styles.panelTitle}>Средний цикл</span>
        <span className={styles.panelSub}>Время от начала до завершения</span>
      </div>
      {rows.length === 0 ? (
        <div className={styles.empty}>Нет завершённых задач с временными метками</div>
      ) : (
        <table className={styles.cycleTable}>
          <tbody>
            {rows.map(({ ws, avgMs, count }) => (
              <tr key={ws.code} className={styles.cycleRow}>
                <td className={styles.cycleWs}>
                  <span className={styles.cycleDot} style={{ background: ws.color }} />
                  {ws.name}
                </td>
                <td className={styles.cycleTime}>{formatDuration(avgMs)}</td>
                <td className={styles.cycleCount}>{count} задач</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
