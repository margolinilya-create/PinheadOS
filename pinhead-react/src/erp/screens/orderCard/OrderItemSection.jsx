import { isStageReady, waitingReason, isStageAwaitingProcurement } from '../../utils/routes';
import { deptShortName } from '../../data/departments';
import { STAGE_CHIP_CLASS } from '../../utils/stageUi';
import {
  STAGE_STATUS_LABELS,
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
import { StageStepper } from './StageStepper';
import { PlanCell } from './PlanCell';
import { fmtTs } from './format';

/** Блок одной позиции заказа: лента этапов, размерная сетка, нанесения, таблица этапов */
export function OrderItemSection({ item, order, deptById, deptNameById, events, onSavePlan }) {
  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>{item.product_type}</strong>
          {item.variant && <span className={styles.subText}> · {item.variant}</span>}
          <span className={styles.subText}> · {PRODUCTION_TYPE_LABELS[item.production_type]}</span>
        </div>
        <span className={styles.queueQty}>{item.qty} шт</span>
      </div>
      <StageStepper item={item} order={order} deptById={deptById} events={events} />

      {item.size_grid && item.size_grid.length > 0 && (
        <div className={styles.tableWrap} style={{ marginBottom: 10, maxWidth: 560 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Цв/Разм</th>
                {[...new Set(item.size_grid.flatMap((r) => Object.keys(r.sizes)))].map((sz) => (
                  <th key={sz}>{sz}</th>
                ))}
                <th>Итог</th>
              </tr>
            </thead>
            <tbody>
              {item.size_grid.map((r, i) => {
                const allSizes = [...new Set(item.size_grid.flatMap((x) => Object.keys(x.sizes)))];
                return (
                  <tr key={i}>
                    <td><strong>{r.color}</strong></td>
                    {allSizes.map((sz) => (
                      <td key={sz} className={styles.progressCell}>{r.sizes[sz] ?? '—'}</td>
                    ))}
                    <td className={styles.progressCell}>
                      <strong>{Object.values(r.sizes).reduce((a, b) => a + b, 0)}</strong>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(item.prints ?? []).length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {[...item.prints].sort((a, b) => a.seq - b.seq).map((p) => (
            <div key={p.id} className={styles.printBlock}>
              <div className={styles.checkRow}>
                <strong>Нанесение №{p.seq} · {BRANDING_METHOD_LABELS[p.method] || p.method}</strong>
                {p.zone && <span>{p.zone}</span>}
                {(p.width_mm || p.height_mm) && (
                  <span className={styles.progressCell}>
                    {p.height_mm ?? '?'}×{p.width_mm ?? '?'} мм
                  </span>
                )}
                {p.pantone && (
                  <span className={`${styles.chip} ${styles.chipNeutral}`}>Pantone {p.pantone}</span>
                )}
              </div>
              {(p.offset_note || p.comment) && (
                <div className={styles.subText}>
                  {[p.offset_note, p.comment].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Этап</th><th>Статус</th><th>План</th><th>Факт</th><th>Сделано</th>
            </tr>
          </thead>
          <tbody>
            {item.stages.map((st) => {
              const dept = deptById.get(st.department_id);
              const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, st.id);
              const effReady = st.status === 'waiting' &&
                isStageReady(st, item.stages, order.materials, dept?.code, awaitProc);
              const display = effReady ? 'ready' : st.status;
              const reason = display === 'waiting' || display === 'blocked'
                ? waitingReason(st, item.stages, order.materials, deptNameById, dept?.code, awaitProc)
                : null;
              return (
                <tr key={st.id}>
                  <td><strong>{dept ? deptShortName(dept.code, dept.name) : '?'}</strong></td>
                  <td>
                    <span className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[display]]}`}>
                      {STAGE_STATUS_LABELS[display]}
                    </span>
                    {reason && <div className={styles.subText}>{reason}</div>}
                  </td>
                  <td>
                    <PlanCell stage={st} onSave={(plan) => onSavePlan(st.id, plan)} />
                  </td>
                  <td className={styles.subText}>
                    {st.started_at || st.finished_at
                      ? `${fmtTs(st.started_at)} → ${fmtTs(st.finished_at)}`
                      : '—'}
                  </td>
                  <td className={styles.progressCell}>
                    {st.qty_done > 0 ? `${st.qty_done}` : '—'}
                    {st.qty_rework > 0 && (
                      <span className={styles.overdue}> · брак {st.qty_rework}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
