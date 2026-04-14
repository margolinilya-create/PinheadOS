// redesign/v2 — Workers CRUD screen
//
// HR-level admin: list, create, edit hourly rate inline, soft delete.
// Restricted via RLS to admin/director or senior_foreman (workers_write_*
// policy from 20260504).

import { useEffect, useMemo, useState } from 'react';
import { useWorkersStore } from '../../../store/useWorkersStore';
import { useTechCardStore } from '../../../store/useTechCardStore';
import { useAuthStore } from '../../../store/useAuthStore';
import { useDocumentTitle } from '../../../hooks/useDocumentTitle';
import { toast } from '../../../store/useToastStore';
import { confirm } from '../../../store/useConfirmStore';
import { useUndoStore } from '../../../store/useUndoStore';
import { Skeleton } from '../../shared/Skeleton';
import { downloadCsv } from '../../../lib/csvExport';
import s from './v2.module.css';

export default function WorkersScreen() {
  useDocumentTitle('Работники');
  const role = useAuthStore((st) => st.effectiveRole());
  const canWrite = ['admin', 'director'].includes(role);

  const workers = useWorkersStore((st) => st.workers);
  const loading = useWorkersStore((st) => st.loading);
  const loadAll = useWorkersStore((st) => st.loadAll);
  const create = useWorkersStore((st) => st.create);
  const update = useWorkersStore((st) => st.update);
  const softDelete = useWorkersStore((st) => st.softDelete);
  const restore = useWorkersStore((st) => st.restore);
  const pushUndo = useUndoStore((st) => st.push);

  const sections = useTechCardStore((st) => st.sections);
  const catalogLoaded = useTechCardStore((st) => st.catalogLoaded);
  const loadCatalog = useTechCardStore((st) => st.loadCatalog);

  const [form, setForm] = useState({ full_name: '', section_id: '', hourly_rate: '300' });
  const [submitting, setSubmitting] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) return workers;
    const q = search.trim().toLowerCase();
    return workers.filter((w) => w.full_name.toLowerCase().includes(q));
  }, [workers, search]);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { loadCatalog(); }, [loadCatalog]);

  const handleCreate = async () => {
    const name = form.full_name.trim();
    if (!name) {
      toast.error('Введите имя');
      return;
    }
    const rate = Number(form.hourly_rate);
    if (!Number.isFinite(rate) || rate < 0) {
      toast.error('Тариф должен быть положительным числом');
      return;
    }
    setSubmitting(true);
    const created = await create({
      full_name: name,
      section_id: form.section_id || null,
      hourly_rate: rate,
      profile_id: null,
      tenant_id: '00000000-0000-0000-0000-000000000001',
    });
    setSubmitting(false);
    if (created) {
      toast.success?.('Работник добавлен') ?? null;
      setForm({ full_name: '', section_id: '', hourly_rate: '300' });
    }
  };

  const handleSectionChange = (workerId, sectionId) => {
    update(workerId, { section_id: sectionId || null });
  };

  const handleRateChange = (workerId, value) => {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate < 0) return;
    update(workerId, { hourly_rate: rate });
  };

  const handleDelete = async (worker) => {
    const ok = await confirm({
      title: `Удалить ${worker.full_name}?`,
      message: 'Soft-delete — 5 секунд на отмену через тост.',
      confirmLabel: 'Удалить',
      variant: 'danger',
    });
    if (!ok) return;
    const deleted = await softDelete(worker.id);
    if (deleted) {
      pushUndo({
        label: `${worker.full_name} удалён`,
        restore: () => restore(worker.id),
      });
    }
  };

  const handleExportCsv = () => {
    const headers = ['full_name', 'section', 'hourly_rate', 'created_at'];
    const rows = filtered.map((w) => {
      const section = sections.find((sec) => sec.id === w.section_id);
      return [w.full_name, section?.name ?? '', w.hourly_rate, w.created_at];
    });
    downloadCsv(`workers_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
    toast.success?.('CSV выгружен') ?? null;
  };

  if (!catalogLoaded || loading) {
    return (
      <div className={s.page}>
        <h1>Работники</h1>
        <div className={s.skeletonRow}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </div>
      </div>
    );
  }

  return (
    <div className={s.page}>
      <h1>Работники</h1>
      <p className={s.subtitle}>
        {workers.length} активных. Привязка к участку определяет где работник видим в /foreman.
      </p>

      {canWrite && (
        <div className={s.card}>
          <h3>Добавить работника</h3>
          <div className={s.formRow}>
            <input
              type="text"
              placeholder="Имя Фамилия"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              style={{ minWidth: 240 }}
            />
            <select
              value={form.section_id}
              onChange={(e) => setForm((f) => ({ ...f, section_id: e.target.value }))}
            >
              <option value="">— участок —</option>
              {sections.map((sec) => (
                <option key={sec.id} value={sec.id}>{sec.name}</option>
              ))}
            </select>
            <input
              type="number"
              min="0"
              step="10"
              value={form.hourly_rate}
              onChange={(e) => setForm((f) => ({ ...f, hourly_rate: e.target.value }))}
              style={{ width: 100 }}
              aria-label="Часовой тариф"
              placeholder="₽/час"
            />
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={submitting}
            >
              Добавить
            </button>
          </div>
        </div>
      )}

      {workers.length > 0 && (
        <div className={s.formRow}>
          <input
            type="search"
            placeholder="Поиск по имени"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={s.searchInput}
          />
          <span className={s.spacer} />
          <span className={s.subtitle} style={{ margin: 0 }}>
            {filtered.length} из {workers.length}
          </span>
          <button type="button" className="btn btn-ghost" onClick={handleExportCsv} title="Выгрузить в CSV">
            📥 CSV
          </button>
        </div>
      )}

      {workers.length === 0 ? (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>👤</span>
          <div className={s.emptyStateTitle}>Работников ещё нет</div>
          <p>Добавьте первого работника через форму выше.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className={s.emptyState}>
          <span className={s.emptyStateIcon}>🔍</span>
          <div className={s.emptyStateTitle}>Никого не найдено</div>
        </div>
      ) : (
        <table className={s.table}>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Участок</th>
              <th className={s.numCol}>Тариф ₽/час</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((w) => {
              const section = sections.find((sec) => sec.id === w.section_id);
              return (
                <tr key={w.id}>
                  <td><strong>{w.full_name}</strong></td>
                  <td>
                    {canWrite ? (
                      <select
                        value={w.section_id ?? ''}
                        onChange={(e) => handleSectionChange(w.id, e.target.value)}
                      >
                        <option value="">— нет —</option>
                        {sections.map((sec) => (
                          <option key={sec.id} value={sec.id}>{sec.name}</option>
                        ))}
                      </select>
                    ) : (
                      section?.name ?? '—'
                    )}
                  </td>
                  <td className={s.numCol}>
                    {canWrite ? (
                      <input
                        type="number"
                        min="0"
                        step="10"
                        defaultValue={w.hourly_rate}
                        onBlur={(e) => handleRateChange(w.id, e.target.value)}
                        className={s.qtyInput}
                        style={{ width: 100 }}
                      />
                    ) : (
                      `${w.hourly_rate}₽`
                    )}
                  </td>
                  <td className={s.numCol}>
                    {canWrite && (
                      <button
                        type="button"
                        className={s.removeBtn}
                        onClick={() => handleDelete(w)}
                        aria-label="Удалить"
                        title="Удалить (soft delete)"
                      >
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
