import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { deptShortName } from '../data/departments';
import { buildKanbanColumns } from '../utils/kanbanColumns';
import styles from '../erp.module.css';
import { KanbanCard } from './kanban/KanbanCard';
import { useTouchDndPolyfill } from './kanban/useTouchDndPolyfill';

/**
 * Канбан цехов (механика kontora24, движок — наш HTML5 DnD как в Order Studio).
 * Колонка = цех, карточка = этап позиции. Drag ВНУТРИ колонки меняет статус
 * (готов → в работе → готово); между цехами не таскаем — маршрут решает граф.
 *
 * Тач-устройства: HTML5 DnD не работает на touch — на pointer:coarse лениво
 * подгружается полифилл mobile-drag-drop (~10KB), десктоп его не грузит.
 * Группировка этапов по цехам/дорожкам — в utils/kanbanColumns (покрыта тестами).
 */

const LANE_TITLES = {
  ready: 'Готово к работе',
  in_progress: 'В работе',
  done: 'Завершено',
};

/** Куда карточку можно уронить из её текущей группы */
const ALLOWED_DROP = {
  ready: ['in_progress'],
  in_progress: ['done'],
};

export default function ErpKanban() {
  const { orders, departments, setStageStatus } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      setStageStatus: s.setStageStatus,
    })),
  );
  const [drag, setDrag] = useState(null); // { entry, deptId }
  const [overLane, setOverLane] = useState(null); // `${deptId}:${lane}`
  useTouchDndPolyfill();

  const columns = useMemo(
    () => buildKanbanColumns(orders, departments),
    [orders, departments],
  );

  const onDragStart = (e, entry) => {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', entry.stage.id); } catch { /* IE */ }
    setDrag({ entry, deptId: entry.stage.department_id });
  };
  const onDragEnd = () => { setDrag(null); setOverLane(null); };

  const laneDroppable = (deptId, lane) =>
    drag &&
    drag.deptId === deptId &&
    (ALLOWED_DROP[drag.entry.group] || []).includes(lane);

  const onDrop = async (deptId, lane) => {
    if (!drag || !laneDroppable(deptId, lane)) return;
    const { entry } = drag;
    setDrag(null); setOverLane(null);
    if (lane === 'in_progress') await setStageStatus(entry.stage.id, 'in_progress');
    if (lane === 'done') {
      await setStageStatus(entry.stage.id, 'done', { qty_done: entry.item.qty });
    }
  };

  return (
    <div className={styles.kanbanBoard} role="list" aria-label="Канбан по цехам">
      {columns.map(({ dept, ready, in_progress, blocked, done }) => (
        <section key={dept.id} className={styles.kanbanCol}>
          <header className={styles.kanbanColHead}>
            {deptShortName(dept.code, dept.name)}
            {/* Бейдж = все видимые карточки колонки (ready+blocked+in_progress+done), ERP-05 */}
            <span className={styles.deptTabCount}>{ready.length + blocked.length + in_progress.length + done.length}</span>
          </header>

          {['ready', 'in_progress', 'done'].map((lane) => {
            const list = lane === 'ready' ? [...ready, ...blocked] : lane === 'in_progress' ? in_progress : done;
            const droppable = laneDroppable(dept.id, lane);
            const isOver = overLane === `${dept.id}:${lane}`;
            return (
              <div
                key={lane}
                className={[
                  styles.kanbanLane,
                  droppable && styles.kanbanLaneDroppable,
                  droppable && isOver && styles.kanbanLaneOver,
                  drag && !droppable && styles.kanbanLaneDisabled,
                ].filter(Boolean).join(' ')}
                onDragEnter={(e) => { if (droppable) e.preventDefault(); }}
                onDragOver={(e) => { if (droppable) { e.preventDefault(); setOverLane(`${dept.id}:${lane}`); } }}
                onDragLeave={() => isOver && setOverLane(null)}
                onDrop={() => onDrop(dept.id, lane)}
              >
                <div className={styles.kanbanLaneTitle}>
                  {LANE_TITLES[lane]} {list.length > 0 && <span className={styles.subText}>({list.length})</span>}
                </div>
                {list.map((entry) => (
                  <KanbanCard
                    key={entry.stage.id}
                    entry={entry}
                    onDragStart={onDragStart}
                    onDragEnd={onDragEnd}
                    dragging={drag?.entry.stage.id === entry.stage.id}
                  />
                ))}
                {list.length === 0 && <div className={styles.kanbanEmpty}>—</div>}
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
