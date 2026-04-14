// redesign/v2 — Мастер-экран бригадира
//
// Section-scoped view: list of operations + workers + inline piecework
// entry form. Auto-creates a monthly batch on first entry if none open.

import { useEffect, useMemo, useState } from 'react';
import { useForemanStore } from '../../../store/useForemanStore';
import { useTechCardStore } from '../../../store/useTechCardStore';
import { usePayrollStore } from '../../../store/usePayrollStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { toast } from '../../../store/useToastStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import s from './v2.module.css';

export default function ForemanScreen() {
  useDocumentTitle('Мастер-экран');
  const role = useAuthStore((st) => st.effectiveRole());
  const canWrite = ['admin', 'director', 'production'].includes(role);

  const sections = useTechCardStore((st) => st.sections);
  const catalogLoaded = useTechCardStore((st) => st.catalogLoaded);
  const loadCatalog = useTechCardStore((st) => st.loadCatalog);

  const sectionId = useForemanStore((st) => st.sectionId);
  const operations = useForemanStore((st) => st.operations);
  const sectionWorkers = useForemanStore((st) => st.sectionWorkers);
  const loading = useForemanStore((st) => st.loading);
  const loadSection = useForemanStore((st) => st.loadSection);
  const refresh = useForemanStore((st) => st.refresh);

  const batches = usePayrollStore((st) => st.batches);
  const loadBatches = usePayrollStore((st) => st.loadBatches);
  const createBatch = usePayrollStore((st) => st.createBatch);
  const createEntry = usePayrollStore((st) => st.createEntry);

  const [selectedSection, setSelectedSection] = useState('');
  const [entryForms, setEntryForms] = useState({});

  useEffect(() => { loadCatalog(); }, [loadCatalog]);
  useEffect(() => { loadBatches(); }, [loadBatches]);
  useEffect(() => {
    if (selectedSection) loadSection(selectedSection);
  }, [selectedSection, loadSection]);

  const openBatch = useMemo(() => batches.find((b) => b.status === 'open'), [batches]);

  const ensureOpenBatch = async () => {
    if (openBatch) return openBatch;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return createBatch(start, end, 'Авто-создана из мастер-экрана');
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

  if (!catalogLoaded) {
    return (
      <div className={s.page}>
        <h1>Мастер-экран</h1>
        <div className={s.skeletonRow}>
          <div className="skeleton" style={{ height: 200, borderRadius: 12 }} />
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <h1>Мастер-экран</h1>
      <div className={s.formRow}>
        <label>
          Участок:{' '}
          <select value={selectedSection} onChange={(e) => setSelectedSection(e.target.value)}>
            <option value="">—</option>
            {sections.map((sec) => (
              <option key={sec.id} value={sec.id}>{sec.name}</option>
            ))}
          </select>
        </label>
        <span className={s.subtitle} style={{ margin: 0 }}>
          {openBatch
            ? <>Открыт период: <span className={s.code}>{openBatch.period_start}…{openBatch.period_end}</span></>
            : <>Период не открыт — будет создан автоматически при первой записи</>}
        </span>
      </div>

      {!sectionId && (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>👷</span>
          <div className={s.emptyStateTitle}>Выберите участок</div>
          <p>Чтобы увидеть задачи и работников.</p>
        </div>
      )}

      {sectionId && loading && (
        <div className={s.skeletonRow}>
          <div className="skeleton" style={{ height: 64, borderRadius: 8 }} />
          <div className="skeleton" style={{ height: 64, borderRadius: 8 }} />
        </div>
      )}

      {sectionId && !loading && (
        <>
          <section className={s.section}>
            <h2>Задачи ({operations.length})</h2>
            {operations.length === 0 ? (
              <p className={s.empty}>Нет утверждённых задач для этого участка.</p>
            ) : (
              <table className={s.table}>
                <thead>
                  <tr>
                    <th>Операция</th>
                    <th>Заказ</th>
                    <th className={s.numCol}>Кол-во</th>
                    <th className={s.numCol}>Тариф</th>
                    <th>Работник</th>
                    <th>Факт</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {operations.map((op) => {
                    const form = entryForms[op.id] ?? { workerId: '', qty: '' };
                    return (
                      <tr key={op.id}>
                        <td>{op.name_snapshot}</td>
                        <td>{op.order_number ?? op.order_id.slice(0, 8)}</td>
                        <td className={s.numCol}>{op.qty}</td>
                        <td className={s.numCol}>{op.rate_snapshot}₽/{op.unit_snapshot}</td>
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
                            className={s.qtyInput}
                            disabled={!canWrite}
                          />
                        </td>
                        <td>
                          <button
                            type="button"
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

          <section className={s.section}>
            <h3>Работники на участке ({sectionWorkers.length})</h3>
            {sectionWorkers.length === 0 ? (
              <p className={s.empty}>Не назначено. Добавьте работников через раздел HR.</p>
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
