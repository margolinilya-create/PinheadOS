import { useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { confirmWithInput } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { deptShortName } from '../data/departments';
import { buildKanbanColumns } from '../utils/kanbanColumns';
import { kanbanDropIntent, ALLOWED_LANE_DROP } from '../utils/kanbanDrop';
import { confirmStageDone } from '../utils/stageDone';
import { materialsForItem } from '../utils/routes';
import { analyzeStageMove, moveConfirmMessage } from '../utils/stageMove';
import styles from '../erp.module.css';
import { KanbanCard } from './kanban/KanbanCard';
import { useTouchDndPolyfill } from './kanban/useTouchDndPolyfill';
import { useScrollHints } from '../../hooks/useScrollHints';

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

/**
 * Дорожки колонки цеха. Порядок массива = порядок на доске.
 *
 * СВЕРХУ ТО, С ЧЕМ МОЖНО РАБОТАТЬ СЕЙЧАС (правка 23.08, п. 3 — тот же принцип,
 * что в очереди цеха): «Готово к работе» → «В работе» → «С проблемой» →
 * ожидания → «Завершено». До 23.08 ожидания стояли ПЕРВЫМИ, и позиции,
 * которые нельзя начать, занимали верх каждой колонки.
 *
 * «С проблемой» — своя дорожка (правка менеджера 2026-08-03): раньше ручные
 * блокировки подмешивались в «Готово к работе», и понять, что цех стоит,
 * было нельзя.
 *
 * `waiting` добавлена правкой 30.08 (п. 7). До неё доска не показывала этап,
 * ждущий предыдущий ЦЕХ, вовсе — а это ровно та «будущая работа», которую
 * документ просит показать цеху заранее. Перечисление обязано совпадать
 * с группами `buildQueueEntries`: пропущенная здесь дорожка означает работу,
 * исчезнувшую с доски без единой ошибки.
 */
const LANES = ['ready', 'in_progress', 'blocked', 'waiting', 'awaiting_materials', 'done'];

const LANE_TITLES = {
  waiting: 'Ожидает',
  awaiting_materials: 'Ожидают материалы',
  ready: 'Готово к работе',
  in_progress: 'В работе',
  blocked: 'С проблемой',
  done: 'Завершено',
};

/** Право, нужное для перехода в дорожку (см. laneDroppable) */
const LANE_PERMISSION = {
  in_progress: 'stage.take',
  done: 'stage.complete',
};

/** Ширина краевой зоны автоскролла доски и шаг сдвига за событие */
const EDGE_PX = 72;
const EDGE_STEP = 24;

export default function ErpKanban({ filters }) {
  const { orders, departments, bypasses, setStageStatus, reorderStageQueue, moveStageToDepartment } =
    useErpStore(
      useShallow((s) => ({
        orders: s.orders,
        departments: s.departments,
        bypasses: s.bypasses,
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
  // Подсказки краёв: колонок до шести (~1810px), на ноутбуке видно три
  const { ref: boardRef, hints: boardHints } = useScrollHints();
  useTouchDndPolyfill();

  /**
   * `bypasses` обязателен: без него канбан — единственный экран, который
   * не знает об аварийно снятых блокировках. Очередь, доска, план и бейджи
   * показывали бы этап готовым к запуску, а дорожка канбана держала бы его
   * в «Ожидают материалы» без пометки и без возможности перетащить —
   * ровно то расхождение, ради которого `utils/bypass` и написан.
   */
  const columns = useMemo(
    () => buildKanbanColumns(orders, departments, filters, bypasses),
    [orders, departments, filters, bypasses],
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

  /**
   * Дорожка своей колонки, куда разрешён переход по статусу.
   * Гейт прав такой же, как у соседних жестов (приоритет, перенос между цехами):
   * запрещённая дорожка не подсвечивается и не принимает бросок — иначе работник
   * швейки закрывал бы этап ДТФ, просто открыв доску.
   */
  const laneDroppable = (deptId, lane) => {
    if (!drag || drag.deptId !== deptId) return false;
    if (!(ALLOWED_LANE_DROP[drag.group] || []).includes(lane)) return false;
    const permission = LANE_PERMISSION[lane];
    return !permission || access.canDo(permission, deptId);
  };
  /** Колонка чужого цеха — перенос между процессами (по праву) */
  const columnDroppable = (deptId) =>
    drag && drag.deptId !== deptId && access.canDo('stage.move_department', drag.deptId);

  /**
   * Автоскролл у края — вместо прокрутки страницы.
   * По горизонтали едет сама доска, по вертикали — колонка под курсором: она
   * ограничена по высоте и имеет свой overflow, а на время перетаскивания доска
   * получает touch-action: none. Без вертикального автоскролла поставить задание
   * на приоритетное место ниже видимой части колонки было нельзя ни мышью
   * (колесо во время HTML5-drag не приходит), ни пальцем — а 10+ карточек
   * в швейке это норма.
   */
  const onBoardDragOver = (e) => {
    if (!drag) return;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    if (e.clientX < rect.left + EDGE_PX) board.scrollLeft -= EDGE_STEP;
    else if (e.clientX > rect.right - EDGE_PX) board.scrollLeft += EDGE_STEP;

    const col = e.target?.closest?.(`.${styles.kanbanCol}`);
    if (!col || col.scrollHeight <= col.clientHeight) return;
    const colRect = col.getBoundingClientRect();
    if (e.clientY < colRect.top + EDGE_PX) col.scrollTop -= EDGE_STEP;
    else if (e.clientY > colRect.bottom - EDGE_PX) col.scrollTop += EDGE_STEP;
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
    if (!dragged) return;
    const target = dropAt;
    const intent = kanbanDropIntent({
      draggedDeptId: dragged.stage.department_id,
      draggedGroup: dragged.group,
      targetDeptId: deptId,
      targetLane: lane,
      hasInsertPoint: Boolean(target) && list.some((e) => e.stage.id === target.id),
    });
    const canLane = laneDroppable(deptId, lane);
    onDragEnd();

    if (intent === 'reorder') {
      const ids = list.map((e) => e.stage.id).filter((id) => id !== dragged.stage.id);
      const at = ids.indexOf(target.id);
      if (at < 0) return;
      const insertAt = target.before ? at : at + 1;
      await reorderStageQueue(
        dragged.stage.id,
        insertAt > 0 ? ids[insertAt - 1] : null,
        insertAt < ids.length ? ids[insertAt] : null,
      );
      return;
    }

    if (intent !== 'status' || !canLane) return;
    if (lane === 'in_progress') await setStageStatus(dragged.stage.id, 'in_progress');
    if (lane === 'done') {
      // Дорожка «Завершено» пишет весь тираж — спрашиваем, если сдано не всё
      const ok = await confirmStageDone({
        stage: dragged.stage,
        qty: dragged.item.qty,
        allStages: dragged.item.stages,
        deptNameById,
        // Гейт закупки (правка 30.08, п. 5) — те же аргументы, что в очереди цеха
        materials: materialsForItem(dragged.order.materials, dragged.item.id),
        dept: departments.find((d) => d.id === dragged.stage.department_id),
      });
      if (!ok) return;
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
    // Возврат назад и пропуск этапов заказчик просил сопровождать комментарием —
    // спрашиваем его прямо в диалоге подтверждения, одним шагом
    const { ok, value } = await confirmWithInput({
      title: `Перенести заказ в «${dept.name}»?`,
      message: moveConfirmMessage(plan, sourceName, targetName),
      confirmLabel: 'Перенести',
      variant: plan.requiresComment ? 'danger' : undefined,
      prompt: plan.requiresComment
        ? {
            label: 'Причина переноса (попадёт в историю заказа)',
            placeholder: 'напр. брак на предыдущем этапе',
            required: true,
          }
        : undefined,
    });
    if (!ok) return;
    await moveStageToDepartment(dragged.stage.id, dept.id, { comment: value || null });
  };

  return (
    <div className={styles.scrollHintWrap}>
    <div
      className={`${styles.kanbanBoard} ${drag ? styles.kanbanBoardDragging : ''}`}
      role="list"
      aria-label="Канбан по цехам"
      ref={boardRef}
      onDragOver={onBoardDragOver}
    >
      {columns.map((col) => {
        const { dept } = col;
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
              {/* Бейдж = все видимые карточки колонки, ERP-05 */}
              <span className={styles.deptTabCount}>
                {LANES.reduce((n, lane) => n + col[lane].length, 0)}
              </span>
            </header>

            {LANES.map((lane) => {
              const list = col[lane];
              const droppable = laneDroppable(dept.id, lane);
              const isOver = overLane === `${dept.id}:${lane}`;
              return (
                <div
                  key={lane}
                  className={[
                    styles.kanbanLane,
                    // Пустая дорожка схлопывается до заголовка: у семи цехов
                    // по пять дорожек это тридцать пять прочерков на экране,
                    // и они вытесняли карточки, ради которых доска открыта.
                    // Во время перетаскивания дорожки разворачиваются обратно —
                    // иначе некуда целиться (правило «у DnD должна быть цель»).
                    list.length === 0 && !drag && styles.kanbanLaneEmpty,
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
                    // Карточка из чужого цеха — это перенос между процессами: событие
                    // не трогаем, оно всплывёт в колонку. Раньше дорожка забирала его
                    // себе, onLaneDrop обнулял dragRef, и onColumnDrop читал уже null —
                    // перенос молча не срабатывал везде, кроме шапки колонки.
                    if (dragRef.current && dragRef.current.stage.department_id !== dept.id) return;
                    // Внутренний drop не должен всплыть в колонку и стать «переносом в цех»
                    if (droppable || dropAt) e.stopPropagation();
                    onLaneDrop(dept.id, lane, list);
                  }}
                >
                  <div className={styles.kanbanLaneTitle}>
                    {LANE_TITLES[lane]} <span className={styles.subText}>({list.length})</span>
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
                  {/* Прочерк только когда дорожка развёрнута (идёт перетаскивание):
                      в свёрнутом виде роль «здесь пусто» играет сам счётчик «0». */}
                  {list.length === 0 && drag && <div className={styles.kanbanEmpty}>перетащите сюда</div>}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
    {boardHints.left && <div className={`${styles.scrollFade} ${styles.scrollFadeL}`} aria-hidden="true" />}
    {boardHints.right && <div className={`${styles.scrollFade} ${styles.scrollFadeR}`} aria-hidden="true" />}
    </div>
  );
}
