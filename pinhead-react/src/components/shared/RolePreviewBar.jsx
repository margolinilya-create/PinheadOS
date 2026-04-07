import { useAuthStore } from '../../store/useAuthStore';
import { useShallow } from 'zustand/react/shallow';
import styles from './RolePreviewBar.module.css';

const ROLES = [
  { key: 'admin',      label: 'Admin' },
  { key: 'director',   label: 'Director' },
  { key: 'rop',        label: 'ROP' },
  { key: 'manager',    label: 'Manager' },
  { key: 'production', label: 'Production' },
  { key: 'designer',   label: 'Designer' },
];

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
            {r.label}
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
