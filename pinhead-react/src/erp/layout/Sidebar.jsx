import { NavLink } from 'react-router-dom';
import { Icon } from '../components/Icon';
import styles from '../erp.module.css';

/**
 * Вертикальная сгруппированная навигация ERP (редизайн, по макету).
 * Пункты ведут только на существующие маршруты; счётчики активных задач — `counts` (route→N).
 * Сворачивается в узкую иконочную панель (`collapsed`).
 */

const GROUPS = [
  {
    title: 'Главное',
    items: [
      { to: '/', label: 'Обзор', icon: 'overview', end: true },
      { to: '/orders', label: 'Заказы', icon: 'orders' },
      { to: '/board', label: 'Производство', icon: 'board' },
      { to: '/queue', label: 'Мой цех', icon: 'queue' },
      { to: '/load', label: 'Загрузка цехов', icon: 'calendar' },
    ],
  },
  {
    title: 'Операции',
    items: [
      { to: '/purchasing', label: 'Закупка', icon: 'truck', admin: true },
      { to: '/warehouse', label: 'Склад', icon: 'box', admin: true },
      { to: '/subcontracting', label: 'Подряд', icon: 'users', admin: true },
      { to: '/experimental', label: 'Эксперим. цех', icon: 'flask', admin: true },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { to: '/admin', label: 'Админка', icon: 'settings', admin: true },
    ],
  },
];

export function Sidebar({ isAdmin, counts = {}, collapsed, onToggleCollapse }) {
  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      <div className={styles.sidebarBrand}>
        <span className={styles.sidebarLogo}>P</span>
        <span className={styles.sidebarBrandText}>PINHEAD ERP</span>
      </div>

      <nav className={styles.sidebarNav}>
        {GROUPS.map((g) => {
          const items = g.items.filter((n) => !n.admin || isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={g.title}>
              <div className={styles.navGroup}>{g.title}</div>
              {items.map((n) => {
                const count = counts[n.to] || 0;
                return (
                  <NavLink
                    key={n.to}
                    to={n.to}
                    end={n.end}
                    title={collapsed ? n.label : undefined}
                    className={({ isActive }) =>
                      isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                    }
                  >
                    <span className={styles.navIcon}><Icon name={n.icon} size={19} /></span>
                    <span className={styles.navLabel}>{n.label}</span>
                    {count > 0 && (
                      <span className={styles.navBadge} aria-label={`Активных задач: ${count}`}>
                        {count}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
      </nav>

      <div className={styles.sidebarFooter}>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={onToggleCollapse}
          aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
        >
          <span className={styles.navIcon}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={19} />
          </span>
          <span className={styles.collapseLabel}>Свернуть меню</span>
        </button>
      </div>
    </aside>
  );
}
