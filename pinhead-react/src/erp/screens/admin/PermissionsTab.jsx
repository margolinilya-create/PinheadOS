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

/** Порядок ролей — от руководства к исполнителям */
const ROLES = [
  'director', 'dispatcher', 'manager', 'foreman',
  'worker', 'purchaser', 'storekeeper', 'hr',
];

/**
 * Колонка руководства правится только чтением.
 *
 * Профили `admin` и `director` приводятся к цеховой роли `director`
 * (utils/permissions.resolveErpRole), и никакого обхода матрицы для них нет.
 * То есть админ, снявший здесь галочку, отключал право самому себе — и вернуть
 * его через интерфейс уже не мог. Раньше подпись вкладки обещала обратное
 * («полный доступ независимо от галочек»), что и делало ловушку незаметной.
 */
const LOCKED_ROLE = 'director';

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
        Колонка «{EMPLOYEE_ROLE_LABELS[LOCKED_ROLE]}» <Icon name="ban" size={13} /> не редактируется: под неё попадают
        и администраторы, снятая галочка отключила бы доступ им самим.
      </div>

      <ScrollHintBox className={styles.tableWrap} label="Матрица прав по ролям">
        <table className={`${styles.table} ${styles.matrixTable}`}>
          <thead>
            <tr>
              <th>Право</th>
              {ROLES.map((r) => (
                <th key={r}>
                  {EMPLOYEE_ROLE_LABELS[r]}
                  {r === LOCKED_ROLE && (
                    <span title="Колонка руководства — не редактируется"> <Icon name="ban" size={12} /></span>
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
                  const locked = role === LOCKED_ROLE;
                  const label = `${ERP_PERMISSION_LABELS[permission]} — ${EMPLOYEE_ROLE_LABELS[role]}`;
                  return (
                    <td key={role}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={locked}
                        aria-label={locked ? `${label} (не редактируется)` : label}
                        title={locked ? 'Колонка руководства — не редактируется' : label}
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
