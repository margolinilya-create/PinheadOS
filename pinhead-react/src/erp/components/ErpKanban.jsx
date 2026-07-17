import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore, orderPreviewUrl } from '../store/useErpStore';
import { isStageReady } from '../utils/routes';
import { daysLeft, formatTimeIn } from '../utils/time';
import { deptShortName, isQueueDept } from '../data/departments';
import styles from '../erp.module.css';

/**
 * Канбан цехов (механика kontora24, движок — наш HTML5 DnD как в Order Studio).
 * Колонка = цех, карточка = этап позиции. Drag ВНУТРИ колонки меняет статус
 * (готов → в работе → готово); между цехами не таскаем — маршрут решает граф.
 *
 * Тач-устройства: HTML5 DnD не работает на touch — на pointer:coarse лениво
 * подгружается полифилл mobile-drag-drop (~10KB), десктоп его не грузит.
 */

let dndPolyfillLoaded = false;

/** Ленивая инициализация mobile-drag-drop только на тач-устройствах */
function useTouchDndPolyfill() {
  useEffect(() => {
    if (dndPolyfillLoaded) return;
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia('(pointer: coarse)').matches) return;
    dndPolyfillLoaded = true;
    Promise.all([
      import('mobile-drag-drop'),
      import('mobile-drag-drop/scroll-behaviour'),
      import('mobile-drag-drop/default.css'),
    ]).then(([{ polyfill }, { scrollBehaviourDragImageTranslateOverride }]) => {
      const applied = polyfill({
        // прокрутка страницы во время drag у края экрана
        dragImageTranslateOverride: scrollBehaviourDragImageTranslateOverride,
        // удержание 300мс перед drag — обычный тап/скролл не конфликтует
        holdToDrag: 300,
        dragImageCenterOnTouch: true,
      });
      if (applied) {
        // iOS Safari: без «неленивого» touchmove-слушателя drag не стартует
        // (opt-in из README пакета — usePassiveEventListeners workaround)
        window.addEventListener('touchmove', () => {}, { passive: false });
      }
    }).catch(() => {
      dndPolyfillLoaded = false; // сеть моргнула — попробуем при следующем монтировании
    });
  }, []);
}

/** Цветная точка дедлайна (как в kontora24 DraggableCard) */
function DeadlineDot({ due }) {
  const d = daysLeft(due);
  if (d === null) return null;
  const color = d < 0 ? 'var(--color-error)' : d <= 3 ? 'var(--color-warning)' : 'var(--color-success)';
  const label = d < 0 ? `просрочен ${-d} дн` : `${d} дн до срока`;
  return (
    <span className={styles.kanbanDue} title={label}>
      <span className={styles.kanbanDot} style={{ background: color }} />
      {due && new Date(due + 'T00:00:00').toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })}
    </span>
  );
}

function KanbanCard({ entry, onDragStart, onDragEnd, dragging }) {
  const { order, item, stage, group } = entry;
  const timeIn = group === 'in_progress'
    ? formatTimeIn(stage.started_at)
    : formatTimeIn(stage.updated_at);

  return (
    <div
      className={`${styles.kanbanCard} ${dragging ? styles.kanbanCardDragging : ''} ${group === 'blocked' ? styles.kanbanCardBlocked : ''}`}
      draggable={group !== 'blocked'}
      onDragStart={(e) => onDragStart(e, entry)}
      onDragEnd={onDragEnd}
      role="listitem"
      aria-label={`${order.title}: ${item.product_type}, ${item.qty} шт`}
    >
      <div className={styles.kanbanCardHead}>
        {orderPreviewUrl(order) && (
          <img src={orderPreviewUrl(order)} alt="" className={styles.orderThumb} draggable={false} />
        )}
        <Link
          to={`/orders/${order.id}`}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          className={styles.kanbanCardTitle}
        >
          {order.title}
        </Link>
        <DeadlineDot due={order.due_date} />
      </div>
      <div className={styles.subText}>
        №{order.bitrix_id || '—'} · {item.product_type}
        {item.variant ? ` · ${item.variant}` : ''}
      </div>
      <div className={styles.kanbanCardFoot}>
        <span className={styles.queueQty}>{item.qty} шт</span>
        {stage.qty_rework > 0 && (
          <span className={styles.overdue}>брак {stage.qty_rework}</span>
        )}
        {timeIn && <span className={styles.subText}>⏱ {timeIn}</span>}
        {group === 'blocked' && stage.block_reason && (
          <span className={styles.overdue} title={stage.block_reason}>🚫</span>
        )}
      </div>
    </div>
  );
}

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

  const columns = useMemo(() => {
    const deps = departments.filter((d) => d.active && isQueueDept(d.code));
    const byDept = new Map(deps.map((d) => [d.id, { dept: d, ready: [], in_progress: [], blocked: [], done: [] }]));
    for (const order of orders) {
      if (order.status !== 'active') continue;
      for (const item of order.items) {
        for (const stage of item.stages) {
          const col = byDept.get(stage.department_id);
          if (!col) continue;
          const entry = { order, item, stage };
          if (stage.status === 'in_progress') col.in_progress.push({ ...entry, group: 'in_progress' });
          else if (stage.status === 'blocked') col.blocked.push({ ...entry, group: 'blocked' });
          else if (stage.status === 'done') col.done.push({ ...entry, group: 'done' });
          else if (
            stage.status === 'waiting' &&
            isStageReady(stage, item.stages, order.materials, col.dept.code)
          ) col.ready.push({ ...entry, group: 'ready' });
        }
      }
    }
    const byDue = (a, b) => (a.order.due_date || '9999').localeCompare(b.order.due_date || '9999');
    for (const col of byDept.values()) {
      col.ready.sort(byDue);
      col.in_progress.sort(byDue);
      col.done.sort((a, b) => (b.stage.finished_at || '').localeCompare(a.stage.finished_at || ''));
      col.done = col.done.slice(0, 5);
    }
    return [...byDept.values()];
  }, [orders, departments]);

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
            <span className={styles.deptTabCount}>{ready.length + in_progress.length}</span>
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
