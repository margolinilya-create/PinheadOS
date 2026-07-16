import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import { useErpStore } from '../store/useErpStore';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { deptShortName } from '../data/departments';
import { EMPLOYEE_ROLE_LABELS } from '../types';
import styles from '../erp.module.css';

/** Сотрудники: CRUD для HR/директора, привязка к цеху, soft-delete. */

const EMPTY = { full_name: '', role: 'worker', department_id: '', notes: '' };

function EmployeeModal({ initial, departments, onSave, onClose }) {
  const [form, setForm] = useState(initial || EMPTY);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.full_name.trim()) { toast.error('Укажите имя'); return; }
    setSaving(true);
    const ok = await onSave({
      full_name: form.full_name.trim(),
      role: form.role,
      department_id: form.department_id || null,
      notes: form.notes?.trim() || null,
    });
    setSaving(false);
    if (ok) onClose();
  };

  return (
    <div className={styles.modalOverlay} onClick={onClose} role="presentation">
      <form
        className={styles.modal}
        style={{ maxWidth: 520 }}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        aria-label={initial ? 'Правка сотрудника' : 'Новый сотрудник'}
      >
        <div className={styles.modalTitle}>{initial ? 'Сотрудник' : 'Новый сотрудник'}</div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Имя *</span>
          <input
            className={styles.input}
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            autoFocus
          />
        </label>
        <div className={styles.formGrid}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Роль</span>
            <select
              className={styles.select}
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
            >
              {Object.entries(EMPLOYEE_ROLE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Цех</span>
            <select
              className={styles.select}
              value={form.department_id || ''}
              onChange={(e) => setForm({ ...form, department_id: e.target.value })}
            >
              <option value="">— без цеха —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Заметка</span>
          <input
            className={styles.input}
            value={form.notes || ''}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="график, особенности…"
          />
        </label>
        <div className={styles.modalActions}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function EmployeesScreen() {
  const {
    employees, employeesLoaded, departments, loaded,
    loadAll, loadEmployees, createEmployee, updateEmployee,
  } = useErpStore(
    useShallow((s) => ({
      employees: s.employees,
      employeesLoaded: s.employeesLoaded,
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
      loadEmployees: s.loadEmployees,
      createEmployee: s.createEmployee,
      updateEmployee: s.updateEmployee,
    })),
  );
  const [modal, setModal] = useState(null); // null | 'new' | employee
  const [showInactive, setShowInactive] = useState(false);

  useEffect(() => {
    if (!loaded) loadAll();
    if (!employeesLoaded) loadEmployees();
  }, [loaded, loadAll, employeesLoaded, loadEmployees]);

  const deptById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );

  const list = useMemo(
    () => employees.filter((e) => showInactive || e.active),
    [employees, showInactive],
  );

  const onDeactivate = async (emp) => {
    const ok = await confirm({
      title: 'Отключить сотрудника?',
      message: `${emp.full_name} останется в истории, но исчезнет из списков.`,
      confirmLabel: 'Отключить',
      variant: 'danger',
    });
    if (ok) await updateEmployee(emp.id, { active: false });
  };

  return (
    <>
      <PageHead title="Сотрудники" sub="Люди по цехам: роли, бригадиры. Отключение — мягкое, история сохраняется." />

      <div className={styles.toolbar}>
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
          />
          Показывать отключённых
        </label>
        <div className={styles.spacer} />
        <span className={styles.subText}>{list.length} чел.</span>
        <button type="button" className="btn btn-primary" onClick={() => setModal('new')}>
          + Сотрудник
        </button>
      </div>

      {employeesLoaded && list.length === 0 && (
        <div className={styles.emptyState}>Сотрудников пока нет — добавьте первого.</div>
      )}

      {list.length > 0 && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Имя</th><th>Роль</th><th>Цех</th><th>Заметка</th><th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {list.map((emp) => {
                const dept = emp.department_id ? deptById.get(emp.department_id) : null;
                return (
                  <tr key={emp.id} style={emp.active ? undefined : { opacity: 0.5 }}>
                    <td>
                      <strong>{emp.full_name}</strong>
                      {!emp.active && <span className={styles.subText}> · отключён</span>}
                    </td>
                    <td>
                      <span className={`${styles.chip} ${emp.role === 'foreman' ? styles.chipProgress : styles.chipNeutral}`}>
                        {EMPLOYEE_ROLE_LABELS[emp.role] || emp.role}
                      </span>
                    </td>
                    <td>{dept ? deptShortName(dept.code, dept.name) : '—'}</td>
                    <td className={styles.subText}>{emp.notes || ''}</td>
                    <td>
                      <button type="button" className="btn btn-ghost" onClick={() => setModal(emp)}>
                        ✎
                      </button>
                      {emp.active ? (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          aria-label={`Отключить ${emp.full_name}`}
                          onClick={() => onDeactivate(emp)}
                        >
                          ✕
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => updateEmployee(emp.id, { active: true })}
                        >
                          ↩
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <EmployeeModal
          initial={modal === 'new' ? null : modal}
          departments={departments}
          onClose={() => setModal(null)}
          onSave={async (fields) => {
            if (modal === 'new') return Boolean(await createEmployee(fields));
            return updateEmployee(modal.id, fields);
          }}
        />
      )}
    </>
  );
}
