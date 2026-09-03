import { useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { formatDateShort } from '../../utils/time';
import { DEV_TASK_STATUS_LABELS } from '../../types';
import {
  DEV_LANE_TITLES, DEV_STAGE_LABELS, devStageAction,
} from '../../utils/experimentalBoard';
import { isDelegated, isTaskReady, taskLabel } from '../../utils/experimentalTasks';
import { finalPackageProgress, missingFinalPackage } from '../../utils/finalPackage';
import { confirmWithInput } from '../../../store/useConfirmStore';
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
  // «Не требуется» выглядит как пропущенный — но называется честно
  not_applicable: 'skipped',
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
/**
 * Работа финального этапа — сборка технического пакета.
 *
 * Собран целиком — говорим это прямо и ведём к кнопке завершения: пустое место
 * на закрытом шаге читалось бы как «ещё что-то нужно».
 */
function FinalPackageWork({ dev, attachments, onOpen }) {
  const missing = missingFinalPackage(dev, attachments);
  const progress = finalPackageProgress(dev, attachments);
  return (
    <div className={styles.stackTight}>
      <div className={styles.subText}>
        Финальный пакет: собрано {progress.done} из {progress.total}
      </div>
      {missing.length > 0 ? (
        <ul className={styles.stackTight}>
          {missing.map((m) => (
            <li key={m} className={styles.subText}>· {m}</li>
          ))}
        </ul>
      ) : (
        <div className={styles.subText}>
          <Icon name="check" size={13} /> Пакет собран — разработку можно завершать.
        </div>
      )}
      {onOpen && (
        <Button variant="secondary" size="sm" onClick={onOpen}>
          {missing.length > 0 ? 'Собрать финальный пакет' : 'Открыть финальный пакет'}
        </Button>
      )}
    </div>
  );
}

export function DevStageRoute({
  states, currentStage, tasks, typeNames, onUpdateTask, canManage,
  dev, attachments, onOpenPackage,
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
   *
   * РЕЗУЛЬТАТ ЭТАПА (правка 23.08, п. 7): «дать отдельный блок „Результат
   * этапа": описание результата, комментарий, ответственный, дата». Он
   * спрашивается ЗДЕСЬ, одним действием с завершением, и пишется в поле
   * `result` каждой закрываемой задачи — туда же, куда его пишет проверка
   * образца. Отдельная форма рядом с кнопкой была бы вторым механизмом,
   * который можно не заполнить: правило проекта про необязательный шаг,
   * которым за полтора месяца не воспользовались ни разу.
   *
   * У ЭТАПА `patterns` РЕЗУЛЬТАТ НЕ СПРАШИВАЕТСЯ (правка заказчика 30.08,
   * п. 3): «открыть ОДНО окно подтверждения с обязательным полем
   * „Техническое название лекал". Отдельный ввод свободного текста „Результат
   * этапа" не показывать».
   *
   * Прежний комментарий здесь утверждал, что `patterns` этой веткой не задет,
   * и это было НЕПРАВДОЙ: `completeStage` спрашивал результат у любого этапа,
   * а `DevCard.updateTask` тут же открывал ВТОРОЕ окно с техническим
   * названием — два диалога подряд на одно действие. Пока обязательных задач
   * не создаётся, путь спит, но оживает от одной задачи `patterns`,
   * заведённой руками.
   *
   * Название лекал по-прежнему требует `DevCard.updateTask` — оно пишется
   * в колонку финального пакета, а не в результат задачи.
   */
  const completeStage = async (state) => {
    const rows = movable(state);
    const delegated = state.tasks.filter(
      (t) => isDelegated(t) && t.status !== 'done' && t.status !== 'cancelled',
    );
    if (delegated.length > 0) return;
    const asksResult = state.stage !== 'patterns';
    const { ok, value } = await confirmWithInput({
      title: `Завершить этап «${DEV_STAGE_LABELS[state.stage]}»?`,
      message: rows.length > 0
        ? `Будут отмечены готовыми: ${rows.map((t) => taskLabel(t, typeNames)).join(', ')}.`
          + ' После завершения карточка перейдёт к следующему этапу маршрута.'
        : 'Все задачи этапа уже закрыты.',
      confirmLabel: 'Завершить',
      ...(asksResult ? {
        prompt: {
          label: 'Результат этапа',
          placeholder: 'Выкроены все детали, расход в норме, брак не выявлен',
          // Необязателен: этап без описания завершить всё равно можно —
          // иначе цех начнёт писать «ок», и поле перестанет что-либо значить
          required: false,
        },
      } : {}),
    });
    if (!ok) return;
    setBusy(true);
    const result = (value ?? '').trim();
    for (const t of rows) {
      await onUpdateTask(t.id, result ? { status: 'done', result } : { status: 'done' });
    }
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
              {/* «Текущий этап: …» — прямое требование п. 7: маршрут должен
                  читаться с первого экрана, без поиска действия внизу */}
              <strong>
                {isCurrent ? `Текущий этап: ${DEV_STAGE_LABELS[state.stage]}` : DEV_STAGE_LABELS[state.stage]}
              </strong>
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

            {/*
              Зафиксированный результат ЗАВЕРШЁННОГО этапа виден, а не спрятан
              в истории: без него блок «Результат этапа» был бы полем, которое
              заполняют и больше никогда не читают.
            */}
            {state.lane === 'done' && (
              <ul className={styles.stackTight}>
                {state.tasks.filter((t) => t.result).map((t) => (
                  <li key={t.id} className={styles.subText}>
                    <Icon name="check" size={13} /> {t.result}
                    {t.done_on ? ` · ${formatDateShort(t.done_on)}` : ''}
                    {t.responsible ? ` · ${t.responsible}` : ''}
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
                {/*
                  ФИНАЛЬНЫЙ ПАКЕТ ВИДЕН НА СВОЁМ ШАГЕ (правка заказчика 01.09,
                  вторая итерация, п. 5): «после перехода на Финальный этап
                  пропала карточка финального пакета… на Финальном этапе должна
                  появляться работа по финальному пакету».

                  Форма пакета никуда не девалась — она на вкладке «Финальный
                  пакет». Пропало другое: на самом шаге стояла серая строка
                  «Задач этапа нет — заведите работу этого этапа», и она
                  читается как «работы здесь нет вовсе». Показываем ту же
                  работу словами: чего не хватает и сколько собрано.

                  ВТОРОЙ ФОРМЫ НЕ ЗАВОДИТСЯ. Перечень считает `utils/finalPackage`
                  — та же функция, что питает кнопку «Завершить разработку»
                  и серверного стража `erp_dev_package_guard`; человек читает
                  один список в трёх местах, а не три разных.
                */}
                {state.stage === 'final' && dev && (
                  <FinalPackageWork
                    dev={dev}
                    attachments={attachments}
                    onOpen={onOpenPackage}
                  />
                )}
                {state.stage !== 'final'
                  && !action.key && delegated.length === 0 && action.reason && (
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
