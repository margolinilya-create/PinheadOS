import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { Icon } from '../../components/Icon';
import { SearchInput } from '../../components/SearchInput';
import { useFocusTrap } from '../../../hooks/useFocusTrap';
import { toast } from '../../../store/useToastStore';
import { formatDateShort } from '../../utils/time';
import { buildQueueEntries } from '../../utils/queueEntries';
import { matchesOrderQuery } from '../../utils/orderSearch';
import { stageQtyProgress } from '../../utils/progress';
import { deptShortName } from '../../data/departments';
import styles from '../../erp.module.css';

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
 */
export function PlanAddModal({ date, departmentId, onClose }) {
  const { orders, departments, planSlots, planStage } = useErpStore(useShallow((s) => ({
    orders: s.orders,
    departments: s.departments,
    planSlots: s.planSlots,
    planStage: s.planStage,
  })));
  const ref = useFocusTrap(true, onClose);

  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null);
  const [qty, setQty] = useState('');
  const [comment, setComment] = useState('');
  const [priority, setPriority] = useState(false);
  const [busy, setBusy] = useState(false);

  const dept = departments.find((d) => d.id === departmentId) ?? null;

  const candidates = useMemo(() => {
    const all = buildQueueEntries(orders, departments)
      .filter((e) => e.stage.status !== 'done' && e.stage.status !== 'skipped')
      .filter((e) => !departmentId || e.stage.department_id === departmentId);
    const filtered = q.trim()
      ? all.filter((e) => matchesOrderQuery(e.order, q))
      : all;
    return filtered.slice(0, 50);
  }, [orders, departments, departmentId, q]);

  /** Уже стоит в плане на этот день — чтобы не ставить одно и то же дважды */
  const plannedStageIds = useMemo(
    () => new Set(planSlots.filter((s) => s.work_date === date && s.status !== 'cancelled')
      .map((s) => s.stage_id)),
    [planSlots, date],
  );

  const pick = (entry) => {
    setPicked(entry);
    const left = stageQtyProgress(entry.stage, entry.item.qty);
    setQty(String(Math.max(1, entry.item.qty - (left.done ?? 0))));
  };

  const submit = async () => {
    if (!picked) {
      toast.error('Выберите задание');
      return;
    }
    setBusy(true);
    const row = await planStage({
      stageId: picked.stage.id,
      departmentId: picked.stage.department_id,
      workDate: date,
      qty: Number(qty),
      comment: comment.trim() || null,
      priority: priority ? 1 : 0,
    });
    setBusy(false);
    if (row) {
      toast.success(`Задача в плане на ${formatDateShort(date)}`);
      onClose();
    }
  };

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
          <b>В план на {formatDateShort(date)}{dept ? ` · ${deptShortName(dept.code, dept.name)}` : ''}</b>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Закрыть">
            <Icon name="x" size={16} />
          </button>
        </div>

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

        {picked && (
          <div className={styles.planFormRow}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Количество на день *</span>
              <input
                type="number" min="1" className={styles.input}
                value={qty} onChange={(e) => setQty(e.target.value)}
              />
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
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button
            type="button" className="btn btn-primary"
            disabled={busy || !picked || !(Number(qty) > 0)}
            onClick={submit}
          >
            {busy ? 'Добавляем…' : 'В план'}
          </button>
        </div>
      </div>
    </div>
  );
}
