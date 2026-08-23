import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DEV_TASK_STATUS_LABELS } from '../../types';
import {
  DEV_LANE_TITLES, DEV_STAGE_LABELS, devStageAction,
} from '../../utils/experimentalBoard';
import { isDelegated, isTaskReady, taskLabel } from '../../utils/experimentalTasks';
import { confirm } from '../../../store/useConfirmStore';
import styles from '../../styles';

/** Дорожка шага → вид бейджа: те же слова, что на доске */
const LANE_VARIANT = {
  waiting: 'waiting',
  awaiting_materials: 'waiting',
  ready: 'info',
  in_progress: 'progress',
  blocked: 'blocked',
  done: 'ready',
  skipped: 'skipped',
};

/**
 * ОСНОВНОЙ МАРШРУТ РАЗРАБОТКИ (правки заказчика 22.08, пп. 4.3, 4.7, 4.12).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Внутри карточки нужно явно разделить два блока:
 * основной маршрут разработки… и дополнительные задачи. Пользователь должен
 * сразу понимать, что верхний блок отвечает за движение разработки
 * по канбану, а нижний блок является внутренним списком работ».
 *
 * ЧТО БЫЛО. Все задачи лежали одним списком, а пять ключевых этапов
 * показывались только полоской-индикатором сверху — то есть связь «эта
 * задача двигает разработку, а эта нет» приходилось держать в голове.
 * Отсюда и ощущение, что «канбан и список задач конкурируют друг с другом».
 *
 * ВТОРОЙ МЕХАНИКИ ЗДЕСЬ НЕТ, и это тоже требование документа. Состояния
 * шагов считает `devStageStates` — та же функция, что рисует доску (п. 4.15:
 * «пользователь должен одинаково понимать текущий этап на канбане и внутри
 * карточки»). Кнопка не заводит собственных переходов: она меняет статусы
 * задач шага тем же `updateDevTask`, которым технолог двигает их поштучно.
 *
 * ДЕЛЕГИРОВАННУЮ В ЦЕХ ЗАДАЧУ КНОПКА НЕ ТРОГАЕТ: её статус ведёт триггер
 * `erp_experimental_task_sync`, и запись отсюда была бы вторым писателем
 * одной колонки.
 */
export function DevStageRoute({
  states, currentStage, tasks, typeNames, onUpdateTask, canManage,
}) {
  const [busy, setBusy] = useState(false);

  /** Задачи шага, которые двигаются вручную (не ушедшие в цех и не закрытые) */
  const movable = (state) => state.tasks.filter(
    (t) => !isDelegated(t) && t.status !== 'done' && t.status !== 'cancelled',
  );

  const startStage = async (state) => {
    const rows = movable(state).filter((t) => isTaskReady(t, tasks) && t.status !== 'in_progress');
    if (rows.length === 0) return;
    setBusy(true);
    for (const t of rows) await onUpdateTask(t.id, { status: 'in_progress' });
    setBusy(false);
  };

  /**
   * Завершение этапа перечисляет, что именно закроется. Молча закрыть чужие
   * задачи нельзя — правило проекта про необратимые действия: последствия
   * называются текстом до нажатия.
   */
  const completeStage = async (state) => {
    const rows = movable(state);
    const delegated = state.tasks.filter(
      (t) => isDelegated(t) && t.status !== 'done' && t.status !== 'cancelled',
    );
    if (delegated.length > 0) return;
    const ok = await confirm({
      title: `Завершить этап «${DEV_STAGE_LABELS[state.stage]}»?`,
      message: rows.length > 0
        ? `Будут отмечены готовыми: ${rows.map((t) => taskLabel(t, typeNames)).join(', ')}.`
        : 'Все задачи этапа уже закрыты.',
      confirmLabel: 'Завершить',
    });
    if (!ok) return;
    setBusy(true);
    for (const t of rows) await onUpdateTask(t.id, { status: 'done' });
    setBusy(false);
  };

  return (
    <div className={styles.stackTight}>
      {states.map((state) => {
        const isCurrent = state.stage === currentStage;
        const action = devStageAction(state);
        const delegated = state.tasks.filter(
          (t) => isDelegated(t) && t.status !== 'done' && t.status !== 'cancelled',
        );

        return (
          <div
            key={state.stage}
            className={isCurrent ? styles.tzBlock : styles.stackTight}
            style={isCurrent ? undefined : { opacity: 0.75 }}
          >
            <div className={styles.checkRow}>
              <strong>{DEV_STAGE_LABELS[state.stage]}</strong>
              <Badge variant={LANE_VARIANT[state.lane] ?? 'neutral'}>
                {DEV_LANE_TITLES[state.lane]}
              </Badge>
              {state.waitingReason && (
                <span className={styles.subText}>{state.waitingReason}</span>
              )}
            </div>

            {/*
              Обязательные работы ТЕКУЩЕГО этапа видны прямо здесь (п. 4.12):
              «в карточке должно быть явно видно, какие обязательные работы
              относятся к текущему ключевому этапу и выполнены ли они».
              У одного этапа их бывает несколько — DTG и вышивка в нанесениях
              идут параллельно и колонок себе не заводят (п. 4.8).
            */}
            {isCurrent && state.tasks.length > 0 && (
              <ul className={styles.stackTight}>
                {state.tasks.map((t) => (
                  <li key={t.id} className={styles.subText}>
                    {taskLabel(t, typeNames)} — {DEV_TASK_STATUS_LABELS[t.status]}
                    {t.responsible ? ` · ${t.responsible}` : ''}
                    {isDelegated(t) ? ' · передано в цех' : ''}
                  </li>
                ))}
              </ul>
            )}

            {isCurrent && canManage && (
              <div className={styles.queueActions}>
                {action.key && delegated.length === 0 && (
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => (action.key === 'start'
                      ? startStage(state)
                      : completeStage(state))}
                  >
                    {action.label}
                  </Button>
                )}
                {delegated.length > 0 && (
                  <span className={styles.subText}>
                    Ждём цех: {delegated.map((t) => taskLabel(t, typeNames)).join(', ')} —
                    статус ведёт само задание.
                  </span>
                )}
                {!action.key && delegated.length === 0 && action.reason && (
                  <span className={styles.subText}>{action.reason}</span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
