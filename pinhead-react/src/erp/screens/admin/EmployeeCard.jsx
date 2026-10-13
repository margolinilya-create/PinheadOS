import { memo } from 'react';
import styles from '../../styles';
import { DeptSelect, EmployeeRoleSelect, RoleSelect } from './EmployeeFields';

/**
 * Сотрудник карточкой вместо строки таблицы — компактная раскладка
 * (планшет и телефон).
 *
 * Зачем: таблица здесь СЕМЬ колонок, четыре из них селекты, а колонка действий
 * («Подтвердить», «Отключить», карточка учётной записи) стоит последней —
 * ниже 1024px она уезжала за край. Руководитель заводит людей с того же
 * планшета, с которого смотрит производство.
 *
 * Подписи ставятся ЯВНО: без шапки таблицы два соседних селекта с ролями
 * («Роль» и «Цеховая роль») неразличимы, а это разные поля с разными
 * последствиями — доступ к разделам против прав на этапы.
 *
 * Действия приходят слотом: их набор зависит от состояния профиля
 * (не подтверждён / активен / отключён) и от прав смотрящего, и вторая
 * реализация этого ветвления разошлась бы с таблицей.
 */
function EmployeeCardBase({
  p, emp, me, status, roles, roleLabels, departments,
  onChangeRole, onUpsertDept, actions,
}) {
  return (
    <article
      className={`${styles.dataCard} ${p.active === false ? styles.rowDisabled : ''}`}
      aria-label={`Сотрудник ${p.name || p.email}`}
    >
      <div className={styles.dataCardHead}>
        <span>
          <strong>{p.name || '—'}</strong>
          {p.id === me?.id && <span className={styles.subText}> · вы</span>}
          <div className={styles.cellSub}>{p.email}</div>
        </span>
        <span className={`${styles.chip} ${styles[status.cls]}`}>{status.label}</span>
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Роль</span>
          <RoleSelect p={p} me={me} roles={roles} roleLabels={roleLabels} onChange={onChangeRole} />
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Цех</span>
          <DeptSelect
            value={emp?.department_id}
            label={p.name || p.email}
            departments={departments}
            onChange={(id) => onUpsertDept(p, { department_id: id })}
          />
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Цеховая роль</span>
          <EmployeeRoleSelect
            value={emp?.role}
            label={p.name || p.email}
            onChange={(role) => onUpsertDept(p, { role })}
          />
        </span>
      </div>

      <div className={styles.checkRow}>{actions}</div>
    </article>
  );
}

export const EmployeeCard = memo(EmployeeCardBase);
