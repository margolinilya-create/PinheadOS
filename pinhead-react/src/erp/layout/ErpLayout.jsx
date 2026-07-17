import { useEffect, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/useAuthStore';
import { useErpStore, readyCountFor } from '../store/useErpStore';
import { setFeature } from '../../config/features';
import styles from '../erp.module.css';

const NAV = [
  { to: '/', label: 'Обзор', icon: '📊', end: true },
  { to: '/orders', label: 'Заказы', icon: '📋' },
  { to: '/board', label: 'Производство', icon: '🏭' },
  { to: '/queue', label: 'Мой цех', icon: '🔧' },
  { to: '/purchasing', label: 'Закупка', icon: '🚚', admin: true },
  { to: '/admin', label: 'Админка', icon: '⚙️', admin: true },
];

export default function ErpLayout({ user, children }) {
  const isAdmin = ['admin', 'director'].includes(user?.role);
  const { orders, departments, myDeptId, myDeptLoaded } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      myDeptId: s.myDeptId,
      myDeptLoaded: s.myDeptLoaded,
    })),
  );

  // Живой ERP: изменения этапов/заказов долетают без обновления страницы
  useEffect(() => {
    const unsubscribe = useErpStore.getState().subscribeRealtime();
    return unsubscribe;
  }, []);

  // Цех пользователя для бейджа «Мой цех»
  useEffect(() => {
    if (!myDeptLoaded) useErpStore.getState().loadMyDept(user?.id);
  }, [myDeptLoaded, user?.id]);

  /** Число этапов «готово/в работе» в цехе пользователя — бейдж на «Мой цех» */
  const queueBadge = useMemo(() => {
    const bound = departments.find((d) => d.id === myDeptId);
    const code = bound?.code || localStorage.getItem('erp_my_dept') || '';
    if (!code) return 0;
    return readyCountFor(orders, departments, code);
  }, [orders, departments, myDeptId]);

  const items = NAV.filter((n) => !n.admin || isAdmin);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.brand}>PINHEAD</span>
        <span className={styles.brandSub}>ERP · Производство</span>
        <div className={styles.spacer} />
        {isAdmin && (
          <button
            className="btn"
            title="Перейти в Order Studio (создание ТЗ)"
            onClick={() => {
              setFeature('orderStudio', true);
              window.location.href = '/';
            }}
          >
            ✏️ ТЗ
          </button>
        )}
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
            {n.to === '/queue' && queueBadge > 0 && (
              <span
                className={styles.navBadge}
                aria-label={`Работ, готовых в вашем цехе: ${queueBadge}`}
              >
                {queueBadge}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <main className={styles.main} id="main-content">
        {children}
      </main>
    </div>
  );
}
