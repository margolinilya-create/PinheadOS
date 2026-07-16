import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/useAuthStore';
import styles from '../erp.module.css';

const NAV = [
  { to: '/', label: 'Обзор', icon: '📊', end: true },
  { to: '/orders', label: 'Заказы', icon: '📋' },
  { to: '/board', label: 'Производство', icon: '🏭' },
  { to: '/employees', label: 'Сотрудники', icon: '👥', admin: true },
  { to: '/departments', label: 'Цеха', icon: '🧵', admin: true },
  { to: '/purchasing', label: 'Закупка ткани', icon: '🚚', admin: true },
];

export default function ErpLayout({ user, children }) {
  const isAdmin = ['admin', 'director'].includes(user?.role);
  const items = NAV.filter((n) => !n.admin || isAdmin);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>PINHEAD</span>
        <span className={styles.brandSub}>ERP · Производство</span>
        <div className={styles.spacer} />
        <div className={styles.userChip}>
          {user?.name || user?.email}
          <div className={styles.userRole}>{user?.role}</div>
        </div>
        <button className="btn btn-ghost" onClick={() => useAuthStore.getState().logout()}>
          Выйти
        </button>
      </header>

      <nav className={styles.sidebar}>
        {items.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
            }
          >
            <span className={styles.navIcon} aria-hidden="true">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>

      <main className={styles.main} id="main-content">
        {children}
      </main>
    </div>
  );
}
