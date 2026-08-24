import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AttachmentList } from '../../components/AttachmentList';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DateField } from '../../components/DateField';
import { ScrollHintBox } from '../../components/ScrollHintBox';
import { confirm } from '../../../store/useConfirmStore';
import { DEV_TASK_STATUS_LABELS } from '../../types';
import {
  isDelegated, taskGroup, taskLabel, taskWaitingReason,
} from '../../utils/experimentalTasks';
import { formatDateShort } from '../../utils/time';
import styles from '../../styles';

/**
 * Доска задач разработки — ОСНОВНОЙ рабочий блок карточки (ТЗ п.13).
 *
 * Задачи параллельны и необязательны, поэтому это список, а не цепочка:
 * порядок строк ничего не предписывает, работать можно с любой готовой.
 *
 * Задача, переданная в цех, показывается ТОЛЬКО на чтение: её статус ведёт
 * триггер `erp_experimental_task_sync`, и кнопка «Готово» здесь означала бы
 * второго писателя одной колонки. Вместо кнопок — ссылка на само задание,
 * где работает цех.
 */

const GROUP_VARIANT = {
  blocked: 'blocked',
  in_progress: 'progress',
  waiting: 'waiting',
  ready: 'info',
  done: 'ready',
  cancelled: 'skipped',
};

/** Что можно сделать с задачей вручную: переходы простые, как просит ТЗ п.12 */
const NEXT_STATUS = {
  todo: [{ to: 'in_progress', label: 'Начать' }],
  ready: [{ to: 'in_progress', label: 'Начать' }],
  in_progress: [
    { to: 'done', label: 'Готово', variant: 'primary' },
    { to: 'blocked', label: 'Заблокировать' },
  ],
  blocked: [{ to: 'in_progress', label: 'Снять блокировку' }],
};

/**
 * Файлы одной задачи (п. 4.4). Свой маленький компонент, а не разметка внутри
 * строки: у него собственное состояние загрузки, и держать его в строке значит
 * перерисовывать её целиком на каждый выбор файла.
 */
function TaskFiles({ task, files, canManage, onUpload, onRemove, name }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const mine = (files ?? []).filter((f) => f.task_id === task.id);

  const pick = async (e) => {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = '';
    if (chosen.length === 0) return;
    setBusy(true);
    for (const file of chosen) await onUpload(task.id, file);
    setBusy(false);
  };

  const remove = async (att) => {
    const ok = await confirm({
      title: 'Снять файл?',
      message: `«${att.file_name || 'файл'}» будет удалён вместе с самим файлом.`,
      confirmLabel: 'Снять',
      variant: 'danger',
    });
    if (ok) await onRemove(att.id);
  };

  return (
    <div className={styles.attachBlock}>
      <div className={styles.checkRow}>
        <span className={styles.fieldLabel}>Файлы</span>
        {mine.length === 0 && <span className={styles.subText}>не приложены</span>}
        {canManage && (
          <Button
            variant="ghost"
            size="sm"
            icon="paperclip"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Загрузка…' : 'Приложить'}
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={pick}
        aria-label={`Файл к задаче «${name}»`}
        style={{ display: 'none' }}
      />
      <AttachmentList files={mine} />
      {canManage && mine.length > 0 && (
        <div className={styles.checkRow}>
          {mine.map((f) => (
            <Button key={f.id} variant="ghost" size="sm" onClick={() => remove(f)}>
              ✕ {f.file_name || 'файл'}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({
  task, all, typeNames, deptNames, onUpdate, onSend, onBlock, canManage,
  files, onUploadFile, onRemoveFile,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const group = taskGroup(task, all);
  const delegated = isDelegated(task);
  const reason = taskWaitingReason(task, all, typeNames, deptNames, task.department_id);
  // Кнопки берём по ГРУППЕ, а не по сырому статусу: «не начата, но ждёт
  // зависимость» и «не начата и готова» — разные предложения человеку
  const actions = delegated ? [] : (NEXT_STATUS[group] ?? []);

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } finally { setBusy(false); }
  };

  return (
    <>
      <tr className={styles.rowClickable} onClick={() => setOpen((v) => !v)}>
        <td>
          <strong>{taskLabel(task, typeNames)}</strong>
          {task.cycle > 0 && (
            // Повторная примерка — новая строка со своим кругом, а не счётчик
            <span className={styles.subText}> · круг {task.cycle + 1}</span>
          )}
          {reason && <div className={styles.subText}>{reason}</div>}
        </td>
        <td>{task.responsible || <span className={styles.subText}>не назначен</span>}</td>
        <td>{task.due_date ? formatDateShort(task.due_date) : '—'}</td>
        <td>
          <Badge variant={GROUP_VARIANT[group]}>{DEV_TASK_STATUS_LABELS[task.status]}</Badge>
          {delegated && task.stage_id && (
            <div className={styles.subText}>
              <Link to={`/task/${task.stage_id}`} onClick={(e) => e.stopPropagation()}>
                задание цеха
              </Link>
            </div>
          )}
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          <div className={styles.queueActions}>
            {canManage && actions.map((a) => (
              <Button
                key={a.to}
                variant={a.variant ?? 'secondary'}
                disabled={busy}
                onClick={() => (a.to === 'blocked'
                  ? onBlock(task)
                  : run(() => onUpdate(task.id, { status: a.to })))}
              >
                {a.label}
              </Button>
            ))}
            {canManage && !delegated && group !== 'done' && group !== 'cancelled' && (
              <Button variant="ghost" disabled={busy} onClick={() => onSend(task)}>
                В цех
              </Button>
            )}
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={5} className={styles.tzBlock}>
            <div className={styles.formGrid}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Ответственный</span>
                <input
                  className={styles.input}
                  defaultValue={task.responsible || ''}
                  disabled={!canManage}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (task.responsible || null)) onUpdate(task.id, { responsible: v });
                  }}
                  aria-label={`Ответственный за «${taskLabel(task, typeNames)}»`}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Срок</span>
                <DateField
                  value={task.due_date || ''}
                  disabled={!canManage}
                  onChange={(v) => onUpdate(task.id, { due_date: v || null })}
                  aria-label={`Срок «${taskLabel(task, typeNames)}»`}
                />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span className={styles.fieldLabel}>Комментарий</span>
                <textarea
                  className={styles.input}
                  rows={2}
                  defaultValue={task.comment || ''}
                  disabled={!canManage}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (task.comment || null)) onUpdate(task.id, { comment: v });
                  }}
                  aria-label={`Комментарий к «${taskLabel(task, typeNames)}»`}
                />
              </label>
              <label className={`${styles.field} ${styles.fieldWide}`}>
                <span className={styles.fieldLabel}>Результат</span>
                <textarea
                  className={styles.input}
                  rows={2}
                  defaultValue={task.result || ''}
                  disabled={!canManage}
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (task.result || null)) onUpdate(task.id, { result: v });
                  }}
                  aria-label={`Результат «${taskLabel(task, typeNames)}»`}
                />
              </label>
            </div>
            {/*
              ФАЙЛ ПРИ НЕОБХОДИМОСТИ (правка 24.08, п. 4.4). Блок стоит внутри
              РАСКРЫТОЙ строки, а не в общем списке вложений разработки: файл
              относится к одной задаче («фото пробного нанесения»), и сваленный
              в общую кучу он перестаёт отвечать на вопрос, к чему он.
            */}
            {onUploadFile && (
              <TaskFiles
                task={task}
                files={files}
                canManage={canManage}
                onUpload={onUploadFile}
                onRemove={onRemoveFile}
                name={taskLabel(task, typeNames)}
              />
            )}

            {delegated && (
              <p className={styles.subText}>
                Задача выполняется в цехе. Её статус ведёт само задание —
                здесь он только показывается.
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * `allTasks` — ПОЛНЫЙ список задач разработки, а `tasks` — та группа, которую
 * рисует этот экземпляр (правка 22.08, п. 4.7: этапные и дополнительные задачи
 * показываются раздельно).
 *
 * Разделять их обязательно: `taskGroup` и `taskWaitingReason` разрешают
 * `depends_on`, и по подмножеству зависимость из другой группы выглядела бы
 * несуществующей — задача молча считалась бы готовой.
 */
/** Задача закрыта: сделана или отменена */
const CLOSED_STATUS = new Set(['done', 'cancelled']);

export function DevTasksSection({
  tasks, allTasks, typeNames, deptNames, onUpdate, onSend, onBlock, canManage,
  emptyText, files, onUploadFile, onRemoveFile,
}) {
  const list = useMemo(
    () => [...(tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order), [tasks]);
  const all = useMemo(
    () => [...(allTasks ?? tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [allTasks, tasks]);

  /**
   * АКТИВНЫЕ И ЗАВЕРШЁННЫЕ — ОТДЕЛЬНО (правка 24.08, п. 4.4: «отдельно
   * показывать активные и завершённые задачи»). Разработка живёт неделями,
   * задач набирается два десятка, и закрытые вытесняли работу вниз экрана:
   * список отвечал на вопрос «что было», а нужен ответ «что делать».
   *
   * Завершённые СВЁРНУТЫ, но их видно и число известно: спрятанные насовсем,
   * они бы стали недостижимой историей — той самой, ради которой документ
   * и просит «историю изменений и доработок сохранять внутри карточки».
   */
  const active = useMemo(() => list.filter((t) => !CLOSED_STATUS.has(t.status)), [list]);
  const closed = useMemo(() => list.filter((t) => CLOSED_STATUS.has(t.status)), [list]);

  if (list.length === 0) {
    return (
      <p className={styles.subText}>
        {emptyText ?? `Задач пока нет. Разработка не обязана проходить одинаковые
          пять этапов — добавьте только те задачи, которые нужны этому изделию.`}
      </p>
    );
  }

  const table = (rows, label) => (
    <ScrollHintBox className={styles.tableWrap} label={label}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Задача</th>
            <th>Ответственный</th>
            <th>Срок</th>
            <th>Статус</th>
            <th>Действие</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              all={all}
              typeNames={typeNames}
              deptNames={deptNames}
              onUpdate={onUpdate}
              onSend={onSend}
              onBlock={onBlock}
              canManage={canManage}
              files={files}
              onUploadFile={onUploadFile}
              onRemoveFile={onRemoveFile}
            />
          ))}
        </tbody>
      </table>
    </ScrollHintBox>
  );

  return (
    <>
      {active.length > 0
        ? table(active, 'Активные задачи')
        : <p className={styles.subText}>Активных задач нет — всё закрыто.</p>}

      {closed.length > 0 && (
        <details className={styles.matSection}>
          <summary>Завершённые задачи ({closed.length})</summary>
          {table(closed, 'Завершённые задачи')}
        </details>
      )}
    </>
  );
}
