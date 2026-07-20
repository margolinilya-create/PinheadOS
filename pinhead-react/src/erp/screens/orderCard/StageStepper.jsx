import { useMemo } from 'react';
import { isStageReady, isStageAwaitingProcurement } from '../../utils/routes';
import { deptShortName } from '../../data/departments';
import { STAGE_STATUS_LABELS } from '../../types';
import styles from '../../erp.module.css';
import { fmtTs } from './format';

/** Тонкая лента этапов позиции (паттерн kontora24 OrderStepper) */
export function StageStepper({ item, order, deptById, events }) {
  const lastEventByStage = useMemo(() => {
    const m = new Map();
    for (const ev of events ?? []) {
      if (!m.has(ev.stage_id)) m.set(ev.stage_id, ev); // events отсортированы desc
    }
    return m;
  }, [events]);

  return (
    <div className={styles.stepper} role="list" aria-label="Лента этапов">
      {item.stages.map((st, i) => {
        const dept = deptById.get(st.department_id);
        const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, st.id);
        const effReady = st.status === 'waiting' &&
          isStageReady(st, item.stages, order.materials, dept?.code, awaitProc);
        const display = effReady ? 'ready' : st.status;
        const ev = lastEventByStage.get(st.id);
        const tooltip = [
          dept?.name,
          STAGE_STATUS_LABELS[display],
          st.finished_at && `завершён ${fmtTs(st.finished_at)}`,
          ev?.actor && `последний: ${ev.actor}`,
        ].filter(Boolean).join(' · ');
        const dotCls = [
          styles.stepperDot,
          display === 'done' && styles.stepperDotDone,
          (display === 'in_progress' || display === 'ready') && styles.stepperDotActive,
          display === 'blocked' && styles.stepperDotBlocked,
        ].filter(Boolean).join(' ');
        return (
          <span key={st.id} className={styles.stepperItem} role="listitem">
            {i > 0 && (
              <span className={`${styles.stepperLine} ${st.status === 'done' ? styles.stepperLineDone : ''}`} />
            )}
            <span className={dotCls} title={tooltip} aria-label={tooltip}>
              {display === 'done' ? '✓' : i + 1}
            </span>
            <span className={styles.stepperLabel}>
              {dept ? deptShortName(dept.code, dept.name) : '?'}
            </span>
          </span>
        );
      })}
    </div>
  );
}
