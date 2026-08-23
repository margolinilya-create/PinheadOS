import { memo } from 'react';
import InlineEdit from '../../components/InlineEdit';
import styles from '../../erp.module.css';
import { DeptSelect, EmployeeRoleSelect } from './EmployeeFields';

/**
 * Работник без логина карточкой вместо строки таблицы — компактная раскладка
 * (планшет и телефон).
 *
 * Зачем отдельная карточка рядом с `EmployeeCard`: у работника без логина нет
 * ни профиля, ни статуса, ни роли учётной записи — зато есть заметка, которой
 * нет у профиля. Общая карточка «на все случаи» приняла бы половину полей
 * пустыми и объясняла бы это условиями внутри разметки; поля при этом ОБЩИЕ
 * (`EmployeeFields`), а разной остаётся только рамка вокруг них.
 *
 * Подписи ставятся ЯВНО: без шапки таблицы «Цех» и «Цеховая роль» — два
 * соседних селекта, неразличимых на вид.
 */
function LooseEmployeeCardBase({ emp, departments, onUpdate, actions }) {
  return (
    <article
      className={`${styles.dataCard} ${emp.active ? '' : styles.rowDisabled}`}
      aria-label={`Работник ${emp.full_name}`}
    >
      <div className={styles.dataCardHead}>
        <strong>{emp.full_name}</strong>
        {!emp.active && <span className={`${styles.chip} ${styles.chipBlocked}`}>Отключён</span>}
      </div>

      <div className={styles.dataCardFields}>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Цех</span>
          <DeptSelect
            value={emp.department_id}
            label={emp.full_name}
            departments={departments}
            onChange={(id) => onUpdate(emp.id, { department_id: id })}
          />
        </span>
        <span className={styles.dataCardField}>
          <span className={styles.dataCardFieldLabel}>Цеховая роль</span>
          <EmployeeRoleSelect
            value={emp.role}
            label={emp.full_name}
            onChange={(role) => onUpdate(emp.id, { role })}
          />
        </span>
      </div>

      <div className={styles.dataCardField}>
        <span className={styles.dataCardFieldLabel}>Заметка</span>
        <InlineEdit
          value={emp.notes}
          placeholder="добавить…"
          ariaLabel={`Заметка ${emp.full_name}`}
          onSave={(v) => onUpdate(emp.id, { notes: v })}
        />
      </div>

      <div className={styles.checkRow}>{actions}</div>
    </article>
  );
}

export const LooseEmployeeCard = memo(LooseEmployeeCardBase);
