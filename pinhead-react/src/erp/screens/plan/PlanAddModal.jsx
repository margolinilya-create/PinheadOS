import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { Icon } from '../../components/Icon';
import { SearchInput } from '../../components/SearchInput';
import { DateField } from '../../components/DateField';
import { useFormGate } from '../../components/useFormGate';
import { FieldError, FormGateHint } from '../../components/FormGate';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { toast } from '../../../store/useToastStore';
import { formatDateShort } from '../../utils/time';
import { buildQueueEntries } from '../../utils/queueEntries';
import { matchesOrderQuery } from '../../utils/orderSearch';
import { remainingQty } from '../../utils/planQueue';
import { stageQtyProgress } from '../../utils/progress';
import { deptShortName } from '../../data/departments';
import styles from '../../erp.module.css';
import { Button } from '../../components/Button';

/**
 * Постановка задачи в план: выбрать этап из общего производственного плана
 * и указать количество на день.
 *
 * Источник — тот же `buildQueueEntries`, что очередь и канбан: руководитель
 * ставит в план ровно то, что реально висит на цехе, включая задания, стоящие
 * из-за материалов (их полезно запланировать заранее). Уже завершённые этапы
 * в список не попадают — планировать там нечего.
 *
 * Количество по умолчанию — ОСТАТОК этапа, а не весь тираж: 300 штук на неделю
 * раскладываются по дням, и подставленный полный тираж каждый раз пришлось бы
 * стирать вручную.
 *
 * Три входа (правки 10.08):
 *   · «+ В план на этот день» на доске — день известен, задание выбирают здесь;
 *   · перетаскивание из очереди «Не запланировано» — известны оба, окно просит
 *     подтвердить количество;
 *   · кнопка «В план» в очереди цеха — известно задание, дату выбирают здесь.
 * Отсюда `date` и `preselect` независимы: любое из двух может прийти извне.
 */
export function PlanAddModal({ date = null, departmentId, preselect = null, onClose }) {
  const { orders, departments, bypasses, planSlots, planStage } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    departments: s.departments,
    // Без снятий окно предлагало заново запланировать этап, который очередь
    // и общий план уже считают готовым: два экрана про один этап говорили разное
    bypasses: s.bypasses,
    planSlots: s.planSlots,
    planStage: s.planStage,
  })));
  const ref = useFocusTrap(true, onClose);

  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(preselect);
  const [workDate, setWorkDate] = useState(date ?? '');
  const [qty, setQty] = useState(preselect ? String(remainingQty(preselect)) : '');
  const [comment, setComment] = useState('');
  const [priority, setPriority] = useState(false);
  const [busy, setBusy] = useState(false);

  // Цех берём у выбранного задания, когда он не задан снаружи: при постановке
  // из очереди цеха модалку открывают без «в какой участок», он уже известен
  const effectiveDeptId = departmentId ?? picked?.stage.department_id ?? null;
  const dept = departments.find((d) => d.id === effectiveDeptId) ?? null;

  const candidates = useMemo(() => {
    const all = buildQueueEntries(orders, departments, { bypasses })
      .filter((e) => e.stage.status !== 'done' && e.stage.status !== 'skipped')
      .filter((e) => !departmentId || e.stage.department_id === departmentId);
    const filtered = q.trim()
      ? all.filter((e) => matchesOrderQuery(e.order, q))
      : all;
    return filtered.slice(0, 50);
  }, [orders, departments, bypasses, departmentId, q]);

  /** Уже стоит в плане на этот день — чтобы не ставить одно и то же дважды */
  const plannedStageIds = useMemo(
    () => new Set(planSlots.filter((s) => s.work_date === workDate && s.status !== 'cancelled')
      .map((s) => s.stage_id)),
    [planSlots, workDate],
  );

  const pick = (entry) => {
    setPicked(entry);
    setQty(String(remainingQty(entry)));
  };

  /**
   * Причина называется у поля, а не тостом в углу и не молчаливым `disabled`
   * (H-16 отчёта QA 13.08.2026): кнопка блокировалась при пустом количестве
   * и не сообщала об этом ничего.
   */
  const gate = useFormGate([
    { key: 'picked', label: 'Задание', ok: Boolean(picked), message: 'Выберите задание из списка выше' },
    { key: 'workDate', label: 'День', ok: Boolean(workDate), message: 'Выберите день' },
    {
      key: 'qty',
      label: 'Количество на день',
      ok: Number(qty) > 0,
      kind: qty === '' ? 'missing' : 'invalid',
      message: 'Количество на день должно быть больше нуля',
    },
  ]);

  const submit = async () => {
    setBusy(true);
    const row = await planStage({
      stageId: picked.stage.id,
      departmentId: picked.stage.department_id,
      workDate,
      qty: Number(qty),
      comment: comment.trim() || null,
      priority: priority ? 1 : 0,
    });
    setBusy(false);
    if (row) {
      toast.success(`Задача в плане на ${formatDateShort(workDate)}`);
      onClose();
    }
  };

  const title = workDate
    ? `В план на ${formatDateShort(workDate)}${dept ? ` · ${deptShortName(dept.code, dept.name)}` : ''}`
    : `В план${dept ? ` · ${deptShortName(dept.code, dept.name)}` : ''}`;

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="presentation">
      <div
        ref={ref}
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Поставить задачу в план"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.matSectionHead}>
          <b>{title}</b>
          <Button variant="ghost" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </Button>
        </div>

        {/* Задание уже выбрано (перетащили или пришли из очереди цеха) — списка
            нет: перебирать пятьдесят строк, чтобы найти ту же самую, незачем */}
        {preselect ? (
          <p className={styles.queueReason}>
            <b>№{preselect.order.bitrix_id || '—'}</b> {preselect.order.title}
            {' · '}
            {[preselect.item.product_type, preselect.item.variant].filter(Boolean).join(' ')}
            {' · '}
            {preselect.item.qty} шт в тираже
          </p>
        ) : (
          <>
            <SearchInput value={q} onChange={setQ} placeholder="заказ, клиент, изделие" />

            <div className={styles.planPickList}>
              {candidates.length === 0 && (
                <div className={styles.subText}>Заданий не нашлось — измените запрос.</div>
              )}
              {candidates.map((e) => {
                const already = plannedStageIds.has(e.stage.id);
                const progress = stageQtyProgress(e.stage, e.item.qty);
                return (
                  <button
                    key={e.stage.id}
                    type="button"
                    className={`${styles.planPickRow} ${picked?.stage.id === e.stage.id ? styles.planPickRowActive : ''}`}
                    disabled={already}
                    onClick={() => pick(e)}
                  >
                    <span>
                      <b>№{e.order.bitrix_id || '—'}</b> {e.order.title}
                      <span className={styles.subText}>
                        {' '}· {[e.item.product_type, e.item.variant].filter(Boolean).join(' ')}
                        {' '}· {progress.done}/{e.item.qty} шт
                      </span>
                    </span>
                    {already && <span className={styles.subText}>уже в плане на этот день</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {picked && (
          <div className={styles.planFormRow}>
            {/* День спрашиваем, только когда его не выбрали ячейкой или днём доски */}
            {!date && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>День *</span>
                <DateField
                  className={gate.cls(styles.input, 'workDate')}
                  value={workDate}
                  onChange={setWorkDate}
                  aria-label="День, на который ставится задача"
                  {...gate.field('workDate')}
                />
                <FieldError id={gate.errId('workDate')} text={gate.error('workDate')} />
              </label>
            )}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Количество на день *</span>
              <input
                type="number" min="1" className={gate.cls(styles.input, 'qty')}
                value={qty} onChange={(e) => setQty(e.target.value)}
                {...gate.field('qty')}
              />
              <FieldError id={gate.errId('qty')} text={gate.error('qty')} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Комментарий цеху</span>
              <input
                className={styles.input} value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="последовательность, особенности"
              />
            </label>
            <label className={styles.checkLabel}>
              <input type="checkbox" checked={priority} onChange={(e) => setPriority(e.target.checked)} />
              повышенный приоритет
            </label>
          </div>
        )}

        <div className={styles.modalActions}>
          <FormGateHint gate={gate} />
          <Button variant="ghost" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={busy || (gate.submitted && !gate.ok)}
            onClick={gate.guard(submit)}
          >
            {busy ? 'Добавляем…' : 'В план'}
          </Button>
        </div>
      </div>
    </div>
  );
}
