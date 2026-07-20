import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { toast } from '../../store/useToastStore';
import { formatDateShort, subcontractOverdue } from '../utils/time';
import { deptShortName, isQueueDept } from '../data/departments';
import {
  SUBCONTRACT_STATUS_LABELS,
  SUBCONTRACT_OP_TYPE_LABELS,
  SUBCONTRACT_MATERIAL_SOURCE_LABELS,
} from '../types';
import styles from '../erp.module.css';

/**
 * Подряд: операции, переданные внешним подрядчикам (правка 5).
 * Контроль контрагентов, дат передачи/готовности/возврата и задержек.
 */

const STATUS_CHIP = {
  planned: 'chipNeutral',
  sent: 'chipProgress',
  in_progress: 'chipProgress',
  returned: 'chipReady',
  delayed: 'chipBlocked',
  cancelled: 'chipSkipped',
};

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
      // Возврат на цех — только для отдельной операции; готовое изделие идёт на внутренние этапы
      return_dept: form.op_type === 'operation' ? (form.return_dept || null) : null,
      contractor: form.contractor.trim() || null,
      qty: form.qty ? Number(form.qty) : null,
      sent_date: form.sent_date || null,
      planned_date: form.planned_date || null,
      status: form.sent_date ? 'sent' : 'planned',
    });
    setSaving(false);
    if (row) setForm(EMPTY_OP);
  };

  return (
    <div className={styles.addMatRow}>
      <select
        className={styles.select}
        value={form.order_id}
        onChange={(e) => setForm({ ...form, order_id: e.target.value })}
        aria-label="Заказ"
      >
        <option value="">Заказ…</option>
        {orders.map((o) => (
          <option key={o.id} value={o.id}>
            №{o.bitrix_id || '—'} · {o.title}
          </option>
        ))}
      </select>
      <select
        className={styles.select}
        value={form.op_type}
        onChange={(e) => setForm({ ...form, op_type: e.target.value })}
        aria-label="Тип операции"
      >
        {Object.entries(SUBCONTRACT_OP_TYPE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <select
        className={styles.select}
        value={form.material_source}
        onChange={(e) => setForm({ ...form, material_source: e.target.value })}
        aria-label="Источник материалов"
      >
        {Object.entries(SUBCONTRACT_MATERIAL_SOURCE_LABELS).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      {form.op_type === 'operation' && (
        <select
          className={styles.select}
          value={form.return_dept}
          onChange={(e) => setForm({ ...form, return_dept: e.target.value })}
          aria-label="Возврат на цех"
        >
          <option value="">Возврат на цех…</option>
          {queueDepts.map((d) => (
            <option key={d.code} value={d.code}>{deptShortName(d.code, d.name)}</option>
          ))}
        </select>
      )}
      <input className={styles.input} placeholder="Операция (пошив, вышивка…)" value={form.operation} onChange={(e) => setForm({ ...form, operation: e.target.value })} aria-label="Операция" />
      <input className={styles.input} placeholder="Контрагент" value={form.contractor} onChange={(e) => setForm({ ...form, contractor: e.target.value })} aria-label="Контрагент" style={{ maxWidth: 150 }} />
      <input type="number" min="1" className={styles.input} placeholder="шт" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} aria-label="Количество" style={{ maxWidth: 90 }} />
      <label className={styles.subText}>передан<input type="date" className={styles.input} value={form.sent_date} onChange={(e) => setForm({ ...form, sent_date: e.target.value })} aria-label="Дата передачи" /></label>
      <label className={styles.subText}>готов<input type="date" className={styles.input} value={form.planned_date} onChange={(e) => setForm({ ...form, planned_date: e.target.value })} aria-label="Плановая готовность" /></label>
      <button type="button" className="btn btn-secondary" disabled={saving} onClick={submit}>+ Добавить</button>
    </div>
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
  const [query, setQuery] = useState('');
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => { if (!loaded) loadAll(); }, [loaded, loadAll]);
  useEffect(() => { if (!subcontractingLoaded) loadSubcontracting(); }, [subcontractingLoaded, loadSubcontracting]);

  const activeOrders = useMemo(() => orders.filter((o) => o.status === 'active'), [orders]);
  const queueDepts = useMemo(
    () => departments.filter((d) => d.active && isQueueDept(d.code)),
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

  return (
    <>
      <PageHead
        title="Подряд"
        sub="Операции у внешних подрядчиков: передача, готовность, возврат, задержки."
      />

      <div className={styles.toolbar}>
        <input
          type="search"
          className={`${styles.input} ${styles.searchInput}`}
          placeholder="Поиск: заказ, № сделки, контрагент, операция"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск операций подряда"
        />
        <div className={styles.spacer} />
        <span className={styles.subText}>{rows.length} из {subcontracting.length}</span>
      </div>

      <AddOpRow orders={activeOrders} queueDepts={queueDepts} onAdd={createSubcontractOp} />

      {loadError && !loaded && (
        <div className={styles.emptyState}>
          Не удалось загрузить данные.{' '}
          <button type="button" className="btn btn-secondary" onClick={() => loadAll()}>Повторить</button>
        </div>
      )}
      {subcontractingLoaded && subcontracting.length === 0 && (
        <div className={styles.emptyState}>Операций подряда пока нет — добавьте первую выше.</div>
      )}

      {rows.length > 0 && (
        <div className={styles.tableWrap} style={{ marginTop: 8 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>№ / Заказ</th><th>Тип</th><th>Материалы</th><th>Операция</th><th>Кол-во</th><th>Контрагент</th>
                <th>Передан</th><th>План готов.</th><th>Возврат</th><th>Статус</th><th>Задержка</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((op) => {
                const overdue = subcontractOverdue(op.planned_date, op.returned_date, op.status, today);
                return (
                  <tr key={op.id}>
                    <td>
                      №{op.order?.bitrix_id || '—'}
                      <div className={styles.subText}>{op.order?.title || '—'}</div>
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        value={op.op_type}
                        onChange={(e) => updateSubcontractOp(op.id, {
                          op_type: e.target.value,
                          ...(e.target.value === 'finished_product' ? { return_dept: null } : {}),
                        })}
                        aria-label={`Тип операции ${op.operation}`}
                      >
                        {Object.entries(SUBCONTRACT_OP_TYPE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      {op.op_type === 'operation' && op.return_dept && (
                        <div className={styles.subText}>↩ {deptShortName(op.return_dept, op.return_dept)}</div>
                      )}
                    </td>
                    <td>
                      <span className={`${styles.chip} ${op.material_source === 'contractor' ? styles.chipNeutral : styles.chipProgress}`}>
                        {SUBCONTRACT_MATERIAL_SOURCE_LABELS[op.material_source]}
                      </span>
                    </td>
                    <td>{op.operation}</td>
                    <td>{op.qty ?? '—'}</td>
                    <td>{op.contractor || '—'}</td>
                    <td>{formatDateShort(op.sent_date) || '—'}</td>
                    <td className={overdue ? styles.overdue : undefined}>
                      {formatDateShort(op.planned_date) || '—'}
                      {overdue && <div className={styles.subText}>просрочено</div>}
                    </td>
                    <td>
                      <input
                        type="date"
                        className={styles.input}
                        value={op.returned_date || ''}
                        onChange={(e) => updateSubcontractOp(op.id, {
                          returned_date: e.target.value || null,
                          status: e.target.value ? 'returned' : op.status,
                        })}
                        aria-label={`Дата возврата ${op.operation}`}
                      />
                    </td>
                    <td>
                      <span className={`${styles.chip} ${styles[overdue && op.status !== 'returned' ? 'chipBlocked' : STATUS_CHIP[op.status]]}`}>
                        {overdue && op.status !== 'returned' ? 'Задержка' : SUBCONTRACT_STATUS_LABELS[op.status]}
                      </span>
                      <select
                        className={styles.select}
                        value={op.status}
                        onChange={(e) => updateSubcontractOp(op.id, { status: e.target.value })}
                        aria-label={`Статус операции ${op.operation}`}
                      >
                        {Object.entries(SUBCONTRACT_STATUS_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        placeholder="Комментарий"
                        defaultValue={op.delay_comment || ''}
                        onBlur={(e) => {
                          const val = e.target.value.trim() || null;
                          if (val !== (op.delay_comment || null)) {
                            updateSubcontractOp(op.id, { delay_comment: val });
                          }
                        }}
                        aria-label={`Комментарий задержки ${op.operation}`}
                        style={{ maxWidth: 160 }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
