import { useState } from 'react';
import { isStageReady, waitingReason, isStageAwaitingProcurement, materialsForItem } from '../../utils/routes';
import { stageMissingTz } from '../../utils/tz';
import { deptShortName } from '../../data/departments';
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
import { RouteEditor } from '../../components/RouteEditor';
import { isOutsourced } from '../../utils/outsourcing';
import { Button } from '../../components/Button';
import { unplannedStages } from '../../utils/stagePlan';
import { pluralize } from '../../../utils/i18n';

/** Блок одной позиции заказа: лента этапов, размерная сетка, нанесения, таблица этапов */
export function OrderItemSection({ item, order, deptById, deptNameById, events, onSavePlan }) {
  // Сколько открытых этапов позиции идут без срока — считает утилита,
  // потому что то же число нужно и на «Загрузке цехов»
  const plan = unplannedStages(item.stages);
  /**
   * Конструктор монтируется ТОЛЬКО открытым и размонтируется при закрытии.
   *
   * Это не экономия рендера: черновик — состояние компонента, посеянное
   * из `item.stages`. Оставь его смонтированным — после сохранения он продолжит
   * показывать прежний черновик поверх перечитанного заказа, и следующая правка
   * ушла бы на сервер от устаревшего состава этапов.
   */
  const [editingRoute, setEditingRoute] = useState(false);

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
      {/*
        Сколько работы позиции идёт БЕЗ срока.
        Плановую дату ставит человек, и до 23.08 её не было ни у одного
        открытого этапа на проде — то есть контроль сроков не работал вовсе,
        а экран об этом молчал: колонка «План» просто показывала прочерки,
        и отличить «не задано» от «не нужно» было нельзя.
      */}
      {plan.unplanned > 0 && (
        <div className={styles.warnBox} role="status">
          Без плановой даты: {plan.unplanned} {pluralize(plan.unplanned, 'этап', 'этапа', 'этапов')}
          {' '}из {plan.total}. Такой этап не попадает ни в просрочку, ни в «Загрузку цехов» —
          срок задаётся в колонке «План» ниже.
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
                  <td>
                    <strong>{dept ? deptShortName(dept.code, dept.name) : '?'}</strong>
                    {/* Подрядный этап подписывается ОПЕРАЦИЕЙ и подрядчиком: цех
                        у него означает «чей это участок ответственности», а человек
                        читает строку, чтобы понять, кто и что сейчас делает */}
                    {isOutsourced(st) && (
                      <div className={styles.subText}>
                        подряд{st.operation ? ` · ${st.operation}` : ''}
                        {st.contractor ? ` · ${st.contractor}` : ''}
                      </div>
                    )}
                  </td>
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
      </ScrollHintBox>

      <div className={styles.routeEditorFoot}>
        <Button
          variant="ghost"
          size="sm"
          icon={editingRoute ? 'chevronUp' : 'route'}
          onClick={() => setEditingRoute((v) => !v)}
          aria-expanded={editingRoute}
        >
          {editingRoute ? 'Свернуть маршрут' : 'Изменить маршрут'}
        </Button>
      </div>
      {editingRoute && (
        <RouteEditor
          item={item}
          orderId={order.id}
          onDone={() => setEditingRoute(false)}
        />
      )}
    </section>
  );
}
