// redesign/v2 — Мастер-экран бригадира (W3 Day-4)
//
// Section-scoped view: list of operations in my section + workers. Each
// op has a quick "log piecework" mini-form that pre-fills from the
// snapshotted rate (ADR-0002) so the foreman only picks worker + qty.
//
// Creates a piecework_entries row of entry_type='accrual' linked to
// the current open batch (or prompts to create one if none open).

import { useEffect, useMemo, useState } from 'react';
import { useForemanStore } from '../../../store/useForemanStore';
import { useTechCardStore } from '../../../store/useTechCardStore';
import { usePayrollStore } from '../../../store/usePayrollStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';

export default function ForemanScreen() {
  const role = useAuthStore((s) => s.effectiveRole());
  const canWrite = ['admin', 'director', 'production'].includes(role);

  const sections = useTechCardStore((s) => s.sections);
  const catalogLoaded = useTechCardStore((s) => s.catalogLoaded);
  const loadCatalog = useTechCardStore((s) => s.loadCatalog);

  const sectionId = useForemanStore((s) => s.sectionId);
  const operations = useForemanStore((s) => s.operations);
  const sectionWorkers = useForemanStore((s) => s.sectionWorkers);
  const loading = useForemanStore((s) => s.loading);
  const loadSection = useForemanStore((s) => s.loadSection);
  const refresh = useForemanStore((s) => s.refresh);

  const batches = usePayrollStore((s) => s.batches);
  const loadBatches = usePayrollStore((s) => s.loadBatches);
  const createBatch = usePayrollStore((s) => s.createBatch);
  const createEntry = usePayrollStore((s) => s.createEntry);

  const [selectedSection, setSelectedSection] = useState('');
  const [entryForms, setEntryForms] = useState({}); // opId → {workerId, qty}

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => {
    if (selectedSection) loadSection(selectedSection);
  }, [selectedSection, loadSection]);

  const openBatch = useMemo(() => batches.find((b) => b.status === 'open'), [batches]);

  const ensureOpenBatch = async () => {
    if (openBatch) return openBatch;
    // Convenience: create a monthly batch for the current month.
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    const batch = await createBatch(start, end, 'Авто-создана из мастер-экрана');
    return batch;
  };

  const handleFormChange = (opId, patch) => {
    setEntryForms((prev) => ({
      ...prev,
      [opId]: { ...(prev[opId] ?? { workerId: '', qty: '' }), ...patch },
    }));
  };

  const handleLogEntry = async (op) => {
    const form = entryForms[op.id];
    if (!form?.workerId) {
      toast.error('Выберите работника');
      return;
    }
    const qty = Number(form.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Введите кол-во');
      return;
    }
    const batch = await ensureOpenBatch();
    if (!batch) return;

    const created = await createEntry({
      batch_id: batch.id,
      worker_id: form.workerId,
      tech_operation_id: op.id,
      entry_type: 'accrual',
      qty,
      rate: op.rate_snapshot,
      amount: op.rate_snapshot * qty,
      reason: null,
      reversal_of: null,
    });
    if (created) {
      toast.success?.('Запись создана') ?? null;
      setEntryForms((prev) => ({ ...prev, [op.id]: { workerId: '', qty: '' } }));
      refresh();
    }
  };

  if (!catalogLoaded) return <div className="panel-loading">Загрузка…</div>;

  return (
    <div className="container" style={{ maxWidth: 1100 }}>
      <h1>Мастер-экран</h1>
      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
        <label>
          Участок:{' '}
          <select value={selectedSection} onChange={(e) => setSelectedSection(e.target.value)}>
            <option value="">—</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <div style={{ opacity: 0.7 }}>
          {openBatch
            ? <>Открыт period: <code>{openBatch.period_start}…{openBatch.period_end}</code></>
            : <>Нет открытого period — будет создан автоматически при первой записи</>}
        </div>
      </div>

      {!sectionId && (
        <p style={{ opacity: 0.6, marginTop: 'var(--space-3)' }}>
          Выберите участок, чтобы увидеть задачи и работников.
        </p>
      )}

      {sectionId && loading && <div className="panel-loading">Загрузка участка…</div>}

      {sectionId && !loading && (
        <>
          <section style={{ marginTop: 'var(--space-3)' }}>
            <h2>Задачи ({operations.length})</h2>
            {operations.length === 0 ? (
              <p style={{ opacity: 0.6 }}>Нет утверждённых задач для этого участка.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                    <th>Операция</th>
                    <th>Заказ</th>
                    <th style={{ textAlign: 'right' }}>Кол-во</th>
                    <th style={{ textAlign: 'right' }}>Тариф</th>
                    <th>Работник</th>
                    <th>Факт</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => {
                    const form = entryForms[op.id] ?? { workerId: '', qty: '' };
                    return (
                      <tr key={op.id} style={{ borderBottom: '1px solid var(--color-border-subtle)' }}>
                        <td>{op.name_snapshot}</td>
                        <td>{op.order_number ?? op.order_id.slice(0, 8)}</td>
                        <td style={{ textAlign: 'right' }}>{op.qty}</td>
                        <td style={{ textAlign: 'right' }}>{op.rate_snapshot}₽/{op.unit_snapshot}</td>
                        <td>
                          <select
                            value={form.workerId}
                            onChange={(e) => handleFormChange(op.id, { workerId: e.target.value })}
                            disabled={!canWrite}
                          >
                            <option value="">— работник —</option>
                            {sectionWorkers.map((w) => (
                              <option key={w.id} value={w.id}>{w.full_name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={form.qty}
                            onChange={(e) => handleFormChange(op.id, { qty: e.target.value })}
                            style={{ width: 70 }}
                            disabled={!canWrite}
                          />
                        </td>
                        <td>
                          <button
                            className="btn btn-primary"
                            onClick={() => handleLogEntry(op)}
                            disabled={!canWrite || !form.workerId || !form.qty}
                          >
                            Записать
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>

          <section style={{ marginTop: 'var(--space-4)' }}>
            <h3>Работники на участке ({sectionWorkers.length})</h3>
            {sectionWorkers.length === 0 ? (
              <p style={{ opacity: 0.6 }}>Не назначено. Добавьте работников через раздел HR.</p>
            ) : (
              <ul>
                {sectionWorkers.map((w) => (
                  <li key={w.id}>{w.full_name} · {w.hourly_rate}₽/час</li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
