import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { isAllowed } from '../../utils/permissions';
import { Icon } from '../../components/Icon';
import {
  EMPLOYEE_ROLE_LABELS,
  ERP_PERMISSIONS,
  ERP_PERMISSION_LABELS,
} from '../../types';
import styles from '../../erp.module.css';
import { ScrollHintBox } from '../../components/ScrollHintBox';

/**
 * Матрица прав «право × роль» (правка 11) — редактируется руководством,
 * сохраняется в erp_role_permissions и сразу действует у всех (realtime).
 *
 * Роли — единый словарь цеховых ролей; роль профиля Order Studio приводится
 * к нему на клиенте (utils/permissions.resolveErpRole), поэтому матрицу
 * не приходится вести дважды.
 */

/** Порядок ролей — от руководства к исполнителям, участки нанесения рядом */
const ROLES = [
  'director', 'production_head', 'dispatcher', 'manager', 'technologist', 'foreman',
  'worker', 'dtf', 'silkscreen', 'embroidery', 'purchaser', 'storekeeper', 'hr',
  // Новичок до назначения должности — последним: это не должность, а состояние
  'pending',
];

/**
 * Колонки, которые правятся только чтением, и причина у каждой своя.
 *
 * `director` — профили `admin` и `director` приводятся к этой цеховой роли
 * (utils/permissions.resolveErpRole), обхода матрицы для них нет. Админ,
 * снявший здесь галочку, отключал право самому себе и вернуть его через
 * интерфейс уже не мог.
 *
 * `pending` — под неё попадает КАЖДЫЙ, кто только что зарегистрировался и ещё
 * не получил должность. Смысл роли в том, что прав у неё нет; одна галочка
 * здесь раздала бы право всем неназначенным разом, и заметить это было бы
 * нечем. Права выдаются назначением должности, а не правкой этой колонки.
 */
const LOCKED_ROLES = {
  director: 'Колонка руководства — не редактируется',
  pending: 'Роль без прав по определению — назначьте человеку должность',
};

export function PermissionsTab() {
  const { permissionMatrix, permissionsLoaded, loadPermissions, setRolePermission } = useErpStore(
    useShallow((s) => ({
      permissionMatrix: s.permissionMatrix,
      permissionsLoaded: s.permissionsLoaded,
      loadPermissions: s.loadPermissions,
      setRolePermission: s.setRolePermission,
    })),
  );

  useEffect(() => {
    if (!permissionsLoaded) loadPermissions();
  }, [permissionsLoaded, loadPermissions]);

  return (
    <>
      <div className={styles.queueReason} style={{ marginBottom: 12 }}>
        Матрица отвечает на вопрос «что этой роли вообще можно». Ограничение «только свой цех»
        проверяется отдельно — по привязке сотрудника к участку, и матрицей не отменяется.
        Колонка «{EMPLOYEE_ROLE_LABELS.director}» <Icon name="ban" size={13} /> не редактируется: под неё попадают
        и администраторы, снятая галочка отключила бы доступ им самим.
        Колонка «{EMPLOYEE_ROLE_LABELS.pending}» — тоже: с неё начинается каждая
        регистрация, и права там появляться не должны. Человеку назначают должность
        на вкладке «Пользователи», и права он получает вместе с ней.
      </div>

      <ScrollHintBox className={styles.tableWrap} label="Матрица прав по ролям">
        <table className={`${styles.table} ${styles.matrixTable}`}>
          <thead>
            <tr>
              <th>Право</th>
              {ROLES.map((r) => (
                <th key={r}>
                  {EMPLOYEE_ROLE_LABELS[r]}
                  {LOCKED_ROLES[r] && (
                    <span title={LOCKED_ROLES[r]}> <Icon name="ban" size={12} /></span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ERP_PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <td>
                  <strong>{ERP_PERMISSION_LABELS[permission]}</strong>
                  <div className={styles.subText}>{permission}</div>
                </td>
                {ROLES.map((role) => {
                  const checked = isAllowed(permissionMatrix, role, permission);
                  const lockReason = LOCKED_ROLES[role];
                  const label = `${ERP_PERMISSION_LABELS[permission]} — ${EMPLOYEE_ROLE_LABELS[role]}`;
                  return (
                    <td key={role}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={Boolean(lockReason)}
                        aria-label={lockReason ? `${label} (не редактируется)` : label}
                        title={lockReason || label}
                        onChange={(e) => setRolePermission(role, permission, e.target.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollHintBox>
    </>
  );
}
