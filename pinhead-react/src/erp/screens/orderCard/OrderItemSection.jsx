import { isStageReady, waitingReason, isStageAwaitingProcurement, materialsForItem } from '../../utils/routes';
import { stageMissingTz } from '../../utils/tz';
import { deptShortName, isProductionDept } from '../../data/departments';
import { STAGE_CHIP_CLASS } from '../../utils/stageUi';
import {
  STAGE_STATUS_LABELS,
  PRODUCTION_TYPE_LABELS,
  BRANDING_METHOD_LABELS,
} from '../../types';
import { RouteProgress } from '../../components/RouteProgress';
import styles from '../../erp.module.css';
import { StageStepper } from './StageStepper';
import { PlanCell } from './PlanCell';
import { fmtTs } from './format';
import { ScrollHintBox } from '../../components/ScrollHintBox';

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
      {/* Обзор маршрута — точками; штучный прогресс — одной строкой; подробности
          по каждому этапу (план/факт/сделано) — в таблице ниже. Раньше одни и те же
          цех и статус повторялись в трёх представлениях подряд на каждую позицию. */}
      <StageStepper item={item} order={order} deptById={deptById} events={events} />
      <RouteProgress item={item} order={order} deptById={deptById} showStages={false} />

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
        <div className={`${styles.stackTight} ${styles.thumbStubBlock}`}>
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
      <ScrollHintBox className={styles.tableWrap} label="Размерная сетка">
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
              const noTz = stageMissingTz(order, item.id, dept);
              const effReady = st.status === 'waiting' &&
                isStageReady(st, item.stages, materialsForItem(order.materials, item.id),
                  dept, awaitProc, noTz);
              const display = effReady ? 'ready' : st.status;
              const reason = display === 'waiting' || display === 'blocked'
                ? waitingReason(
                    st, item.stages, materialsForItem(order.materials, item.id),
                    deptNameById, dept, awaitProc, noTz)
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
                    {/*
                      M-06 отчёта QA 13.08.2026: у закрытого этапа «Закупка»
                      стоял прочерк в колонке «Сделано» — «Готово» и «—» рядом
                      читаются как потерянные данные. Данных и нет: закупка,
                      как и любой непроизводственный участок, в штуках не
                      считается, и прочерк обязан это СКАЗАТЬ, а не молчать.
                      Разделение по `is_production` — то же, что у канбана
                      и очередей: признак из данных, не константа.
                    */}
                    {st.qty_done > 0 ? `${st.qty_done}` : (
                      <span
                        className={styles.subText}
                        title={isProductionDept(dept)
                          ? 'Изделия по этому этапу ещё не сдавали'
                          : 'Участок не считается в штуках'}
                      >
                        {isProductionDept(dept) ? '—' : 'не в штуках'}
                      </span>
                    )}
                    {st.qty_rework > 0 && (
                      <span className={styles.overdue}> · брак {st.qty_rework}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollHintBox>
    </section>
  );
}
