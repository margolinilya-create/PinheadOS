import { useState } from 'react';
import { useErpStore } from '../../store/useErpStore';
import { Button } from '../../components/Button';
import { BizTaskActionDialog } from './BizTaskActionDialog';
import { BizTaskDueDialog } from './BizTaskDueDialog';
import { BizTaskPeopleDialog } from './BizTaskPeopleDialog';
import { BizTaskEditDialog } from './BizTaskEditDialog';
import { DIRECT_TRANSITIONS, TRANSITION_LABELS, TRANSITION_ORDER, actionDialogText } from './bizTaskCardView';
import styles from './BizTaskCard.module.css';

/** Главные кнопки исполнителя и проверяющего — `primary`, отмена — `danger` */
const PRIMARY = new Set(['start', 'resume', 'complete', 'submit', 'accept']);

/**
 * КНОПКИ КАРТОЧКИ ЗАДАЧИ — ровно то, что дал `bizTaskActions` (зеркало
 * писателей T2): кнопка, которой писатель откажет 42501, хуже отсутствующей.
 *
 * Переходы без текста («Взять в работу», «Возобновить», «Принять») —
 * одним нажатием; остальные — диалогом с обязательным текстом. Правки
 * («Перенести срок», «Сменить ответственного», наблюдатели, описание) —
 * своими диалогами. Без оптимистики: статус меняет ответ писателя.
 */
export function BizTaskActions({ task, detail, actions, people }) {
  const transition = useErpStore((s) => s.bizTaskTransition);
  const update = useErpStore((s) => s.updateBizTask);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(null);
  const close = () => setDialog(null);

  const run = async (action, text) => Boolean(await transition(task.id, action, text));
  const save = async (patch) => Boolean(await update(task.id, patch));

  const press = async (action) => {
    if (!DIRECT_TRANSITIONS.includes(action)) {
      setDialog(action);
      return;
    }
    setBusy(action);
    await run(action, null);
    setBusy(null);
  };

  const transitions = TRANSITION_ORDER.filter((a) => actions.includes(a));
  const dialogText = dialog ? actionDialogText(dialog, detail.checklist) : null;

  return (
    <>
      {transitions.length > 0 && (
        <div className={styles.actions}>
          {transitions.map((a) => (
            <Button
              key={a}
              variant={PRIMARY.has(a) ? 'primary' : a === 'cancel' ? 'danger' : 'secondary'}
              loading={busy === a}
              disabled={busy !== null && busy !== a}
              onClick={() => press(a)}
            >
              {TRANSITION_LABELS[a]}
            </Button>
          ))}
        </div>
      )}
      <div className={styles.actions}>
        {actions.includes('change_due') && (
          <Button size="sm" icon="clock" onClick={() => setDialog('due')}>Перенести срок</Button>
        )}
        {actions.includes('assignee') && (
          <Button size="sm" icon="user" onClick={() => setDialog('assignee')}>Сменить ответственного</Button>
        )}
        {actions.includes('watchers') && (
          <Button size="sm" icon="users" onClick={() => setDialog('watchers')}>Изменить наблюдателей</Button>
        )}
        {actions.includes('edit') && (
          <Button size="sm" icon="pencil" onClick={() => setDialog('edit')}>Изменить описание</Button>
        )}
      </div>

      {dialogText && (
        <BizTaskActionDialog
          text={dialogText}
          initial={dialog === 'complete' || dialog === 'submit' ? task.result_text ?? '' : ''}
          onConfirm={(text) => run(dialog, text)}
          onClose={close}
        />
      )}
      {dialog === 'due' && <BizTaskDueDialog dueAt={task.due_at} onConfirm={save} onClose={close} />}
      {(dialog === 'assignee' || dialog === 'watchers') && (
        <BizTaskPeopleDialog
          mode={dialog}
          task={task}
          watchers={detail.watchers}
          people={people}
          onConfirm={save}
          onClose={close}
        />
      )}
      {dialog === 'edit' && <BizTaskEditDialog task={task} onConfirm={save} onClose={close} />}
    </>
  );
}
