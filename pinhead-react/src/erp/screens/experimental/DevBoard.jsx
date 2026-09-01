import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { OrderLink } from '../../components/OrderLink';
import { StageIndicator } from '../../components/StageIndicator';
import { useScrollHints } from '../../../hooks/useScrollHints';
import {
  DEV_LANE_TITLES,
  DEV_STAGE_LABELS,
  DEV_STAGE_ORDER,
  cuttingGate,
  devBoardColumn,
  devStageStates,
} from '../../utils/experimentalBoard';
import {
  devMoveIntent, devMoveLabel, devMoveRefusalText, neighbourStage,
} from '../../utils/devBoardMove';
import { currentBlocker, nextAction, taskLabel } from '../../utils/experimentalTasks';
import { dueLabelCompact } from '../../utils/format';
import { daysLeft } from '../../utils/time';
import { toast } from '../../../store/useToastStore';
import styles from '../../styles';

/**
 * Доска экспериментального цеха по этапам (правки заказчика 20.08).
 *
 * «Главный экран должен быть построен по этапам, по тому же принципу, как
 * сейчас выглядит общий производственный борд… Разработка перемещается между
 * этапами по мере выполнения работ».
 *
 * КАРТОЧКУ ДВИГАЕТ ЧЕЛОВЕК (правка заказчика 24.08, п. 4.2): «ответственный
 * за проработку технолог сам вручную перетаскивает карточку между колонками.
 * Автоматическое движение по основным этапам не нужно». Колонка стала хранимой
 * (`board_stage`), и перетаскивание пишет именно её; расчёт по задачам остался
 * ответом на другой вопрос — он питает дорожки внутри колонки и узлы пути.
 *
 * У ПЕРЕТАСКИВАНИЯ ЕСТЬ КЛАВИАТУРНАЯ АЛЬТЕРНАТИВА — правило проекта, и здесь
 * оно вдвойне уместно: на планшете палец задевает соседние колонки при
 * прокрутке, а кнопки «‹ ›» переносят ровно на шаг.
 *
 * КАРТОЧКА — `div`, А НЕ `button`. Внутри неё живут ссылка на заказ и кнопки
 * переноса; кнопка внутри кнопки и ссылка внутри кнопки — невалидная разметка,
 * и браузеры разбирают её по-разному. Роль и клавиатура сделаны руками, ровно
 * как у карточки общего борда.
 */

/** Дорожки в порядке борда: сначала то, что стоит, потом то, что идёт */
const LANES = ['blocked', 'awaiting_materials', 'waiting', 'ready', 'in_progress', 'done'];

/**
 * Дорожка карточки внутри её колонки.
 *
 * ФОЛБЭК ОБЯЗАТЕЛЕН, И НАШЁЛСЯ ОН ПАДЕНИЕМ (правка 24.08, п. 4.2). Пока колонку
 * считал расчёт, он выбирал первый НЕ закрытый и НЕ пропущенный шаг — на дорожку
 * `skipped` карточка не попадала никогда, и её отсутствия в `LANES` никто
 * не замечал. Теперь колонку ставит человек: технолог переносит карточку
 * в «Нанесения», у которых задач ещё нет, шаг помечен `skipped` — и карточка
 * исчезала с доски целиком. Счётчик колонки при этом показывал единицу,
 * то есть экран сообщал «карточка здесь» и не рисовал её.
 *
 * `waiting` — не заглушка, а точное описание: работа на шаге ещё не заведена,
 * и разработка её ждёт. Ровно в этом состоянии её и застаёт выбор видов
 * нанесения (п. 4.3).
 */
function laneOf(row, stage) {
  const lane = row.states.find((s) => s.stage === stage)?.lane;
  return LANES.includes(lane) ? lane : 'waiting';
}

const LANE_CHIP = {
  blocked: 'chipBlocked',
  awaiting_materials: 'chipWaiting',
  waiting: 'chipNeutral',
  ready: 'chipReady',
  in_progress: 'chipProgress',
  done: 'chipDone',
};

function DevBoardCard({ row, onOpen, onMove, canManage, dragging, onDragStart, onDragEnd }) {
  const { dev, tasks, states, column, typeNames, materialGate } = row;
  const state = states.find((s) => s.stage === column);
  // Подписи задач берутся из справочника: без него человек читает код
  // (`начать patterns`) — то же правило, что в строке списка
  const blocker = currentBlocker(tasks, typeNames, row.today);
  const action = nextAction(dev, tasks, typeNames, row.today);
  const due = dev.due_date || dev.order?.due_date || null;
  const left = daysLeft(due);
  const overdue = left !== null && left < 0 && !dev.outcome;

  const movable = canManage && !dev.outcome;
  /**
   * Соседний шаг считается ПО ПУТИ ЭТОЙ разработки, а не по общему порядку
   * колонок (правка 01.09): у заказа без нанесений «›» из «Кроя» обязана вести
   * в «Пошив», а не в шаг, которого у образца нет. Контекст тот же, что
   * у `devMoveIntent`, — иначе кнопка предлагала бы ход, который тут же
   * отклоняется.
   */
  const moveCtx = { materialsPending: !materialGate?.open, hasBranding: row.hasBranding };
  const prev = neighbourStage(column, -1, moveCtx);
  const next = neighbourStage(column, 1, moveCtx);

  return (
    <div
      className={[styles.kanbanCard, dragging && styles.kanbanCardDragging]
        .filter(Boolean).join(' ')}
      draggable={movable}
      onDragStart={(e) => onDragStart(e, row)}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(dev.id)}
      role="listitem"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        // Enter/Space на вложенной ссылке или кнопке отдаём ей самой
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onOpen(dev.id);
      }}
      aria-label={`Разработка ${dev.tech_name || dev.order?.title || ''}`}
    >
      <div className={styles.kanbanCardHead}>
        <OrderLink orderId={dev.order_id} onClick={(e) => e.stopPropagation()}>
          №{dev.order?.bitrix_id || '—'}
        </OrderLink>
        <span className={overdue ? styles.overdue : styles.subText}>
          {dueLabelCompact(left)}
        </span>
      </div>

      <div className={styles.kanbanCardTitle}>
        {dev.tech_name || dev.order?.title || 'Без названия'}
      </div>
      {/* Вариант/цвет — прямое требование документа к карточке доски */}
      {dev.dev_type && <div className={styles.subText}>{dev.dev_type}</div>}

      <div className={styles.subText}>
        {dev.technologist || dev.constructor || 'ответственный не назначен'}
      </div>

      {/* Текущая задача и следующее действие — то, ради чего доска и нужна */}
      {blocker && (
        <div className={styles.subText}>
          <Icon name="flask" size={12} /> {taskLabel(blocker, typeNames)}
        </div>
      )}
      {state?.waitingReason && (
        <span className={`${styles.chip} ${styles[LANE_CHIP[state.lane]]}`}>
          {state.waitingReason}
        </span>
      )}
      {/*
        «ОЖИДАЕМ МАТЕРИАЛ» НА ЛЕКАЛАХ (правка заказчика 30.08, п. 1).

        До правки материальный чип рисовался только у колонки «Крой» — там,
        где материал нужен физически. Но держит он теперь и ВЫХОД с лекал,
        а блокировка без видимой причины читается как поломка: человек тянет
        карточку, она не двигается, и объяснение появляется только тостом
        после попытки. Плашка отвечает на «почему стоит» ДО действия.

        Только на «Лекалах»: в «Крое» ту же причину уже называет
        `state.waitingReason` выше, и два одинаковых чипа подряд — это
        не усиление сигнала, а шум.
      */}
      {column === 'patterns' && materialGate && !materialGate.open && (
        <span className={`${styles.chip} ${styles.chipWaiting}`}>
          Ожидаем материал
        </span>
      )}
      {action && <div className={styles.cellSub}>{action}</div>}

      {/* Путь разработки: что выполнено, что идёт, что осталось.
          Вид индикатора один на весь ERP — своей ленты точек здесь не заводим.
          БЕЗ ПОДПИСЕЙ: пять названий шире колонки канбана, и карточка вылезала
          в соседнюю. Название несут `title` и `aria-label` точки, а полный
          путь со словами стоит в карточке разработки, где документ его и просит */}
      <StageIndicator
        variant="dots"
        label="Путь разработки"
        nodes={states.map((s) => ({
          key: s.stage,
          label: '',
          title: DEV_STAGE_LABELS[s.stage],
          // Пропущенный шаг НЕ помечается галочкой: она означает «выполнено»,
          // а у образца без печати нанесения не было вовсе. Линия при этом
          // идёт дальше — путь на нём не обрывается
          state: s.stage === column
            ? (s.lane === 'blocked' ? 'blocked' : 'active')
            : (s.lane === 'done' ? 'done' : undefined),
          lineDone: s.lane === 'done' || s.lane === 'skipped',
        }))}
      />

      {/*
        КЛАВИАТУРНАЯ (И ПАЛЬЦЕВАЯ) АЛЬТЕРНАТИВА ПЕРЕТАСКИВАНИЮ. Кнопка на краю
        списка гасится, а не исчезает: пропадающий элемент сдвигает соседний
        под палец, и человек нажимает не то, что видел.
      */}
      {movable && (
        <div className={styles.devMoveRow} onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="sm"
            disabled={!prev}
            aria-label={prev ? devMoveLabel(prev) : 'Левее колонок нет'}
            onClick={() => prev && onMove(row, prev)}
          >
            ‹
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={!next}
            aria-label={next ? devMoveLabel(next) : 'Правее колонок нет'}
            onClick={() => next && onMove(row, next)}
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}

export function DevBoard({
  rows, today, onOpen, materialsByOrder, supplyOpenByOrder, brandingByItem,
  brandingOpenByDev, typeNames, onMoveStage, canManage = false,
}) {
  const { ref } = useScrollHints();
  /**
   * Перетаскиваемая карточка живёт в ref, а не в состоянии: обработчик `drop`
   * колонки читает её синхронно, и лишняя перерисовка между `dragstart`
   * и `drop` успела бы обнулить значение. `dragId` в состоянии нужен только
   * для вида — им подсвечивается сама карточка.
   */
  const dragRef = useRef(null);
  const [dragId, setDragId] = useState(null);
  const [overStage, setOverStage] = useState(null);

  const startDrag = useCallback((e, row) => {
    dragRef.current = row;
    setDragId(row.dev.id);
    // `effectAllowed` + данные обязательны: без них Firefox не начинает жест
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', row.dev.id);
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDragId(null);
    setOverStage(null);
  }, []);

  /**
   * Перенос — ОДНО место на бросок и на кнопки. Отказ называет причину:
   * молча не сработавшее перетаскивание человек повторяет ещё трижды,
   * прежде чем решить, что сайт сломан.
   */
  const move = useCallback(async (row, to) => {
    const intent = devMoveIntent({
      from: row.column,
      to,
      outcome: row.dev.outcome,
      canManage,
      // Закупка держит вход в крой (правка 30.08, п. 1; уточнена 01.09, п. 1)
      materialsPending: !row.materialGate.open,
      // Нанесения обязательны, если они указаны в заказе (правка 01.09, п. 2)
      hasBranding: row.hasBranding,
      // …и пока цех их не закрыл, дальше «Нанесений» карточка не идёт (п. 1)
      brandingOpen: row.brandingOpen,
    });
    if (!intent.ok) {
      // «Карточка уже здесь» — не ошибка, а обычный исход броска мимо
      if (intent.reason !== 'same') toast.error(devMoveRefusalText(intent));
      return;
    }
    await onMoveStage?.(row.dev.id, intent.to);
  }, [canManage, onMoveStage]);

  const dropOn = useCallback((e, stage) => {
    const row = dragRef.current;
    endDrag();
    if (!row) return;
    e.preventDefault();
    move(row, stage);
  }, [endDrag, move]);

  const columns = useMemo(() => {
    /**
     * ПЕРЕДАННЫЕ НА СКЛАД УХОДЯТ С ДОСКИ (правка заказчика 30.08, п. 4):
     * «убрать карточку из активной колонки „Финальный этап"». Работа
     * экспериментального цеха по такому образцу закончена — дальше он живёт
     * в складском контуре, и место в «Финальном этапе» он занимал бы
     * бессрочно.
     *
     * Из СПИСКА разработок они при этом не исчезают: там есть плитка
     * «Переданы на склад», и это история, которую документ просит хранить.
     * Доска отвечает на «что делать», список — на «что было».
     */
    const prepared = rows
      .filter(({ dev }) => !dev.handed_to_warehouse_at)
      .map(({ dev, tasks }) => {
        const materials = materialsByOrder?.get(dev.order_id) ?? [];
        const supplyOpen = supplyOpenByOrder?.get(dev.order_id) === true;
        const hasBranding = brandingByItem?.get(dev.item_id) === true;
        const states = devStageStates({
          dev, tasks, materials, supplyOpen, hasBranding,
        });
        /**
         * Держат ли материалы (правка 30.08, п. 1; уточнена 01.09, п. 1).
         * `patternsDone: true` отсекает лекальную половину гейта — нас
         * интересует ровно материальная: сами лекала идут параллельно закупке.
         */
        const materialGate = cuttingGate({
          patternsDone: true, itemId: dev.item_id, materials, supplyOpen,
        });
        return {
          dev, tasks, states, materialGate, hasBranding,
          // Общий цех ещё не закрыл нанесение — с шага «Нанесения» не выпускаем
          brandingOpen: brandingOpenByDev?.get(dev.id) === true,
          column: devBoardColumn(states, dev), today, typeNames,
        };
      });
    return DEV_STAGE_ORDER.map((stage) => ({
      stage,
      lanes: LANES.map((lane) => ({
        lane,
        rows: prepared.filter((r) => r.column === stage && laneOf(r, stage) === lane),
      })).filter((l) => l.rows.length > 0),
      total: prepared.filter((r) => r.column === stage).length,
    }));
  }, [rows, today, materialsByOrder, supplyOpenByOrder, brandingByItem,
    brandingOpenByDev, typeNames]);

  return (
    <div className={styles.kanbanBoard} ref={ref}>
      {columns.map((col) => (
        <section
          key={col.stage}
          className={[styles.kanbanCol, overStage === col.stage && styles.kanbanColDroppable]
            .filter(Boolean).join(' ')}
          /* `preventDefault` на dragOver обязателен — без него браузер
             не считает область принимающей и `drop` не приходит вовсе */
          onDragOver={(e) => {
            if (!dragRef.current) return;
            e.preventDefault();
            setOverStage(col.stage);
          }}
          onDragLeave={() => setOverStage((s) => (s === col.stage ? null : s))}
          onDrop={(e) => dropOn(e, col.stage)}
        >
          {/* Разметка колонки — та же, что у общего борда: «по тому же
              принципу» из документа означает и то, как это выглядит */}
          <header className={styles.kanbanColHead}>
            {DEV_STAGE_LABELS[col.stage]}
            <span className={styles.deptTabCount}>{col.total}</span>
          </header>

          {col.total === 0 ? (
            <p className={styles.subText}>—</p>
          ) : col.lanes.map((l) => (
            <div key={l.lane} className={styles.kanbanLane}>
              <div className={styles.kanbanLaneTitle}>
                {DEV_LANE_TITLES[l.lane]} · {l.rows.length}
              </div>
              {l.rows.map((r) => (
                <DevBoardCard
                  key={r.dev.id}
                  row={r}
                  onOpen={onOpen}
                  onMove={move}
                  canManage={canManage}
                  dragging={dragId === r.dev.id}
                  onDragStart={startDrag}
                  onDragEnd={endDrag}
                />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
