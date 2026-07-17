import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { PageHead } from '../components/PageHead';
import InlineEdit from '../components/InlineEdit';
import { useErpStore } from '../store/useErpStore';
import { confirm } from '../../store/useConfirmStore';
import { toast } from '../../store/useToastStore';
import { deptShortName } from '../data/departments';
import { ROLE_LABELS, ALL_ROLES } from '../../data/roles';
import { EMPLOYEE_ROLE_LABELS } from '../types';
import styles from '../erp.module.css';

/**
 * Сотрудники — ЕДИНЫЙ источник с Order Studio (таблица profiles).
 * Формат и действия как в Админке (роль, Подтвердить/Отключить/Вернуть)
 * + цеховая надстройка ERP (цех, цеховая роль, заметка) в erp_employees.
 * Отдельно внизу — цеховые работники без логина.
 */

function statusChip(p) {
  if (p.active === false) return { cls: 'chipBlocked', label: 'Отключён' };
  if (!p.approved) return { cls: 'chipProgress', label: 'Ждёт подтверждения' };
  return { cls: 'chipReady', label: 'Активен' };
}

export default function EmployeesScreen() {
  const {
    employees, profilesList, employeesLoaded, departments, loaded,
    loadAll, loadEmployees, createEmployee, updateEmployee,
    updateProfile, upsertProfileDept,
  } = useErpStore(
    useShallow((s) => ({
      employees: s.employees,
      profilesList: s.profilesList,
      employeesLoaded: s.employeesLoaded,
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
      loadEmployees: s.loadEmployees,
      createEmployee: s.createEmployee,
      updateEmployee: s.updateEmployee,
      updateProfile: s.updateProfile,
      upsertProfileDept: s.upsertProfileDept,
    })),
  );
  const [showInactive, setShowInactive] = useState(false);
  const [newName, setNewName] = useState('');

  useEffect(() => {
    if (!loaded) loadAll();
    if (!employeesLoaded) loadEmployees();
  }, [loaded, loadAll, employeesLoaded, loadEmployees]);

  const empByProfile = useMemo(
    () => new Map(employees.filter((e) => e.profile_id).map((e) => [e.profile_id, e])),
    [employees],
  );

  const profileRows = useMemo(
    () => profilesList.filter((p) => showInactive || p.active !== false),
    [profilesList, showInactive],
  );
  const looseEmployees = useMemo(
    () => employees.filter((e) => !e.profile_id && (showInactive || e.active)),
    [employees, showInactive],
  );

  const onDisable = async (p) => {
    const ok = await confirm({
      title: 'Отключить пользователя?',
      message: `${p.name || p.email} потеряет доступ. Это мягкое отключение — как в Админке.`,
      confirmLabel: 'Отключить',
      variant: 'danger',
    });
    if (ok) await updateProfile(p.id, { active: false, approved: false });
  };

  return (
    <>
      <PageHead
        title="Сотрудники"
        sub="Единый список с Order Studio: логины, роли и статусы общие. Здесь же — привязка к цеху."
      />

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
        <span className={styles.subText}>
          {profileRows.length} с логином · {looseEmployees.length} без логина
        </span>
      </div>

      {employeesLoaded && profileRows.length === 0 && looseEmployees.length === 0 && (
        <div className={styles.emptyState}>Пользователей не видно — нужны права администратора.</div>
      )}

      {profileRows.length > 0 && (
        <div className={styles.tableWrap} style={{ marginBottom: 16 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Имя</th><th>Email</th><th>Роль</th><th>Цех</th>
                <th>Цеховая роль</th><th>Статус</th><th aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {profileRows.map((p) => {
                const emp = empByProfile.get(p.id);
                const st = statusChip(p);
                return (
                  <tr key={p.id} style={p.active === false ? { opacity: 0.55 } : undefined}>
                    <td><strong>{p.name || '—'}</strong></td>
                    <td className={styles.subText}>{p.email}</td>
                    <td>
                      <select
                        className={styles.select}
                        style={{ minHeight: 32, padding: '3px 6px' }}
                        value={p.role}
                        aria-label={`Роль ${p.name || p.email}`}
                        onChange={(e) => updateProfile(p.id, { role: e.target.value })}
                      >
                        {ALL_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        style={{ minHeight: 32, padding: '3px 6px' }}
                        value={emp?.department_id || ''}
                        aria-label={`Цех ${p.name || p.email}`}
                        onChange={(e) =>
                          upsertProfileDept(p, { department_id: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {deptShortName(d.code, d.name)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        style={{ minHeight: 32, padding: '3px 6px' }}
                        value={emp?.role || 'worker'}
                        aria-label={`Цеховая роль ${p.name || p.email}`}
                        onChange={(e) => upsertProfileDept(p, { role: e.target.value })}
                      >
                        {Object.entries(EMPLOYEE_ROLE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`${styles.chip} ${styles[st.cls]}`}>{st.label}</span>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {p.active === false ? (
                        <button type="button" className="btn btn-secondary"
                          onClick={() => updateProfile(p.id, { active: true })}>
                          Вернуть
                        </button>
                      ) : !p.approved ? (
                        <>
                          <button type="button" className="btn btn-primary"
                            onClick={() => updateProfile(p.id, { approved: true })}>
                            Подтвердить
                          </button>{' '}
                          <button type="button" className="btn btn-ghost"
                            aria-label={`Отключить ${p.name || p.email}`}
                            onClick={() => onDisable(p)}>✕</button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-ghost"
                          aria-label={`Отключить ${p.name || p.email}`}
                          onClick={() => onDisable(p)}>✕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2 className={styles.queueGroupTitle}>Без логина (цеховые)</h2>
      <p className={styles.subText} style={{ marginTop: -6, marginBottom: 10 }}>
        Работники, которые пока не заходят в систему сами. Появится логин — привяжутся к общему списку.
      </p>

      {looseEmployees.length > 0 && (
        <div className={styles.tableWrap} style={{ marginBottom: 12 }}>
          <table className={styles.table}>
            <thead>
              <tr><th>Имя</th><th>Цех</th><th>Цеховая роль</th><th>Заметка</th><th aria-label="Действия" /></tr>
            </thead>
            <tbody>
              {looseEmployees.map((emp) => {
                return (
                  <tr key={emp.id} style={emp.active ? undefined : { opacity: 0.55 }}>
                    <td><strong>{emp.full_name}</strong></td>
                    <td>
                      <select
                        className={styles.select}
                        style={{ minHeight: 32, padding: '3px 6px' }}
                        value={emp.department_id || ''}
                        aria-label={`Цех ${emp.full_name}`}
                        onChange={(e) => updateEmployee(emp.id, { department_id: e.target.value || null })}
                      >
                        <option value="">—</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>{deptShortName(d.code, d.name)}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className={styles.select}
                        style={{ minHeight: 32, padding: '3px 6px' }}
                        value={emp.role}
                        aria-label={`Цеховая роль ${emp.full_name}`}
                        onChange={(e) => updateEmployee(emp.id, { role: e.target.value })}
                      >
                        {Object.entries(EMPLOYEE_ROLE_LABELS).map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <InlineEdit
                        value={emp.notes}
                        placeholder="добавить…"
                        ariaLabel={`Заметка ${emp.full_name}`}
                        onSave={(v) => updateEmployee(emp.id, { notes: v })}
                      />
                    </td>
                    <td>
                      {emp.active ? (
                        <button type="button" className="btn btn-ghost"
                          aria-label={`Отключить ${emp.full_name}`}
                          onClick={() => updateEmployee(emp.id, { active: false })}>✕</button>
                      ) : (
                        <button type="button" className="btn btn-ghost"
                          onClick={() => updateEmployee(emp.id, { active: true })}>↩</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <form
        className={styles.addMatRow}
        onSubmit={async (e) => {
          e.preventDefault();
          const name = newName.trim();
          if (!name) { toast.error('Укажите имя'); return; }
          const row = await createEmployee({ full_name: name, role: 'worker' });
          if (row) setNewName('');
        }}
      >
        <input
          className={styles.input}
          placeholder="Имя нового работника без логина"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          aria-label="Имя нового работника"
          style={{ minWidth: 240 }}
        />
        <button type="submit" className="btn btn-secondary">+ Добавить без логина</button>
      </form>
    </>
  );
}
