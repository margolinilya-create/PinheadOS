import { useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useErpStore } from '../../store/useErpStore';
import { isAllowed } from '../../utils/permissions';
import {
  EMPLOYEE_ROLE_LABELS,
  ERP_PERMISSIONS,
  ERP_PERMISSION_LABELS,
} from '../../types';
import styles from '../../erp.module.css';

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
        Администратор и директор имеют полный доступ независимо от галочек.
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Право</th>
              {ROLES.map((r) => <th key={r}>{EMPLOYEE_ROLE_LABELS[r]}</th>)}
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
                  const label = `${ERP_PERMISSION_LABELS[permission]} — ${EMPLOYEE_ROLE_LABELS[role]}`;
                  return (
                    <td key={role}>
                      <input
                        type="checkbox"
                        checked={checked}
                        aria-label={label}
                        title={label}
                        onChange={(e) => setRolePermission(role, permission, e.target.checked)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
