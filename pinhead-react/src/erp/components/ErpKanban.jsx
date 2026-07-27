import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { deptShortName } from '../data/departments';
import { buildKanbanColumns } from '../utils/kanbanColumns';
import { analyzeStageMove, moveConfirmMessage } from '../utils/stageMove';
import styles from '../erp.module.css';
import { KanbanCard } from './kanban/KanbanCard';
import { useTouchDndPolyfill } from './kanban/useTouchDndPolyfill';

/**
 * Производственный канбан: колонка = цех (процесс), карточка = этап позиции.
 * Движок — наш HTML5 DnD (0 новых зависимостей), на тач-экранах лениво
 * подключается полифилл mobile-drag-drop.
 *
 * Три жеста (блок «канбан и перемещение между процессами»):
 *  - вертикально внутри дорожки — меняет приоритет задания в очереди цеха;
 *  - между дорожками своей колонки — меняет статус (готов → в работе → завершено);
 *  - в другую колонку — переносит задание в другой цех: текущий этап закрывается,
 *    целевой открывается. Перед этим показываем подтверждение с последствиями
 *    (пропуск этапов, возврат назад, незакрытое количество) — заказчик просил
 *    не помечать предыдущий этап завершённым молча.
 *
 * Прокрутка страницы во время перетаскивания заблокирована: доска и колонки
 * держат скролл у себя (overscroll-behavior), у края доски работает
 * горизонтальный автоскролл самой доски, а не окна.
 */

const LANE_TITLES = {
  ready: 'Готово к работе',
  in_progress: 'В работе',
  done: 'Завершено',
};

/** Куда карточку можно уронить внутри своей колонки */
const ALLOWED_DROP = {
  ready: ['in_progress'],
  in_progress: ['done'],
};

/** Ширина краевой зоны автоскролла доски и шаг сдвига за событие */
const EDGE_PX = 72;
const EDGE_STEP = 24;

export default function ErpKanban({ filters }) {
  const { orders, departments, setStageStatus, reorderStageQueue, moveStageToDepartment } =
    useErpStore(
      useShallow((s) => ({
        orders: s.orders,
        departments: s.departments,
        setStageStatus: s.setStageStatus,
        reorderStageQueue: s.reorderStageQueue,
        moveStageToDepartment: s.moveStageToDepartment,
      })),
    );
  const access = useErpAccess();
  const [drag, setDrag] = useState(null);        // { entry, deptId, group }
  const [overLane, setOverLane] = useState(null); // `${deptId}:${lane}`
  const [dropAt, setDropAt] = useState(null);     // { id, before } — место вставки
  const dragRef = useRef(null);
  const boardRef = useRef(null);
  useTouchDndPolyfill();

  const columns = useMemo(
    () => buildKanbanColumns(orders, departments, filters),
    [orders, departments, filters],
  );
  const deptNameById = useMemo(
    () => new Map(departments.map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments],
  );

  const onDragStart = (e, entry) => {
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', entry.stage.id); } catch { /* IE */ }
    dragRef.current = entry;
    setDrag({ entry, deptId: entry.stage.department_id, group: entry.group });
  };
  const onDragEnd = () => {
    dragRef.current = null;
    setDrag(null); setOverLane(null); setDropAt(null);
  };

  /** Дорожка своей колонки, куда разрешён переход по статусу */
  const laneDroppable = (deptId, lane) =>
    drag && drag.deptId === deptId && (ALLOWED_DROP[drag.group] || []).includes(lane);
  /** Колонка чужого цеха — перенос между процессами (по праву) */
  const columnDroppable = (deptId) =>
    drag && drag.deptId !== deptId && access.canDo('stage.move_department', drag.deptId);

  /** Автоскролл самой доски у края — вместо прокрутки страницы */
  const onBoardDragOver = (e) => {
    if (!drag) return;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    if (e.clientX < rect.left + EDGE_PX) board.scrollLeft -= EDGE_STEP;
    else if (e.clientX > rect.right - EDGE_PX) board.scrollLeft += EDGE_STEP;
  };

  const onCardDragOver = (e, entry) => {
    const dragged = dragRef.current;
    if (!dragged || dragged.stage.id === entry.stage.id) return;
    // Приоритет меняется только внутри одной дорожки одного цеха
    if (dragged.stage.department_id !== entry.stage.department_id) return;
    if (dragged.group !== entry.group) return;
    if (!access.canDo('stage.priority', entry.stage.department_id)) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setDropAt({ id: entry.stage.id, before: e.clientY < rect.top + rect.height / 2 });
  };

  /** Отпустили внутри дорожки: либо приоритет (есть место вставки), либо смена статуса */
  const onLaneDrop = async (deptId, lane, list) => {
    const dragged = dragRef.current;
    const target = dropAt;
    const canLane = laneDroppable(deptId, lane);
    onDragEnd();
    if (!dragged) return;

    if (target && dragged.stage.department_id === deptId) {
      const ids = list.map((e) => e.stage.id).filter((id) => id !== dragged.stage.id);
      const at = ids.indexOf(target.id);
      if (at >= 0) {
        const insertAt = target.before ? at : at + 1;
        await reorderStageQueue(
          dragged.stage.id,
          insertAt > 0 ? ids[insertAt - 1] : null,
          insertAt < ids.length ? ids[insertAt] : null,
        );
        return;
      }
    }

    if (!canLane) return;
    if (lane === 'in_progress') await setStageStatus(dragged.stage.id, 'in_progress');
    if (lane === 'done') {
      await setStageStatus(dragged.stage.id, 'done', { qty_done: dragged.item.qty });
    }
  };

  /** Отпустили над чужой колонкой: перенос задания в другой цех */
  const onColumnDrop = async (dept) => {
    const dragged = dragRef.current;
    onDragEnd();
    if (!dragged || dragged.stage.department_id === dept.id) return;
    if (!access.canDo('stage.move_department', dragged.stage.department_id)) {
      toast.error('Нет права переносить задания между цехами');
      return;
    }

    const plan = analyzeStageMove({
      stage: dragged.stage,
      item: dragged.item,
      targetDeptId: dept.id,
      targetDeptName: dept.name,
      deptNameById,
    });
    if (!plan.allowed) {
      toast.error(plan.issues[0]?.text || 'Перенос невозможен');
      return;
    }

    const sourceName = deptNameById.get(dragged.stage.department_id) || 'цех';
    const targetName = deptShortName(dept.code, dept.name);
    const ok = await confirm({
      title: `Перенести заказ в «${dept.name}»?`,
      message: moveConfirmMessage(plan, sourceName, targetName),
      confirmLabel: 'Перенести',
      variant: plan.requiresComment ? 'danger' : undefined,
    });
    if (!ok) return;

    // Возврат назад и пропуск этапов заказчик просил сопровождать комментарием
    let comment = null;
    if (plan.requiresComment) {
      comment = window.prompt('Причина переноса (попадёт в историю заказа):', '');
      if (!comment || !comment.trim()) {
        toast.warning('Перенос отменён — нужна причина');
        return;
      }
    }
    await moveStageToDepartment(dragged.stage.id, dept.id, { comment });
  };

  return (
    <div
      className={`${styles.kanbanBoard} ${drag ? styles.kanbanBoardDragging : ''}`}
      role="list"
      aria-label="Канбан по цехам"
      ref={boardRef}
      onDragOver={onBoardDragOver}
    >
      {columns.map(({ dept, ready, in_progress: inProgress, blocked, done }) => {
        const canDropHere = columnDroppable(dept.id);
        return (
          <section
            key={dept.id}
            className={`${styles.kanbanCol} ${canDropHere ? styles.kanbanColDroppable : ''}`}
            onDragOver={(e) => { if (canDropHere) e.preventDefault(); }}
            onDrop={(e) => { if (canDropHere) { e.preventDefault(); onColumnDrop(dept); } }}
          >
            <header className={styles.kanbanColHead}>
              {deptShortName(dept.code, dept.name)}
              {/* Бейдж = все видимые карточки колонки (ready+blocked+in_progress+done), ERP-05 */}
              <span className={styles.deptTabCount}>
                {ready.length + blocked.length + inProgress.length + done.length}
              </span>
            </header>

            {['ready', 'in_progress', 'done'].map((lane) => {
              const list = lane === 'ready'
                ? [...ready, ...blocked]
                : lane === 'in_progress' ? inProgress : done;
              const droppable = laneDroppable(dept.id, lane);
              const isOver = overLane === `${dept.id}:${lane}`;
              return (
                <div
                  key={lane}
                  className={[
                    styles.kanbanLane,
                    droppable && styles.kanbanLaneDroppable,
                    droppable && isOver && styles.kanbanLaneOver,
                    drag && !droppable && !canDropHere && styles.kanbanLaneDisabled,
                  ].filter(Boolean).join(' ')}
                  onDragEnter={(e) => { if (droppable) e.preventDefault(); }}
                  onDragOver={(e) => {
                    if (droppable) { e.preventDefault(); setOverLane(`${dept.id}:${lane}`); }
                  }}
                  onDragLeave={() => isOver && setOverLane(null)}
                  onDrop={(e) => {
                    // Внутренний drop не должен всплыть в колонку и стать «переносом в цех»
                    if (droppable || dropAt) e.stopPropagation();
                    onLaneDrop(dept.id, lane, list);
                  }}
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
                      onDragOverCard={onCardDragOver}
                      dragging={drag?.entry.stage.id === entry.stage.id}
                      dropBefore={dropAt?.id === entry.stage.id && dropAt.before}
                      dropAfter={dropAt?.id === entry.stage.id && !dropAt.before}
                    />
                  ))}
                  {list.length === 0 && <div className={styles.kanbanEmpty}>—</div>}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
