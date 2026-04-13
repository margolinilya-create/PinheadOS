// redesign/v2 — Payroll screen
//
// Lists batches. Click to drill into entries. Close button on open
// batches (admin/director only). After close: paid_at stamped, DB
// trigger locks entries forever.

import { useEffect, useMemo, useState } from 'react';
import { usePayrollStore } from '../../../store/usePayrollStore';
import { useWorkersStore } from '../../../store/useWorkersStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { Skeleton } from '../../shared/Skeleton';
import { downloadCsv } from '../../../lib/csvExport';
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
  const reverseEntry = usePayrollStore((st) => st.reverseEntry);

  const workers = useWorkersStore((st) => st.workers);
  const loadWorkers = useWorkersStore((st) => st.loadAll);

  const [expanded, setExpanded] = useState(null);
  const [closing, setClosing] = useState(null);
  const [reversingId, setReversingId] = useState(null);
  const [reversalReason, setReversalReason] = useState('');

  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => { loadWorkers(); }, [loadWorkers]);

  const workerNameById = useMemo(() => {
    const map = {};
    for (const w of workers) map[w.id] = w.full_name;
    return map;
  }, [workers]);

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

  const handleReverseStart = (entryId) => {
    setReversingId(entryId);
    setReversalReason('');
  };

  const handleReverseCancel = () => {
    setReversingId(null);
    setReversalReason('');
  };

  const handleReverseConfirm = async (entry) => {
    const created = await reverseEntry(entry, reversalReason);
    if (created) {
      toast.success?.('Сторно создано') ?? null;
      setReversingId(null);
      setReversalReason('');
      // Reload entries — the new reversal lives in the open batch.
      await loadEntriesForBatch(created.batch_id);
      // Refresh batches in case a new one was auto-created.
      await usePayrollStore.getState().loadBatches();
    }
  };

  const handleExportCsv = (batch, batchEntries) => {
    const headers = [
      'period_start', 'period_end', 'batch_status',
      'worker', 'entry_type', 'qty', 'rate', 'amount',
      'reason', 'paid_at', 'created_at',
    ];
    const rows = batchEntries.map((e) => [
      batch.period_start,
      batch.period_end,
      batch.status,
      workerNameById[e.worker_id] ?? e.worker_id,
      e.entry_type,
      e.qty,
      e.rate,
      e.amount,
      e.reason ?? '',
      e.paid_at ?? '',
      e.created_at,
    ]);
    const filename = `payroll_${batch.period_start}_${batch.period_end}.csv`;
    downloadCsv(filename, headers, rows);
    toast.success?.('CSV выгружен') ?? null;
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

      {loading && batches.length === 0 && (
        <div className={s.skeletonRow}>
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      )}

      {batches.length === 0 && !loading && (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>💰</span>
          <div className={s.emptyStateTitle}>Periods нет</div>
          <p>Они создадутся автоматически когда мастер запишет первую сделку.</p>
        </div>
      )}

      {batches.map((b) => {
        const entries = entriesByBatch[b.id] ?? [];
        const totals = entries.reduce((acc, e) => acc + Number(e.amount), 0);
        const isExpanded = expanded === b.id;
        return (
          <div key={b.id} className={`${s.card} ${s.cardClickable}`} onClick={() => toggle(b.id)}>
            <div className={s.expanderHeader}>
              <div>
                <strong>{b.period_start} … {b.period_end}</strong>
                {' '}
                <span className={`${s.badge} ${b.status === 'open' ? s.badgeOpen : s.badgeClosed}`}>
                  {b.status === 'open' ? 'открыт' : 'закрыт'}
                </span>
              </div>
              <div className={s.subtitle} style={{ margin: 0 }}>
                {isExpanded ? '▼' : '▶'} {entries.length || '?'} записей
              </div>
            </div>

            {isExpanded && (
              <div style={{ marginTop: 16 }} onClick={(e) => e.stopPropagation()}>
                {entries.length === 0 ? (
                  <p className={s.empty}>В этом period'е ещё нет начислений.</p>
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
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {entries.map((e) => {
                        const canReverse = canClose
                          && e.entry_type !== 'reversal_of'
                          && Number(e.amount) !== 0;
                        const isReversingThis = reversingId === e.id;
                        return (
                          <tr key={e.id}>
                            <td>{ENTRY_TYPE_LABEL[e.entry_type] ?? e.entry_type}</td>
                            <td>{workerNameById[e.worker_id] ?? `${e.worker_id.slice(0, 8)}…`}</td>
                            <td className={s.numCol}>{e.qty}</td>
                            <td className={s.numCol}>{e.rate}</td>
                            <td className={s.numCol} style={{ fontWeight: 600 }}>{e.amount}₽</td>
                            <td>
                              {isReversingThis ? (
                                <input
                                  type="text"
                                  placeholder="Причина сторно"
                                  value={reversalReason}
                                  onChange={(ev) => setReversalReason(ev.target.value)}
                                  autoFocus
                                  style={{ width: '100%' }}
                                />
                              ) : (
                                e.reason ?? '—'
                              )}
                            </td>
                            <td className={s.numCol}>
                              {e.paid_at ? new Date(e.paid_at).toLocaleDateString('ru-RU') : '—'}
                            </td>
                            <td className={s.numCol}>
                              {isReversingThis ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => handleReverseConfirm(e)}
                                    disabled={!reversalReason.trim()}
                                  >
                                    OK
                                  </button>
                                  {' '}
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={handleReverseCancel}
                                  >
                                    Отмена
                                  </button>
                                </>
                              ) : canReverse ? (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => handleReverseStart(e.id)}
                                  title="Создать новую запись reversal_of с обратной суммой"
                                >
                                  Сторно
                                </button>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className={s.totalsRow}>
                        <td colSpan={4} className={s.numCol}>Итого:</td>
                        <td className={s.numCol}>{totals.toFixed(2)}₽</td>
                        <td colSpan={3}></td>
                      </tr>
                    </tbody>
                  </table>
                )}

                <div style={{ marginTop: 16, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {entries.length > 0 && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => handleExportCsv(b, entries)}
                      title="Скачать CSV для импорта в 1С / банк"
                    >
                      📥 CSV
                    </button>
                  )}
                  {b.status === 'open' && canClose && (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => handleClose(b.id)}
                      disabled={closing === b.id}
                    >
                      Закрыть period (заморозить записи)
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
