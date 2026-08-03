import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { useErpAccess } from '../../store/useErpAccess';
import { useDictionary } from '../../store/useDictionary';
import { Drawer } from '../../components/Drawer';
import { Icon } from '../../components/Icon';
import { DateField } from '../../components/DateField';
import { toast } from '../../../store/useToastStore';
import { confirm } from '../../../store/useConfirmStore';
import { formatDateShort } from '../../utils/time';
import { needsDeviationReason, planRemaining } from '../../utils/planCard';
import styles from '../../erp.module.css';

/**
 * Карточка задачи плана целиком: план от руководителя, факт от цеха, проблема
 * и переписка.
 *
 * Разделение прав здесь и есть суть требования: плановое количество, дату,
 * приоритет и очерёдность меняет только `plan.manage` (руководитель
 * производства), факт и проблему вносит `plan.fact` (ответственный за цех),
 * и «свой ли это цех» проверяется отдельно привязкой сотрудника.
 */
export function PlanSlotDrawer({ slot, ctx, onClose }) {
  const {
    updatePlanSlot, movePlanSlot, cancelPlanSlot, reportPlanFact,
    reportPlanProblem, clearPlanProblem, loadPlanComments, addPlanComment, planComments,
  } = useErpStore(useShallow((s) => ({
    updatePlanSlot: s.updatePlanSlot,
    movePlanSlot: s.movePlanSlot,
    cancelPlanSlot: s.cancelPlanSlot,
    reportPlanFact: s.reportPlanFact,
    reportPlanProblem: s.reportPlanProblem,
    clearPlanProblem: s.clearPlanProblem,
    loadPlanComments: s.loadPlanComments,
    addPlanComment: s.addPlanComment,
    planComments: s.planComments,
  })));
  const access = useErpAccess();
  const problemTypes = useDictionary('problem_type');

  const canManage = access.canDo('plan.manage', slot?.department_id);
  const canFact = access.canDo('plan.fact', slot?.department_id);

  const [qty, setQty] = useState('');
  const [defect, setDefect] = useState('');
  const [factComment, setFactComment] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState({ type: '', note: '', affectsDue: false, needsHelp: false, canContinue: true });
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (slot?.id) loadPlanComments(slot.id);
  }, [slot?.id, loadPlanComments]);

  const thread = useMemo(
    () => planComments.filter((c) => c.slot_id === slot?.id),
    [planComments, slot?.id],
  );

  if (!slot) return null;
  const { order, item, dept } = ctx ?? {};
  const remaining = planRemaining(slot);

  const run = async (fn) => {
    setBusy(true);
    await fn();
    setBusy(false);
  };

  const saveFact = () => run(async () => {
    const q = Number(qty);
    if (!Number.isFinite(q) || q < 0) {
      toast.error('Введите фактическое количество');
      return;
    }
    const willRemain = Math.max(0, slot.qty_planned - q);
    // Требование: недовыполнение обязано быть объяснено. Проверяем ДО записи,
    // иначе отклонение уходит в план без причины и разбирать его нечем.
    if (willRemain > 0 && !reason.trim()) {
      toast.error('Сделано меньше плана — укажите причину');
      return;
    }
    const ok = await reportPlanFact(slot.id, {
      qty: q,
      defect: Number(defect) || 0,
      comment: factComment.trim() || null,
      deviationReason: willRemain > 0 ? reason.trim() : null,
    });
    if (ok) {
      setQty(''); setDefect(''); setFactComment(''); setReason('');
      toast.success(willRemain > 0 ? `Записано. Остаток ${willRemain} шт` : 'Задача выполнена');
    }
  });

  const saveProblem = () => run(async () => {
    if (!problem.type.trim()) {
      toast.error('Выберите тип проблемы');
      return;
    }
    const ok = await reportPlanProblem(slot.id, problem);
    if (ok) toast.success('Проблема зафиксирована — задача подсвечена руководителю');
  });

  const send = (side) => run(async () => {
    const row = await addPlanComment(slot.id, message, side);
    if (row) setMessage('');
  });

  const remove = () => run(async () => {
    const ok = await confirm({
      title: 'Убрать задачу из плана?',
      message: 'Задача останется в истории вместе с внесённым фактом, но перестанет '
        + 'считаться в плане дня. Поставить её заново на этот день можно в любой момент.',
      confirmLabel: 'Убрать',
      variant: 'danger',
    });
    if (!ok) return;
    if (await cancelPlanSlot(slot.id)) onClose();
  });

  return (
    <Drawer
      onClose={onClose}
      title={order ? `№${order.bitrix_id || '—'} · ${order.title}` : 'Задача плана'}
    >
      <div className={styles.planDrawerBody}>
        <dl className={styles.taskFacts}>
          <dt>Изделие</dt>
          <dd>{item ? [item.product_type, item.variant].filter(Boolean).join(' ') : '—'}</dd>
          <dt>Цех</dt><dd>{dept?.name || '—'}</dd>
          <dt>День</dt><dd>{formatDateShort(slot.work_date)}</dd>
          <dt>План на день</dt><dd>{slot.qty_planned} шт</dd>
          <dt>Факт</dt><dd>{slot.qty_done ?? 0} шт</dd>
          <dt>Остаток</dt><dd>{remaining} шт</dd>
          <dt>Брак</dt><dd>{slot.qty_defect} шт</dd>
          {slot.fact_by && (
            <>
              <dt>Внёс</dt>
              <dd>{slot.fact_by}{slot.fact_at ? ` · ${formatDateShort(slot.fact_at)}` : ''}</dd>
            </>
          )}
          {slot.deviation_reason && (
            <>
              <dt>Причина отклонения</dt><dd>{slot.deviation_reason}</dd>
            </>
          )}
        </dl>

        {/* ── План: только руководитель производства ── */}
        <section className={styles.planSection}>
          <h4>План</h4>
          {canManage ? (
            <div className={styles.planFormRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Количество на день</span>
                <input
                  type="number" min="1" className={styles.input}
                  defaultValue={slot.qty_planned}
                  onBlur={(e) => {
                    const v = Number(e.target.value);
                    if (v > 0 && v !== slot.qty_planned) updatePlanSlot(slot.id, { qty_planned: v });
                  }}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Дата выполнения</span>
                <DateField
                  value={slot.work_date}
                  onChange={(v) => v && v !== slot.work_date && movePlanSlot(slot.id, v)}
                />
              </label>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={slot.priority > 0}
                  onChange={(e) => updatePlanSlot(slot.id, { priority: e.target.checked ? 1 : 0 })}
                />
                повышенный приоритет
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Комментарий цеху</span>
                <textarea
                  className={styles.input} rows={2}
                  defaultValue={slot.comment || ''}
                  placeholder="последовательность, особенности, ограничения"
                  onBlur={(e) => {
                    const v = e.target.value.trim() || null;
                    if (v !== (slot.comment || null)) updatePlanSlot(slot.id, { comment: v });
                  }}
                />
              </label>
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={remove}>
                Убрать из плана
              </button>
            </div>
          ) : (
            <div className={styles.subText}>
              План ставит руководитель производства. Вам доступно внесение факта.
              {slot.comment ? ` Комментарий: ${slot.comment}` : ''}
            </div>
          )}
        </section>

        {/* ── Факт: ответственный за цех ── */}
        {canFact && slot.status !== 'cancelled' && (
          <section className={styles.planSection}>
            <h4>Факт за день</h4>
            <div className={styles.planFormRow}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Сделано, шт</span>
                {/* Поле намеренно пустое, а не предзаполнено планом: один тап
                    не должен закрывать день на полный объём (то же правило,
                    что у «сколько сдано» в задании цеха) */}
                <input
                  type="number" min="0" className={styles.input}
                  value={qty} onChange={(e) => setQty(e.target.value)}
                  placeholder={`из ${slot.qty_planned}`}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Брак, шт</span>
                <input
                  type="number" min="0" className={styles.input}
                  value={defect} onChange={(e) => setDefect(e.target.value)}
                  placeholder="0"
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Комментарий</span>
                <input
                  className={styles.input} value={factComment}
                  onChange={(e) => setFactComment(e.target.value)}
                  placeholder="как прошло"
                />
              </label>
              {Number(qty) >= 0 && Number(qty) < slot.qty_planned && qty !== '' && (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Причина отклонения *</span>
                  <input
                    className={styles.input} value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="почему сделано меньше плана"
                  />
                </label>
              )}
              <button type="button" className="btn btn-primary" disabled={busy} onClick={saveFact}>
                Записать факт
              </button>
            </div>
            {needsDeviationReason(slot) && (
              <div className={styles.queueReason}>
                <span className={styles.cellWithIcon}>
                  <Icon name="alert" size={14} />
                  Остаток {remaining} шт. Новую дату ставит руководитель производства —
                  система сама ничего не переносит.
                </span>
              </div>
            )}
          </section>
        )}

        {/* ── Проблема ── */}
        {canFact && (
          <section className={styles.planSection}>
            <h4>Проблема</h4>
            {slot.problem_type ? (
              <div className={styles.planFormRow}>
                <span className={`${styles.chip} ${styles.chipBlocked}`}>{slot.problem_type}</span>
                {slot.problem_note && <span>{slot.problem_note}</span>}
                <span className={styles.subText}>
                  {[
                    slot.problem_affects_due ? 'влияет на срок' : null,
                    slot.problem_needs_help ? 'нужна помощь руководителя' : null,
                    slot.problem_can_continue ? 'работу можно продолжать' : 'работа остановлена',
                  ].filter(Boolean).join(' · ')}
                </span>
                <button
                  type="button" className="btn btn-secondary" disabled={busy}
                  onClick={() => run(() => clearPlanProblem(slot.id))}
                >
                  Снять проблему
                </button>
              </div>
            ) : (
              <div className={styles.planFormRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Тип</span>
                  <input
                    className={styles.input} list="erp-plan-problem-types"
                    value={problem.type}
                    onChange={(e) => setProblem({ ...problem, type: e.target.value })}
                    placeholder="нет материалов, брак, ошибка в ТЗ…"
                  />
                  <datalist id="erp-plan-problem-types">
                    {problemTypes.map((t) => <option key={t.id} value={t.name} />)}
                  </datalist>
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Описание</span>
                  <input
                    className={styles.input} value={problem.note}
                    onChange={(e) => setProblem({ ...problem, note: e.target.value })}
                  />
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox" checked={problem.affectsDue}
                    onChange={(e) => setProblem({ ...problem, affectsDue: e.target.checked })}
                  />
                  влияет на срок
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox" checked={problem.needsHelp}
                    onChange={(e) => setProblem({ ...problem, needsHelp: e.target.checked })}
                  />
                  нужна помощь руководителя
                </label>
                <label className={styles.checkLabel}>
                  <input
                    type="checkbox" checked={problem.canContinue}
                    onChange={(e) => setProblem({ ...problem, canContinue: e.target.checked })}
                  />
                  работу можно продолжать
                </label>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={saveProblem}>
                  Зафиксировать проблему
                </button>
              </div>
            )}
          </section>
        )}

        {/* ── Переписка ── */}
        <section className={styles.planSection}>
          <h4>Комментарии</h4>
          {thread.length === 0 && <div className={styles.subText}>Пока пусто.</div>}
          {thread.map((c) => (
            <div key={c.id} className={styles.planComment}>
              <span className={styles.cellWithIcon}>
                <Icon name={c.side === 'manager' ? 'user' : 'needle'} size={13} />
                <b>{c.author}</b>
                <span className={styles.subText}>{formatDateShort(c.created_at)}</span>
              </span>
              <div>{c.text}</div>
            </div>
          ))}
          {(canManage || canFact) && (
            <div className={styles.planFormRow}>
              <input
                className={styles.input} value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="написать по задаче"
              />
              <button
                type="button" className="btn btn-secondary" disabled={busy || !message.trim()}
                onClick={() => send(canManage ? 'manager' : 'shop')}
              >
                Отправить
              </button>
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}
