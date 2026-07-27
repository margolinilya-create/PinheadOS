import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../store/useErpStore';
import { PageHead } from '../components/PageHead';
import InlineEdit from '../components/InlineEdit';
import { toast } from '../../store/useToastStore';
import { EMPLOYEE_ROLE_LABELS } from '../types';
import styles from '../erp.module.css';

/**
 * Справочник производственных участков (правки 11 и 12): создание, переименование,
 * порядок в потоке, отключение, закрепление руководителя за цехом и нормативный
 * срок этапа в днях (подставляется планом завершения при «Взять в работу»).
 *
 * Участки не удаляются — на них ссылаются этапы заказов; отключение убирает их
 * из очередей и канбана, история остаётся целой.
 */

/** Латинский код участка из названия — стабильный ключ для маршрутов и ссылок */
function codeFromName(name) {
  const map = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i',
    й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
    э: 'e', ю: 'yu', я: 'ya',
  };
  const slug = name.trim().toLowerCase().split('')
    .map((ch) => map[ch] ?? ch)
    .join('')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);
  return slug || `dept_${Date.now().toString(36)}`;
}

export default function DepartmentsScreen({ embedded = false }) {
  const {
    departments, loaded, loadAll,
    employees, employeesLoaded, loadEmployees,
    createDepartment, updateDepartment,
  } = useErpStore(
    useShallow((s) => ({
      departments: s.departments,
      loaded: s.loaded,
      loadAll: s.loadAll,
      employees: s.employees,
      employeesLoaded: s.employeesLoaded,
      loadEmployees: s.loadEmployees,
      createDepartment: s.createDepartment,
      updateDepartment: s.updateDepartment,
    })),
  );
  const [draft, setDraft] = useState('');
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    if (!loaded) loadAll();
  }, [loaded, loadAll]);

  // Список руководителей берём из сотрудников — вкладка «Цеха» может открыться первой
  useEffect(() => {
    if (!employeesLoaded) loadEmployees();
  }, [employeesLoaded, loadEmployees]);

  const visible = useMemo(
    () => departments
      .filter((d) => showHidden || d.active)
      .sort((a, b) => a.sort_order - b.sort_order),
    [departments, showHidden],
  );

  /** Кандидаты в руководители: активные сотрудники этого цеха + руководящие роли */
  const headCandidates = useMemo(() => {
    const active = employees.filter((e) => e.active);
    return (deptId) => active.filter(
      (e) => e.department_id === deptId
        || ['foreman', 'dispatcher', 'manager', 'director'].includes(e.role),
    );
  }, [employees]);

  const add = async () => {
    const name = draft.trim();
    if (!name) return;
    const code = codeFromName(name);
    if (departments.some((d) => d.code === code)) {
      toast.warning('Участок с таким кодом уже есть');
      return;
    }
    const created = await createDepartment({
      code,
      name,
      sort_order: departments.reduce((max, d) => Math.max(max, d.sort_order), 0) + 10,
      // Новый участок заводят ради работы в цехах — сразу производственный;
      // снять галочку можно тут же, если это склад или служба
      is_production: true,
    });
    if (created) setDraft('');
  };

  return (
    <>
      {!embedded && (
        <PageHead
          title="Цеха и участки"
          sub={`${departments.length} подразделений — общий справочник производства.`}
        />
      )}

      <div className={styles.queueReason} style={{ marginBottom: 12 }}>
        Порядок задаёт последовательность участков в меню и на канбане. Норматив — плановый
        срок этапа в днях: подставляется при «Взять в работу», если задан. Участки не удаляются:
        на них ссылаются этапы заказов, отключение убирает их из очередей.
      </div>

      <div className={styles.toolbar}>
        <input
          className={styles.input}
          value={draft}
          placeholder="Новый участок, напр. «Цех термопереноса»"
          aria-label="Название нового участка"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
        />
        <button type="button" className="btn btn-primary" disabled={!draft.trim()} onClick={add}>
          + Добавить участок
        </button>
        <div className={styles.spacer} />
        <label className={styles.checkLabel}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          Показывать отключённые
        </label>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Участок</th><th>Код</th><th>Порядок</th><th>Признаки</th>
              <th>Руководитель</th><th>Норматив, дн</th><th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((d) => (
              <tr key={d.id} style={d.active ? undefined : { opacity: 0.5 }}>
                <td>
                  <InlineEdit
                    value={d.name}
                    ariaLabel={`Название участка ${d.name}`}
                    onSave={(v) => updateDepartment(d.id, { name: (v || '').trim() || d.name })}
                  />
                  {!d.active && <span className={styles.subText}> · отключён</span>}
                </td>
                <td className={styles.subText}>{d.code}</td>
                <td>
                  <input
                    type="number"
                    step="10"
                    className={`${styles.input} ${styles.inputSm}`}
                    defaultValue={d.sort_order}
                    aria-label={`Порядок участка ${d.name}`}
                    style={{ maxWidth: 80 }}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v !== d.sort_order) updateDepartment(d.id, { sort_order: v });
                    }}
                  />
                </td>
                <td>
                  {/* Производственный участок: своя очередь, колонка в канбане, требует ТЗ.
                      Раньше набор был захардкожен, и новый цех не появлялся нигде. */}
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={Boolean(d.is_production)}
                      aria-label={`Участок ${d.name} — производственный (своя очередь и канбан)`}
                      onChange={(e) => updateDepartment(d.id, { is_production: e.target.checked })}
                    />
                    производственный
                  </label>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={Boolean(d.is_branding)}
                      aria-label={`Участок ${d.name} — этап брендирования`}
                      onChange={(e) => updateDepartment(d.id, { is_branding: e.target.checked })}
                    />
                    нанесение
                  </label>
                </td>
                <td>
                  <select
                    className={styles.select}
                    value={d.head_employee_id || ''}
                    aria-label={`Руководитель участка ${d.name}`}
                    onChange={(e) => updateDepartment(d.id, { head_employee_id: e.target.value || null })}
                  >
                    <option value="">Не назначен</option>
                    {headCandidates(d.id).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name} · {EMPLOYEE_ROLE_LABELS[e.role] || e.role}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    className={`${styles.input} ${styles.inputSm}`}
                    defaultValue={d.norm_days ?? ''}
                    placeholder="—"
                    aria-label={`Норматив участка ${d.name}, дней`}
                    style={{ maxWidth: 70 }}
                    onBlur={(e) => {
                      const v = e.target.value === '' ? null : Number(e.target.value);
                      if (v !== (d.norm_days ?? null)) updateDepartment(d.id, { norm_days: v });
                    }}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => updateDepartment(d.id, { active: !d.active })}
                  >
                    {d.active ? '✕ Отключить' : 'Вернуть'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
