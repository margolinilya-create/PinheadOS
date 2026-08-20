import { useMemo, useState } from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { DateField } from '../../components/DateField';
import { DictionaryDatalist } from '../../components/DictionaryDatalist';
import { ReadOnlyFieldset } from '../../components/ReadOnlyFieldset';
import { useDictionary } from '../../store/useDictionary';
import { OrderLink } from '../../components/OrderLink';
import { confirm, confirmWithInput } from '../../../store/useConfirmStore';
import { toast } from '../../../store/useToastStore';
import { DEV_OUTCOME_LABELS } from '../../types';
import {
  currentBlocker, devReadiness, nextAction, reworkHistory, taskLabel,
} from '../../utils/experimentalTasks';
import { deptShortName, isProductionDept } from '../../data/departments';
import { formatDateShort } from '../../utils/time';
import { factoryToday } from '../../../utils/date';
import { DevTasksSection } from './DevTasksSection';
import { DevSendToDept } from './DevSendToDept';
import { DevSampleCheck } from './DevSampleCheck';
import { DevFinalPackage } from './DevFinalPackage';
import styles from '../../erp.module.css';

/**
 * Карточка разработки (ТЗ заказчика 12.08, п.12–14).
 *
 * Пять взаимоисключающих веток по `exp.phase` из прежней карточки удалены —
 * это и была линейная модель, которую заказчик отверг. Здесь всегда видно
 * одно и то же: кто ведёт, готовность, текущий блокер, следующее действие
 * и доска задач.
 *
 * Чего здесь НЕТ намеренно:
 *  · автоматической передачи образца в общий швейный цех (ТЗ п.6) — пошив
 *    образца это обычная задача, а передача в цех отдельное действие над ней;
 *  · «возврата конструктору» как фазы (п.8) — это РЕЗУЛЬТАТ примерки, и он
 *    заводит новые задачи с новым кругом;
 *  · автосоздания производственного заказа при «Готово к серии» (п.9) —
 *    решение заказчика: заказ заводит менеджер.
 */

function AddTaskForm({ typeItems, onAdd, tasks }) {
  const [type, setType] = useState('');
  const [title, setTitle] = useState('');
  const [responsible, setResponsible] = useState('');
  const [due, setDue] = useState('');
  const [dependsOn, setDependsOn] = useState([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!type.trim()) { toast.error('Выберите тип задачи'); return; }
    setBusy(true);
    /**
     * Зависимости на СУЩЕСТВУЮЩИЕ задачи передаются id, а не индексами:
     * индексы в RPC адресуют элементы этой же пачки, а здесь пачка из одной
     * задачи. Поэтому связь дописывается вторым шагом — иначе пришлось бы
     * усложнять контракт ради единственного случая.
     */
    const rows = await onAdd([{
      task_type: type.trim(),
      title: title.trim() || null,
      responsible: responsible.trim() || null,
      due_date: due || null,
    }], dependsOn);
    setBusy(false);
    if (rows) { setType(''); setTitle(''); setResponsible(''); setDue(''); setDependsOn([]); }
  };

  const openTasks = tasks.filter((t) => t.status !== 'cancelled');

  return (
    <div className={styles.formGrid}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Тип задачи</span>
        {/* Справочник — подсказка поверх свободного ввода (правило проекта) */}
        <DictionaryDatalist kind="experimental_task_type" id="erp-dev-task-types" />
        <input
          className={styles.input}
          value={type}
          list="erp-dev-task-types"
          onChange={(e) => setType(e.target.value)}
          placeholder="Лекала, Подбор материала, Примерка…"
          aria-label="Тип задачи"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Уточнение</span>
        <input
          className={styles.input}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Доработка лекал: рукав +2 см"
          aria-label="Название задачи"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Ответственный</span>
        <input
          className={styles.input}
          value={responsible}
          onChange={(e) => setResponsible(e.target.value)}
          aria-label="Ответственный за задачу"
        />
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Срок</span>
        <DateField value={due} onChange={setDue} aria-label="Срок задачи" />
      </label>
      {openTasks.length > 0 && (
        <label className={`${styles.field} ${styles.fieldWide}`}>
          <span className={styles.fieldLabel}>Зависит от (необязательно)</span>
          <div className={styles.checkRow}>
            {openTasks.map((t) => (
              <label key={t.id} className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={dependsOn.includes(t.id)}
                  onChange={(e) => setDependsOn((prev) => (e.target.checked
                    ? [...prev, t.id]
                    : prev.filter((x) => x !== t.id)))}
                />
                {taskLabel(t, typeItems)}
              </label>
            ))}
          </div>
        </label>
      )}
      <div className={styles.modalActions}>
        <Button variant="primary" disabled={busy} onClick={submit}>+ Добавить задачу</Button>
      </div>
    </div>
  );
}

export function DevCard({
  dev, order, departments, canManage,
  onUpdate, onAddTasks, onUpdateTask, onSendTask, onClose,
  onApproveSample, onUploadFile, onRemoveFile,
}) {
  const typeDict = useDictionary('experimental_task_type');
  const typeNames = useMemo(
    () => new Map((typeDict ?? []).map((d) => [d.code, d.name])), [typeDict]);
  const deptNames = useMemo(
    () => new Map((departments ?? []).map((d) => [d.id, deptShortName(d.code, d.name)])),
    [departments]);

  const tasks = dev.tasks ?? [];
  const today = factoryToday();
  const readiness = devReadiness(tasks);
  const blocker = currentBlocker(tasks, typeNames, today);
  const action = nextAction(dev, tasks, typeNames, today);
  const history = reworkHistory(tasks);

  const shops = useMemo(
    () => (departments ?? []).filter((d) => d.active && isProductionDept(d)),
    [departments]);
  /** Задача, для которой открыта форма передачи в цех */
  const [sendFor, setSendFor] = useState(null);

  /** Добавление задачи + необязательная связь с уже существующими */
  const addTasks = async (rows, dependsOnIds = []) => {
    const created = await onAddTasks(rows);
    if (created && created.length > 0 && dependsOnIds.length > 0) {
      await onUpdateTask(created[0].id, { depends_on: dependsOnIds });
    }
    return created;
  };

  const blockTask = async (task) => {
    const { ok, value } = await confirmWithInput({
      title: `Заблокировать «${taskLabel(task, typeNames)}»?`,
      message: 'Задача остановится, пока блокировку не снимут. Причина видна в карточке.',
      confirmLabel: 'Заблокировать',
      variant: 'danger',
      prompt: { label: 'Чего не хватает', placeholder: 'Нет ткани / нет решения по цвету', required: true },
    });
    if (ok) await onUpdateTask(task.id, { status: 'blocked', blocked_reason: value });
  };

  const sendTask = (task) => {
    // Позиция обязательна: этап заводится на неё, и без неё RPC откажет
    // внятной ошибкой — но сказать об этом лучше до открытия формы
    if (!dev.item_id) {
      toast.error('У разработки не указана позиция заказа — этап создать не из чего');
      return;
    }
    setSendFor(task);
  };

  /**
   * Доработка нового круга. Состав задач считает `reworkPlan` по ВЫБРАННЫМ
   * областям (правки 20.08): прежняя жёсткая тройка `rework → sample → fitting`
   * перезапускала вышивку из-за длины рукава и не перезапускала крой вовсе.
   *
   * Открытая примерка закрывается тем же действием — «не принято» это её
   * результат, а не отдельная задача.
   */
  const startRework = async (rows) => {
    const created = await onAddTasks(rows);
    if (!created) return null;
    if (fittingTask) {
      await onUpdateTask(fittingTask.id, { status: 'done', result: 'Не принято' });
    }
    return created;
  };

  const closeDev = async (outcome) => {
    const open = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
    if (open.length > 0) {
      const ok = await confirm({
        title: `Закрыть разработку как «${DEV_OUTCOME_LABELS[outcome]}»?`,
        message: `Не закрыто задач: ${open.length}. Они останутся в истории как есть.`,
        confirmLabel: 'Закрыть',
        variant: 'danger',
      });
      if (!ok) return;
    }
    const { ok, value } = await confirmWithInput({
      title: DEV_OUTCOME_LABELS[outcome],
      message: outcome === 'ready_for_serial'
        ? 'Разработка закроется успешно. Производственный заказ на серию заводит менеджер — автоматически он не создаётся.'
        : 'Разработка закроется с этим исходом.',
      confirmLabel: 'Зафиксировать',
      prompt: { label: 'Комментарий', placeholder: 'необязательно' },
    });
    if (ok) await onClose(dev.id, { outcome, comment: value });
  };

  const fittingTask = tasks.find(
    (t) => t.task_type === 'fitting' && t.status !== 'done' && t.status !== 'cancelled');

  return (
    <section className={styles.matSection}>
      <div className={styles.matSectionHead}>
        <div>
          <strong>
            {order ? (
              <OrderLink orderId={order.id}>
                №{order.bitrix_id || '—'}
              </OrderLink>
            ) : `№${dev.order?.bitrix_id || '—'}`}
            {' · '}
            {order?.title || dev.order?.title || 'Заказ'}
          </strong>
        </div>
        <div className={styles.checkRow}>
          {/* Готовность — в ЗАДАЧАХ, а не в штуках: это разные величины */}
          <span className={`${styles.chip} ${styles.chipNeutral}`}>
            Готовность {readiness.total > 0 ? `${readiness.done} / ${readiness.total}` : '—'}
          </span>
          {dev.outcome && (
            <Badge variant={dev.outcome === 'ready_for_serial' ? 'ready' : 'neutral'}>
              {DEV_OUTCOME_LABELS[dev.outcome]}
            </Badge>
          )}
        </div>
      </div>

      {/* Две строки, ради которых заказчик и переделывает раздел: почему стоит
          и что делать дальше. Они видны ВСЕГДА, а не на отдельной вкладке */}
      {!dev.outcome && (
        <div className={styles.tzBlock}>
          <div>
            <span className={styles.fieldLabel}>Текущий блокер</span>
            <div>
              {blocker
                ? <><Icon name="alert" size={13} /> {taskLabel(blocker, typeNames)}
                  {blocker.blocked_reason ? ` — ${blocker.blocked_reason}` : ''}</>
                : <span className={styles.subText}>нет — работа идёт</span>}
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <span className={styles.fieldLabel}>Следующее действие</span>
            <div>{action || <span className={styles.subText}>—</span>}</div>
          </div>
        </div>
      )}

      <ReadOnlyFieldset
        canManage={canManage}
        note="Только просмотр: разработку ведёт технолог."
      >
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Название изделия</span>
            <input
              className={styles.input}
              defaultValue={dev.tech_name || ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (dev.tech_name || null)) onUpdate(dev.id, { tech_name: v });
              }}
              aria-label="Название изделия"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Тип разработки</span>
            <input
              className={styles.input}
              defaultValue={dev.dev_type || ''}
              placeholder="Кастомный заказ / своя линейка"
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (dev.dev_type || null)) onUpdate(dev.id, { dev_type: v });
              }}
              aria-label="Тип разработки"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Конструктор</span>
            <input
              className={styles.input}
              defaultValue={dev.constructor || ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (dev.constructor || null)) onUpdate(dev.id, { constructorName: v });
              }}
              aria-label="Конструктор"
            />
          </label>
          <label className={styles.field}>
            {/* «Проработчик» — подпись заказчика; код колонки `technologist`
                не переименовывается (правило проекта про коды ролей) */}
            <span className={styles.fieldLabel}>Проработчик</span>
            <input
              className={styles.input}
              defaultValue={dev.technologist || ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (dev.technologist || null)) onUpdate(dev.id, { technologist: v });
              }}
              aria-label="Проработчик"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Срок разработки</span>
            <DateField
              value={dev.due_date || ''}
              onChange={(v) => onUpdate(dev.id, { due_date: v || null })}
              aria-label="Срок разработки"
            />
            {!dev.due_date && order?.due_date && (
              <span className={styles.subText}>
                не задан — считается по сроку заказа {formatDateShort(order.due_date)}
              </span>
            )}
          </label>
          <label className={`${styles.field} ${styles.fieldWide}`}>
            <span className={styles.fieldLabel}>Комментарий</span>
            <textarea
              className={styles.input}
              rows={2}
              defaultValue={dev.comment || ''}
              onBlur={(e) => {
                const v = e.target.value.trim() || null;
                if (v !== (dev.comment || null)) onUpdate(dev.id, { comment: v });
              }}
              aria-label="Комментарий к разработке"
            />
          </label>
        </div>

        <h3 className={styles.queueGroupTitle} style={{ marginTop: 16 }}>Задачи разработки</h3>
        <DevTasksSection
          tasks={tasks}
          typeNames={typeNames}
          deptNames={deptNames}
          onUpdate={onUpdateTask}
          onSend={sendTask}
          onBlock={blockTask}
          canManage={canManage}
        />

        {sendFor && (
          <DevSendToDept
            task={sendFor}
            taskName={taskLabel(sendFor, typeNames)}
            departments={shops}
            onSend={onSendTask}
            onCancel={() => setSendFor(null)}
          />
        )}

        {!dev.outcome && (
          <>
            <DevSampleCheck
              dev={dev}
              tasks={tasks}
              onApprove={(note) => onApproveSample(dev.id, note)}
              onRework={startRework}
            />

            {/* История доработок — прямое требование документа. Круг считает
                сервер по ТИПУ задачи, поэтому номер стоит у каждой задачи,
                а не у группы: там он верен */}
            {history.length > 0 && (
              <>
                <h3 className={styles.queueGroupTitle} style={{ marginTop: 16 }}>
                  История доработок
                </h3>
                <ul className={styles.subText}>
                  {history.map((t) => (
                    <li key={t.id}>
                      {taskLabel(t, typeNames)} · круг {t.cycle}
                      {t.done_on ? ` · ${formatDateShort(t.done_on)}` : ''}
                      {t.comment ? ` — ${t.comment}` : ''}
                      {t.result ? ` → ${t.result}` : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}

            <h3 className={styles.queueGroupTitle} style={{ marginTop: 16 }}>Добавить задачу</h3>
            <AddTaskForm typeItems={typeNames} tasks={tasks} onAdd={addTasks} />

            <DevFinalPackage
              dev={dev}
              attachments={dev.attachments ?? []}
              canManage={canManage}
              onUpdate={onUpdate}
              onUpload={(kind, file) => onUploadFile({
                devId: dev.id, orderId: dev.order_id, kind, file,
              })}
              onRemoveFile={(attId) => onRemoveFile(dev.id, attId)}
              onReady={() => closeDev('ready_for_serial')}
            />

            <h3 className={styles.queueGroupTitle} style={{ marginTop: 16 }}>
              Другой итог разработки
            </h3>
            <div className={styles.queueActions}>
              {Object.entries(DEV_OUTCOME_LABELS)
                // «Готово к серии» живёт в блоке пакета: там же видно, чего
                // не хватает. Кнопка в общем ряду обходила бы этот перечень
                .filter(([code]) => code !== 'ready_for_serial')
                .map(([code, label]) => (
                  <Button key={code} variant="ghost" onClick={() => closeDev(code)}>
                    {label}
                  </Button>
                ))}
            </div>
            <p className={styles.subText}>
              Незаконченная разработка закрывается незаконченной: финального
              пакета такие исходы не требуют.
            </p>
          </>
        )}

        {dev.outcome && (
          <p className={styles.subText}>
            Разработка закрыта{dev.closed_at ? ` ${formatDateShort(dev.closed_at)}` : ''}
            {dev.outcome_comment ? `: ${dev.outcome_comment}` : ''}.
          </p>
        )}
      </ReadOnlyFieldset>
    </section>
  );
}
