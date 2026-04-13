// redesign/v2 — Payroll screen
//
// Lists batches. Click to drill into entries. Close button on open
// batches (admin/director only). After close: paid_at stamped, DB
// trigger locks entries forever.

import { useEffect, useState } from 'react';
import { usePayrollStore } from '../../../store/usePayrollStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import s from './v2.module.css';

const ENTRY_TYPE_LABEL = {
  accrual: 'начисление',
  rework_penalty: 'штраф за брак',
  defect_penalty: 'штраф за дефект',
  bonus: 'премия',
  manual_adjustment: 'корректировка',
  reversal_of: 'сторно',
};

export default function PayrollScreen() {
  useDocumentTitle('Payroll');
  const role = useAuthStore((st) => st.effectiveRole());
  const canClose = ['admin', 'director'].includes(role);

  const batches = usePayrollStore((st) => st.batches);
  const entriesByBatch = usePayrollStore((st) => st.entriesByBatch);
  const loading = usePayrollStore((st) => st.loading);
  const loadBatches = usePayrollStore((st) => st.loadBatches);
  const loadEntriesForBatch = usePayrollStore((st) => st.loadEntriesForBatch);
  const closeBatch = usePayrollStore((st) => st.closeBatch);

  const [expanded, setExpanded] = useState(null);
  const [closing, setClosing] = useState(null);

  useEffect(() => { loadBatches(); }, [loadBatches]);

  const toggle = async (batchId) => {
    if (expanded === batchId) {
      setExpanded(null);
      return;
    }
    setExpanded(batchId);
    if (!entriesByBatch[batchId]) {
      await loadEntriesForBatch(batchId);
    }
  };

  const handleClose = async (batchId) => {
    if (!window.confirm(
      'Закрыть period? После этого записи будут заморожены навсегда. Корректировки — только через новые reversal_of записи.'
    )) return;
    setClosing(batchId);
    const ok = await closeBatch(batchId);
    setClosing(null);
    if (ok) toast.success?.('Period закрыт') ?? null;
  };

  return (
    <div className={s.page}>
      <h1>Payroll</h1>
      <p className={s.subtitle}>
        Периоды и сдельные начисления. Закрытые периоды неизменяемы на уровне БД.
      </p>

      {loading && batches.length === 0 && <div className="panel-loading">Загрузка…</div>}

      {batches.length === 0 && !loading && (
        <p className={s.empty}>Пока нет ни одного period'а.</p>
      )}

      {batches.map((b) => {
        const entries = entriesByBatch[b.id] ?? [];
        const totals = entries.reduce((acc, e) => acc + Number(e.amount), 0);
        const isExpanded = expanded === b.id;
        return (
          <div key={b.id} className={s.card}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => toggle(b.id)}
            >
              <div>
                <strong>{b.period_start} … {b.period_end}</strong>
                <span className={`${s.badge} ${b.status === 'open' ? s.badgeOpen : s.badgeClosed}`} style={{ marginLeft: 12 }}>
                  {b.status === 'open' ? 'открыт' : 'закрыт'}
                </span>
              </div>
              <div className={s.subtitle} style={{ margin: 0 }}>
                {isExpanded ? '▼' : '▶'} {entries.length || '?'} записей
              </div>
            </div>

            {isExpanded && (
              <div style={{ marginTop: 12 }}>
                {entries.length === 0 ? (
                  <p className={s.empty}>Нет записей.</p>
                ) : (
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>Тип</th>
                        <th>Работник</th>
                        <th className={s.numCol}>Кол-во</th>
                        <th className={s.numCol}>Тариф</th>
                        <th className={s.numCol}>Сумма</th>
                        <th>Причина</th>
                        <th className={s.numCol}>Оплачено</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => (
                        <tr key={e.id}>
                          <td>{ENTRY_TYPE_LABEL[e.entry_type] ?? e.entry_type}</td>
                          <td>{e.worker_id.slice(0, 8)}…</td>
                          <td className={s.numCol}>{e.qty}</td>
                          <td className={s.numCol}>{e.rate}</td>
                          <td className={s.numCol} style={{ fontWeight: 600 }}>{e.amount}₽</td>
                          <td>{e.reason ?? '—'}</td>
                          <td className={s.numCol}>
                            {e.paid_at ? new Date(e.paid_at).toLocaleDateString('ru-RU') : '—'}
                          </td>
                        </tr>
                      ))}
                      <tr className={s.totalsRow}>
                        <td colSpan={4} className={s.numCol}>Итого:</td>
                        <td className={s.numCol}>{totals.toFixed(2)}₽</td>
                        <td colSpan={2}></td>
                      </tr>
                    </tbody>
                  </table>
                )}

                {b.status === 'open' && canClose && (
                  <div style={{ marginTop: 16 }}>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleClose(b.id)}
                      disabled={closing === b.id}
                    >
                      Закрыть period (заморозить записи)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
