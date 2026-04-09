import { useAuthStore } from '../../store/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './RolePreviewBar.module.css';
import { ROLE_LABELS, ALL_ROLES } from '../../data/roles';

const ROLES = ALL_ROLES.map(key => ({ key }));

export default function RolePreviewBar() {
  const { user, previewRole, setPreviewRole, clearPreviewRole } = useAuthStore(
    useShallow(s => ({ user: s.user, previewRole: s.previewRole, setPreviewRole: s.setPreviewRole, clearPreviewRole: s.clearPreviewRole }))
  );

  if (!['admin', 'director'].includes(user?.role)) return null;

  return (
    <div className={`${styles.bar}${previewRole ? ` ${styles.active}` : ''}`}>
      <span className={styles.label}>
        {previewRole ? '\u{1F441} Просмотр роли:' : 'Переключить роль:'}
      </span>
      <div className={styles.roles}>
        {ROLES.map(r => (
          <button
            key={r.key}
            className={`${styles.btn}${(previewRole || user.role) === r.key ? ` ${styles.current}` : ''}${previewRole === r.key ? ` ${styles.preview}` : ''}`}
            onClick={() => r.key === user.role ? clearPreviewRole() : setPreviewRole(r.key)}
          >
            {ROLE_LABELS[r.key]}
            {r.key === user.role && <span className={styles.own}>моя</span>}
          </button>
        ))}
      </div>
      {previewRole && (
        <button className={styles.exit} onClick={clearPreviewRole}>
          × Вернуться к своей роли
        </button>
      )}
    </div>
  );
}
