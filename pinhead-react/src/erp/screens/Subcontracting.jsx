import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { LoadFailed, EmptyResult } from '../components/ErpStates';
import { SearchInput } from '../components/SearchInput';
import { StageIndicator } from '../components/StageIndicator';
import { useErpStore } from '../store/useErpStore';
import { useErpAccess } from '../store/useErpAccess';
import { toast } from '../../store/useToastStore';
import { formatDateShort, subcontractOverdue } from '../utils/time';
import { deptShortName, isProductionDept } from '../data/departments';
import {
  SUBCONTRACT_PHASE_LABELS,
  SUBCONTRACT_PAYMENT_LABELS,
  SUBCONTRACT_OP_TYPE_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
} from '../types';
import {
  SUBCONTRACT_PHASE_FLOW,
  nextSubcontractPhase,
  subcontractPhase,
  subcontractPhasePatch,
} from '../utils/subcontractPhase';
import styles from '../erp.module.css';
import { DateField } from '../components/DateField';
import { ScrollHintBox } from '../components/ScrollHintBox';
import { Button } from '../components/Button';

/**
 * Подряд (правки 4.2.1/4.2.4, волна 3.5): рабочая очередь операций у подрядчиков.
 * Компактная таблица; текущая фаза и следующее действие — в РАЗНЫХ колонках (не сливаются).
 * Готовое изделие после возврата не идёт на производство напрямую — сначала
 * обязательная приёмка складом (задача создаётся автоматически, см. subcontractingSlice).
 *
 * Операцию двигает ФАЗА (`utils/subcontractPhase`), а не устаревший `status`:
 * до этой правки экран писал `awaiting_payment` — статус, который волна 3.5
 * убрала из производственного потока, — а складской гейт читал `phase`,
 * которую никто не продвигал. Оплата теперь отдельный признак и в переходах
 * не участвует: неоплаченный подряд не должен останавливать цех.
 */

const PHASE_CHIP = {
  planned: 'chipNeutral',
  materials_ready: 'chipNeutral',
  sent: 'chipProgress',
  at_contractor: 'chipProgress',
  returned: 'chipReady',
  accepted: 'chipReady',
  closed: 'chipSkipped',
};

/**
 * Верхняя воронка: сколько операций «готовое изделие» сейчас в каждой фазе.
 * Шаги — те же семь фаз документа, что и в переходах: отдельный список шагов
 * рядом с потоком означал бы восьмую фазу, которой нет в данных.
 */
const FINISHED_STEPS = SUBCONTRACT_PHASE_FLOW.map((key) => ({
  key, label: SUBCONTRACT_PHASE_LABELS[key],
}));

const EMPTY_OP = {
  order_id: '', operation: '', op_type: 'operation', material_source: 'pinhead',
  return_dept: '', contractor: '', qty: '', sent_date: '', planned_date: '',
};

function AddOpRow({ orders, queueDepts, onAdd }) {
  const [form, setForm] = useState(EMPTY_OP);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!form.order_id) { toast.error('Выберите заказ'); return; }
    if (!form.operation.trim()) { toast.error('Укажите операцию'); return; }
    setSaving(true);
    const row = await onAdd({
      order_id: form.order_id,
      operation: form.operation.trim(),
      op_type: form.op_type,
      material_source: form.material_source,
      // Следующий участок — только для отдельной операции; готовое изделие идёт на внутренние этапы
      return_dept: form.op_type === 'operation' ? (form.return_dept || null) : null,
      contractor: form.contractor.trim() || null,
      qty: form.qty ? Number(form.qty) : null,
      sent_date: form.sent_date || null,
      planned_date: form.planned_date || null,
      /**
       * Стартовая фаза одна для обоих типов. Прежде готовое изделие стартовало
       * с `awaiting_payment` — то есть первым производственным шагом была
       * оплата, ровно то, что документ запретил. Указана дата передачи —
       * значит уже передали.
       */
      ...subcontractPhasePatch(form.sent_date ? 'sent' : 'planned'),
    });
    setSaving(false);
    if (row) setForm(EMPTY_OP);
  };

  return (
    <div className={styles.addMatRow}>
      <select className={styles.select} value={form.order_id} onChange={(e) => setForm({ ...form, order_id: e.target.value })} aria-label="Заказ">
        <option value="">Заказ…</option>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>№{o.bitrix_id || '—'} · {o.title}</option>
        ))}
      </select>
      <select className={styles.select} value={form.op_type} onChange={(e) => setForm({ ...form, op_type: e.target.value })} aria-label="Тип операции">
        {Object.entries(SUBCONTRACT_OP_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <select className={styles.select} value={form.material_source} onChange={(e) => setForm({ ...form, material_source: e.target.value })} aria-label="Источник материалов">
        {Object.entries(SUBCONTRACT_MATERIAL_SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {form.op_type === 'operation' && (
        <select className={styles.select} value={form.return_dept} onChange={(e) => setForm({ ...form, return_dept: e.target.value })} aria-label="Следующий участок">
          <option value="">Следующий участок…</option>
          {queueDepts.map((d) => <option key={d.code} value={d.code}>{deptShortName(d.code, d.name)}</option>)}
        </select>
      )}
      <input className={styles.input} placeholder="Операция (пошив, вышивка…)" value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value })} aria-label="Операция" />
      <input className={styles.input} placeholder="Контрагент" value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} aria-label="Контрагент" style={{ maxWidth: 150 }} />
      <input type="number" min="1" className={styles.input} placeholder="шт" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="Количество" style={{ maxWidth: 90 }} />
      <label className={styles.subText}>передан<DateField showFormatHint={false} value={form.sent_date} onChange={(v) => setForm({ ...form, sent_date: v })} aria-label="Дата передачи" /></label>
      <label className={styles.subText}>готов<DateField showFormatHint={false} value={form.planned_date} onChange={(v) => setForm({ ...form, planned_date: v })} aria-label="Плановая готовность" /></label>
      <Button variant="secondary" disabled={saving} onClick={submit}>+ Добавить</Button>
    </div>
  );
}

/** Колонка «Следующее действие»: разнесена с текущей фазой (правка 4.2.4) */
function NextAction({ op, onUpdate, canManage }) {
  const phase = subcontractPhase(op);

  // Без права двигать операцию колонка показывает только текущее положение:
  // кнопка, отвечающая 42501, хуже её отсутствия
  if (!canManage) return <span className={styles.subText}>{SUBCONTRACT_PHASE_LABELS[phase]}</span>;

  if (op.op_type === 'finished_product') {
    // После возврата дальше двигает не подряд, а склад — своей приёмкой
    if (phase === 'returned') {
      return <span className={styles.subText}>Ожидает приёмки складом</span>;
    }
    if (phase === 'accepted' || phase === 'closed') {
      return <span className={styles.subText}>На упаковку/отгрузку</span>;
    }
    const next = nextSubcontractPhase(phase);
    return next ? (
      <Button variant="secondary" onClick={() => onUpdate(op.id, subcontractPhasePatch(next))}>
        → {SUBCONTRACT_PHASE_LABELS[next]}
      </Button>
    ) : <span className={styles.subText}>—</span>;
  }

  // Отдельная операция: возврат запускает маршрут дальше в сторе
  if (phase === 'returned' || phase === 'accepted' || phase === 'closed') {
    return (
      <span className={styles.subText}>
        {op.return_dept ? `→ ${deptShortName(op.return_dept, op.return_dept)}` : '→ упаковка/отгрузка'}
      </span>
    );
  }
  return (
    <select
      className={styles.select}
      value={phase}
      onChange={(e) => onUpdate(op.id, subcontractPhasePatch(e.target.value))}
      aria-label={`Изменить фазу ${op.operation}`}
    >
      {SUBCONTRACT_PHASE_FLOW.map((v) => (
        <option key={v} value={v}>{SUBCONTRACT_PHASE_LABELS[v]}</option>
      ))}
    </select>
  );
}

/**
 * Оплата — отдельный признак рядом с фазой, а НЕ шаг потока. Документ прямо
 * требует, чтобы оплата не была первым производственным этапом: неоплаченный
 * подряд не должен останавливать цех, поэтому переключатель ничего не блокирует
 * и ни в один переход не входит.
 */
function PaymentPicker({ op, onUpdate, disabled }) {
  return (
    <select
      className={`${styles.select} ${styles.inputXs}`}
      value={op.payment_status || 'unpaid'}
      disabled={disabled}
      onChange={(e) => onUpdate(op.id, { payment_status: e.target.value })}
      aria-label={`Оплата ${op.operation}`}
      style={{ marginTop: 4 }}
    >
      {Object.entries(SUBCONTRACT_PAYMENT_LABELS).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}

export default function Subcontracting() {
  const {
    orders, departments, loaded, loadError, loadAll,
    subcontracting, subcontractingLoaded, loadSubcontracting,
    createSubcontractOp, updateSubcontractOp,
  } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      loaded: s.loaded,
      loadError: s.loadError,
      loadAll: s.loadAll,
      subcontracting: s.subcontracting,
      subcontractingLoaded: s.subcontractingLoaded,
      loadSubcontracting: s.loadSubcontracting,
      createSubcontractOp: s.createSubcontractOp,
      updateSubcontractOp: s.updateSubcontractOp,
    })),
  );
  /**
   * Подряд — решение по маршруту заказа, поэтому право то же, что у остальных
   * таких решений: `order.manage`. Гейт стоит и на сервере (RLS таблицы
   * `erp_subcontracting` и журнала `erp_subcontract_moves`), и здесь — иначе
   * получилось бы запрещённое «кнопка есть, действие падает»: до этой правки
   * экран не гейтился вовсе, а сервер пускал только профили admin/director.
   */
  const canManage = useErpAccess().can('order.manage');
  const [query, setQuery] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!subcontractingLoaded) loadSubcontracting(); }, [subcontractingLoaded, loadSubcontracting]);

  const activeOrders = useMemo(() => orders.filter((o) => o.status === 'active'), [orders]);
  const queueDepts = useMemo(
    () => departments.filter((d) => d.active && isProductionDept(d)),
    [departments],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return subcontracting;
    return subcontracting.filter((op) =>
      (op.order?.title || '').toLowerCase().includes(q) ||
      (op.order?.bitrix_id || '').includes(q) ||
      (op.contractor || '').toLowerCase().includes(q) ||
      op.operation.toLowerCase().includes(q));
  }, [subcontracting, query]);

  // Воронка готового изделия: сколько операций-«готовое изделие» сейчас в каждой фазе
  const finishedSteps = useMemo(() => {
    const counts = {};
    for (const op of subcontracting) {
      if (op.op_type !== 'finished_product') continue;
      const phase = subcontractPhase(op);
      counts[phase] = (counts[phase] || 0) + 1;
    }
    return FINISHED_STEPS.map((s) => ({ ...s, count: counts[s.key] || 0 }));
  }, [subcontracting]);

  return (
    <>
      <PageHead
        title="Подряд"
        sub="Рабочая очередь операций у подрядчиков: где заказ сейчас и что дальше."
      />

      <StageIndicator variant="funnel" title="Готовое изделие от подрядчика" nodes={finishedSteps} />

      <div className={styles.toolbar}>
        <SearchInput
          value={query} onChange={setQuery}
          placeholder="Поиск: заказ, № сделки, контрагент, операция"
          ariaLabel="Поиск операций подряда"
        />
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} из {subcontracting.length}</span>
      </div>

      {canManage
        ? <AddOpRow orders={activeOrders} queueDepts={queueDepts} onAdd={createSubcontractOp} />
        : (
          <p className={styles.subText}>
            Только просмотр: заводить и вести операции подряда может менеджер заказа.
          </p>
        )}

      {loadError && !loaded && <LoadFailed onRetry={loadAll} what="операции подряда" />}
      {subcontractingLoaded && subcontracting.length === 0 && (
        <div className={styles.emptyState}>Операций подряда пока нет — добавьте первую выше.</div>
      )}
      {/* Операции есть, но поиск не совпал: раньше здесь не рисовалось ничего —
          белое пятно, по которому не понять, «не нашлось» или «сломалось» */}
      {subcontractingLoaded && subcontracting.length > 0 && rows.length === 0 && (
        <EmptyResult query={query.trim()} onReset={() => setQuery('')} />
      )}

      {rows.length > 0 && (
        <ScrollHintBox className={styles.tableWrap} wrapClassName={styles.scrollHintGapTop} label="Операции подряда">
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Заказ</th><th>Тип</th><th>Операция</th><th>Кол-во</th><th>Подрядчик</th>
                <th>Сроки</th><th>Фаза и оплата</th><th>Следующее действие</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((op) => {
                const phase = subcontractPhase(op);
                const overdue = subcontractOverdue(op.planned_date, op.returned_date, phase, today);
                const delayed = overdue && phase !== 'returned';
                return (
                  <tr key={op.id}>
                    <td>
                      <strong>№{op.order?.bitrix_id || '—'}</strong>
                      <div className={styles.cellSub} title={op.order?.title || undefined}>
                        {op.order?.title || '—'}
                      </div>
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        value={op.op_type}
                        disabled={!canManage}
                        onChange={(e) => {
                          const nextType = e.target.value;
                          /**
                           * Смена типа фазу НЕ сбрасывает: поток теперь один
                           * на оба типа, и переставлять операцию в начало было
                           * бы потерей факта. Прежде здесь стояло «готовое
                           * изделие → awaiting_payment» — переключение типа
                           * отправляло работу у подрядчика обратно на оплату.
                           */
                          const patch = { op_type: nextType };
                          if (nextType === 'finished_product') patch.return_dept = null;
                          updateSubcontractOp(op.id, patch);
                        }}
                        aria-label={`Тип операции ${op.operation}`}
                      >
                        {Object.entries(SUBCONTRACT_OP_TYPE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      <div className={styles.subText}>
                        {SUBCONTRACT_MATERIAL_SOURCE_LABELS[op.material_source]}
                        {op.op_type === 'operation' && op.return_dept
                          ? ` · ↩ ${deptShortName(op.return_dept, op.return_dept)}` : ''}
                      </div>
                    </td>
                    <td>{op.operation}</td>
                    <td>{op.qty ?? '—'}</td>
                    <td>{op.contractor || '—'}</td>
                    <td>
                      <div className={styles.subText}>передан: {formatDateShort(op.sent_date) || '—'}</div>
                      <div className={overdue ? styles.overdue : styles.subText}>
                        план: {formatDateShort(op.planned_date) || '—'}
                      </div>
                      {op.op_type === 'operation' && (
                        <label className={styles.subText}>
                          возврат:{' '}
                          <DateField
                            showFormatHint={false}
                            disabled={!canManage}
                            value={op.returned_date || ''}
                            onChange={(v) => updateSubcontractOp(op.id, {
                              returned_date: v || null,
                              ...(v ? subcontractPhasePatch('returned') : {}),
                            })}
                            aria-label={`Дата возврата ${op.operation}`}
                            style={{ maxWidth: 130 }}
                          />
                        </label>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.chip} ${styles[delayed ? 'chipBlocked' : PHASE_CHIP[phase]]}`}>
                        {delayed ? 'Задержка' : SUBCONTRACT_PHASE_LABELS[phase]}
                      </span>
                      <PaymentPicker op={op} onUpdate={updateSubcontractOp} disabled={!canManage} />
                      <input
                        className={styles.input}
                        placeholder="Комментарий задержки"
                        defaultValue={op.delay_comment || ''}
                        disabled={!canManage}
                        onBlur={(e) => {
                          const val = e.target.value.trim() || null;
                          if (val !== (op.delay_comment || null)) {
                            updateSubcontractOp(op.id, { delay_comment: val });
                          }
                        }}
                        aria-label={`Комментарий задержки ${op.operation}`}
                        style={{ maxWidth: 170, marginTop: 4 }}
                      />
                    </td>
                    <td><NextAction op={op} onUpdate={updateSubcontractOp} canManage={canManage} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollHintBox>
      )}
    </>
  );
}
