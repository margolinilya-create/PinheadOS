import { deptShortName } from '../../data/departments';
import { EMPLOYEE_ROLE_LABELS } from '../../types';
import styles from '../../styles';

/**
 * Поля сотрудника — ПО ОДНОЙ реализации на элемент.
 *
 * Зачем модуль. Сотрудника показывают ЧЕТЫРЕ поверхности: таблица профилей
 * (семь колонок) и таблица работников без логина (пять) на десктопе плюс две
 * карточки на планшете. Поля здесь не подписи, а инлайн-правки, и копия под
 * карточку разошлась бы молча: обе «работают», просто пишут по-разному.
 * Тот же приём, что у закупки (`purchasing/PurchaseFields`) и подряда
 * (`subcontracting/StageFields`).
 *
 * Компоненты принимают ЗНАЧЕНИЕ и обработчик, а не строку: у профиля цех
 * лежит в `erp_employees` и пишется через `upsertProfileDept`, у работника
 * без логина — в его же строке и пишется `updateEmployee`. Пути записи
 * разные, поля одинаковые.
 *
 * Роль в учётной записи и цеховая роль — РАЗНЫЕ поля: первая живёт
 * в `profiles.role` и решает доступ к разделам, вторая в `erp_employees.role`
 * и решает права на этапы. Переводя человека, менять надо оба.
 */

/** Роль учётной записи. Свою менять нельзя — иначе админ отключит сам себя */
export function RoleSelect({ p, me, roles, roleLabels, onChange }) {
  return (
    <select
      className={`${styles.select} ${styles.inputXs}`}
      value={p.role}
      aria-label={`Роль ${p.name || p.email}`}
      disabled={p.id === me?.id}
      title={p.id === me?.id ? 'Свою роль менять нельзя' : undefined}
      onChange={(e) => onChange(p, e.target.value)}
    >
      {roles.map((r) => (
        <option key={r} value={r}>{roleLabels[r] || r}</option>
      ))}
    </select>
  );
}

/**
 * Цех сотрудника. Отключённый цех остаётся в списке, ЕСЛИ человек к нему
 * привязан: иначе выбор молча слетел бы на «—» при первом же сохранении.
 */
export function DeptSelect({ value, label, departments, onChange }) {
  return (
    <select
      className={`${styles.select} ${styles.inputXs}`}
      value={value || ''}
      aria-label={`Цех ${label}`}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">—</option>
      {departments.filter((d) => d.active || d.id === value).map((d) => (
        <option key={d.id} value={d.id}>{deptShortName(d.code, d.name)}</option>
      ))}
    </select>
  );
}

/** Цеховая роль — она решает права на этапы, а не доступ к разделам */
export function EmployeeRoleSelect({ value, label, onChange }) {
  return (
    <select
      className={`${styles.select} ${styles.inputXs}`}
      value={value || 'worker'}
      aria-label={`Цеховая роль ${label}`}
      onChange={(e) => onChange(e.target.value)}
    >
      {Object.entries(EMPLOYEE_ROLE_LABELS).map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );
}
