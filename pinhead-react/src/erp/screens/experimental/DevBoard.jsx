import { useMemo } from 'react';
import { Icon } from '../../components/Icon';
import { OrderLink } from '../../components/OrderLink';
import { StageIndicator } from '../../components/StageIndicator';
import { useScrollHints } from '../../../hooks/useScrollHints';
import {
  DEV_LANE_TITLES,
  DEV_STAGE_LABELS,
  DEV_STAGE_ORDER,
  devBoardColumn,
  devStageStates,
} from '../../utils/experimentalBoard';
import { currentBlocker, nextAction, taskLabel } from '../../utils/experimentalTasks';
import { dueLabelCompact } from '../../utils/format';
import { daysLeft } from '../../utils/time';
import styles from '../../styles';

/**
 * Доска экспериментального цеха по этапам (правки заказчика 20.08).
 *
 * «Главный экран должен быть построен по этапам, по тому же принципу, как
 * сейчас выглядит общий производственный борд… Разработка перемещается между
 * этапами по мере выполнения работ».
 *
 * ПЕРЕТАСКИВАНИЯ ЗДЕСЬ НЕТ, и это не упущение. На общем борде карточку тянут,
 * потому что у этапа есть записываемый статус; здесь колонка ВЫЧИСЛЯЕТСЯ
 * из задач, и перетаскивание означало бы либо ложь (карточка уехала, а работа
 * нет), либо возврат хранимой фазы, которую убрали 12.08. Разработка
 * переезжает потому, что закрылась задача.
 */

/** Дорожки в порядке борда: сначала то, что стоит, потом то, что идёт */
const LANES = ['blocked', 'awaiting_materials', 'waiting', 'ready', 'in_progress', 'done'];

const LANE_CHIP = {
  blocked: 'chipBlocked',
  awaiting_materials: 'chipWaiting',
  waiting: 'chipNeutral',
  ready: 'chipReady',
  in_progress: 'chipProgress',
  done: 'chipDone',
};

function DevBoardCard({ row, onOpen }) {
  const { dev, tasks, states, column, typeNames } = row;
  const state = states.find((s) => s.stage === column);
  // Подписи задач берутся из справочника: без него человек читает код
  // (`начать patterns`) — то же правило, что в строке списка
  const blocker = currentBlocker(tasks, typeNames, row.today);
  const action = nextAction(dev, tasks, typeNames, row.today);
  const due = dev.due_date || dev.order?.due_date || null;
  const left = daysLeft(due);
  const overdue = left !== null && left < 0 && !dev.outcome;

  return (
    <button
      type="button"
      className={styles.kanbanCard}
      onClick={() => onOpen(dev.id)}
      aria-label={`Открыть разработку ${dev.tech_name || dev.order?.title || ''}`}
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
    </button>
  );
}

export function DevBoard({ rows, today, onOpen, materialsByOrder, typeNames }) {
  const { ref } = useScrollHints();

  const columns = useMemo(() => {
    const prepared = rows.map(({ dev, tasks }) => {
      const states = devStageStates({
        dev,
        tasks,
        materials: materialsByOrder?.get(dev.order_id) ?? [],
      });
      return {
        dev, tasks, states, column: devBoardColumn(states, dev), today, typeNames,
      };
    });
    return DEV_STAGE_ORDER.map((stage) => ({
      stage,
      lanes: LANES.map((lane) => ({
        lane,
        rows: prepared.filter(
          (r) => r.column === stage
            && (r.states.find((s) => s.stage === stage)?.lane ?? 'waiting') === lane,
        ),
      })).filter((l) => l.rows.length > 0),
      total: prepared.filter((r) => r.column === stage).length,
    }));
  }, [rows, today, materialsByOrder, typeNames]);

  return (
    <div className={styles.kanbanBoard} ref={ref}>
      {columns.map((col) => (
        <section key={col.stage} className={styles.kanbanCol}>
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
                <DevBoardCard key={r.dev.id} row={r} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
