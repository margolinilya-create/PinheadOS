import { useMemo } from 'react';
import { deptShortName } from '../data/departments';
import { STAGE_STATUS_LABELS } from '../types';
import { isStageAwaitingProcurement, isStageReady, materialsForItem } from '../utils/routes';
import { stageMissingTz } from '../utils/tz';
import { itemProgress, stageQtyProgress } from '../utils/progress';
import { STAGE_CHIP_CLASS } from '../utils/stageUi';
import styles from '../erp.module.css';

/**
 * Маршрут позиции по стадиям с прогрессом в штуках (правка 7):
 *
 *   Раскрой   100/100 — завершено
 *   Швейка     45/100 — в работе
 *   ВТО         0/100 — ожидает
 *
 * Общий процент — по формуле «по штукам через стадии» (utils/progress.itemProgress).
 * Завершённые, текущие и ожидающие стадии различаются чипом состояния и полосой.
 */
export function RouteProgress({
  item, order, deptById, currentStageId = null, compact = false, showStages = true,
}) {
  const total = useMemo(() => itemProgress(item), [item]);

  return (
    <div className={styles.routeProgress}>
      <div className={styles.routeTotal}>
        <span className={styles.routeTotalLabel}>Готовность позиции</span>
        <div className={styles.progressTrack} aria-hidden="true">
          <div className={styles.progressFill} style={{ width: `${total.pct}%` }} />
        </div>
        <span className={styles.progressCell}>{total.pct}%</span>
        {/* Знаменатель — тираж × число этапов маршрута, а не количество изделий:
            подпись «шт» без пояснения читалась как «250 изделий» */}
        <span
          className={styles.subText}
          title={`Сумма по всем этапам маршрута: ${total.done} из ${total.total} шт·этапов`}
        >
          {total.done}/{total.total} шт·этапов
        </span>
      </div>

      {/* В карточке заказа список стадий не рисуем: ниже идёт таблица этапов
          с теми же цехом и статусом плюс план/факт — маршрут показывался трижды
          подряд (степпер точками → шкалы по цехам → таблица) */}
      {showStages && (
      <ol className={styles.routeList}>
        {item.stages.map((stage) => {
          if (stage.status === 'skipped') return null;
          const dept = deptById.get(stage.department_id);
          const awaitProc = isStageAwaitingProcurement(order.procurement_tasks, stage.id);
          // waiting в БД, но зависимости и материалы закрыты → цех уже может начинать
          const effectiveReady =
            stage.status === 'waiting' &&
            isStageReady(stage, item.stages, materialsForItem(order.materials, item.id), dept, awaitProc,
              stageMissingTz(order, item.id, dept));
          const display = effectiveReady ? 'ready' : stage.status;
          const p = stageQtyProgress(stage, item.qty);
          return (
            <li
              key={stage.id}
              className={`${styles.routeRow} ${stage.id === currentStageId ? styles.routeRowCurrent : ''}`}
            >
              <span className={styles.routeName}>
                {dept ? deptShortName(dept.code, dept.name) : '—'}
              </span>
              <span className={styles.routeQty}>{p.done}/{p.total}</span>
              {!compact && (
                <span className={styles.routeBar} aria-hidden="true">
                  <span className={styles.routeBarFill} style={{ width: `${p.pct}%` }} />
                </span>
              )}
              <span className={`${styles.chip} ${styles[STAGE_CHIP_CLASS[display]]}`}>
                {STAGE_STATUS_LABELS[display]}
              </span>
              {stage.assignee && !compact && (
                <span className={styles.subText}>{stage.assignee}</span>
              )}
            </li>
          );
        })}
      </ol>
      )}
    </div>
  );
}
