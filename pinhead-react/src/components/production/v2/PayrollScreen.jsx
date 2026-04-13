// redesign/v2 — Payroll screen (W3 Day-6)
//
// Lists batches. Click to drill into entries. Close button on open
// batches (admin/director only). After close: paid_at is stamped on
// all entries and the DB trigger locks them forever (ADR-0002,
// ADR-0007). Corrections happen as new reversal_of entries.

import { useEffect, useState } from 'react';
import { usePayrollStore } from '../../../store/usePayrollStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';

const ENTRY_TYPE_LABEL = {
  accrual: 'начисление',
  rework_penalty: 'штраф за брак',
  defect_penalty: 'штраф за дефект',
  bonus: 'премия',
  manual_adjustment: 'корректировка',
  reversal_of: 'сторно',
};

export default function PayrollScreen() {
  const role = useAuthStore((s) => s.effectiveRole());
  const canClose = ['admin', 'director'].includes(role);

  const batches = usePayrollStore((s) => s.batches);
  const entriesByBatch = usePayrollStore((s) => s.entriesByBatch);
  const loading = usePayrollStore((s) => s.loading);
  const loadBatches = usePayrollStore((s) => s.loadBatches);
  const loadEntriesForBatch = usePayrollStore((s) => s.loadEntriesForBatch);
  const closeBatch = usePayrollStore((s) => s.closeBatch);

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
    <div className="container" style={{ maxWidth: 1100 }}>
      <h1>Payroll</h1>
      <p style={{ opacity: 0.7 }}>
        Периоды и сдельные начисления. Закрытые периоды неизменяемы на уровне БД.
      </p>

      {loading && batches.length === 0 && <div className="panel-loading">Загрузка…</div>}

      {batches.length === 0 && !loading && (
        <p style={{ opacity: 0.6 }}>Пока нет ни одного period'а.</p>
      )}

      {batches.map((b) => {
        const entries = entriesByBatch[b.id] ?? [];
        const totals = entries.reduce((acc, e) => acc + Number(e.amount), 0);
        const isExpanded = expanded === b.id;
        return (
          <div key={b.id} className="panel" style={{ marginBottom: 'var(--space-3)' }}>
            <div
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => toggle(b.id)}
            >
              <div>
                <strong>{b.period_start} … {b.period_end}</strong>
                <span style={{
                  marginLeft: 'var(--space-2)',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontSize: '0.8em',
                  background: b.status === 'open' ? '#10b98133' : '#64748b33',
                  color: b.status === 'open' ? '#10b981' : '#64748b',
                }}>
                  {b.status === 'open' ? 'открыт' : 'закрыт'}
                </span>
              </div>
              <div style={{ opacity: 0.7 }}>
                {isExpanded ? '▼' : '▶'} {entries.length || '?'} записей
              </div>
            </div>

            {isExpanded && (
              <div style={{ marginTop: 'var(--space-2)' }}>
                {entries.length === 0 ? (
                  <p style={{ opacity: 0.5 }}>Нет записей.</p>
                ) : (
                  <>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85em' }}>
                      <thead>
                        <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                          <th>Тип</th>
                          <th>Работник</th>
                          <th style={{ textAlign: 'right' }}>Кол-во</th>
                          <th style={{ textAlign: 'right' }}>Тариф</th>
                          <th style={{ textAlign: 'right' }}>Сумма</th>
                          <th>Причина</th>
                          <th style={{ textAlign: 'right' }}>Оплачено</th>
                        </tr>
                      </thead>
                      <tbody>
                        {entries.map((e) => (
                          <tr key={e.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                            <td>{ENTRY_TYPE_LABEL[e.entry_type] ?? e.entry_type}</td>
                            <td>{e.worker_id.slice(0, 8)}…</td>
                            <td style={{ textAlign: 'right' }}>{e.qty}</td>
                            <td style={{ textAlign: 'right' }}>{e.rate}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{e.amount}₽</td>
                            <td style={{ opacity: 0.6 }}>{e.reason ?? '—'}</td>
                            <td style={{ textAlign: 'right', opacity: 0.6 }}>
                              {e.paid_at ? new Date(e.paid_at).toLocaleDateString('ru-RU') : '—'}
                            </td>
                          </tr>
                        ))}
                        <tr style={{ fontWeight: 700 }}>
                          <td colSpan={4} style={{ textAlign: 'right' }}>Итого:</td>
                          <td style={{ textAlign: 'right' }}>{totals.toFixed(2)}₽</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  </>
                )}

                {b.status === 'open' && canClose && (
                  <div style={{ marginTop: 'var(--space-3)' }}>
                    <button
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

