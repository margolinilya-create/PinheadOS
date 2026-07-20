import { useState } from 'react';
import styles from '../../erp.module.css';
import { fmt } from './format';

/** Ячейка плановых дат этапа: кнопка «задать план…» → два date-инпута */
export function PlanCell({ stage, onSave }) {
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState(stage.planned_start || '');
  const [end, setEnd] = useState(stage.planned_end || '');

  if (!editing) {
    const overdueEnd =
      stage.planned_end && stage.status !== 'done' &&
      stage.planned_end < new Date().toISOString().slice(0, 10);
    return (
      <button
        type="button"
        className={styles.planBtn}
        title="Задать плановые даты"
        onClick={() => setEditing(true)}
      >
        {stage.planned_start || stage.planned_end ? (
          <span className={overdueEnd ? styles.overdue : undefined}>
            {fmt(stage.planned_start)} → {fmt(stage.planned_end)}
          </span>
        ) : (
          <span className={styles.subText}>задать план…</span>
        )}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      <input type="date" className={styles.input} style={{ minHeight: 30, padding: '2px 6px' }}
        value={start} onChange={(e) => setStart(e.target.value)} aria-label="План: начало" />
      <input type="date" className={styles.input} style={{ minHeight: 30, padding: '2px 6px' }}
        value={end} onChange={(e) => setEnd(e.target.value)} aria-label="План: конец" />
      <button type="button" className="btn btn-primary" style={{ padding: '2px 10px' }}
        onClick={async () => {
          await onSave({ planned_start: start || null, planned_end: end || null });
          setEditing(false);
        }}>
        ✓
      </button>
      <button type="button" className="btn btn-ghost" style={{ padding: '2px 8px' }}
        onClick={() => setEditing(false)}>✕</button>
    </span>
  );
}
