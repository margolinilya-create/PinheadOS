import { Link, NavLink } from 'react-router-dom';
import styles from '../erp.module.css';

/**
 * Вертикальная сгруппированная навигация ERP (редизайн, по макету).
 * Пункты ведут только на существующие маршруты; счётчики активных задач — `counts` (route→N).
 * Сворачивается в узкую иконочную панель (`collapsed`).
 *
 * Группа «Цеха» (правка 1) — постоянное меню производственных участков со счётчиком
 * заданий у каждого; пункт открывает рабочую очередь цеха (/queue/:code).
 * Логотип (правка 13) — ссылка на главную ERP, кликабелен весь блок.
 */

const GROUPS = [
  {
    title: 'Главное',
    items: [
      { to: '/', label: 'Обзор', icon: '📊', end: true },
      { to: '/orders', label: 'Заказы', icon: '📋' },
      { to: '/board', label: 'Производство', icon: '🏭' },
      { to: '/queue', label: 'Мой цех', icon: '🔧', end: true },
    ],
  },
  {
    title: 'Операции',
    items: [
      { to: '/purchasing', label: 'Закупка', icon: '🚚', admin: true },
      { to: '/warehouse', label: 'Склад', icon: '📦', admin: true },
      { to: '/subcontracting', label: 'Подряд', icon: '🤝', admin: true },
      { to: '/experimental', label: 'Эксперим. цех', icon: '🧪', admin: true },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { to: '/admin', label: 'Админка', icon: '⚙️', admin: true },
    ],
  },
];

/** Пункт навигации со счётчиком заданий */
function NavItem({ item, count, collapsed }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={collapsed ? item.label : undefined}
      className={({ isActive }) =>
        isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
      }
    >
      <span className={styles.navIcon} aria-hidden="true">{item.icon}</span>
      <span className={styles.navLabel}>{item.label}</span>
      {count > 0 && (
        <span className={styles.navBadge} aria-label={`Активных задач: ${count}`}>
          {count}
        </span>
      )}
    </NavLink>
  );
}

export function Sidebar({ isAdmin, counts = {}, deptItems = [], collapsed, onToggleCollapse }) {
  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.sidebarCollapsed : ''}`}>
      <Link to="/" className={styles.sidebarBrand} title="На главную ERP" aria-label="На главную ERP">
        <span className={styles.sidebarLogo}>P</span>
        <span className={styles.sidebarBrandText}>PINHEAD ERP</span>
      </Link>

      <nav className={styles.sidebarNav}>
        {GROUPS.map((g) => {
          const items = g.items.filter((n) => !n.admin || isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={g.title}>
              <div className={styles.navGroup}>{g.title}</div>
              {items.map((n) => (
                <NavItem key={n.to} item={n} count={counts[n.to] || 0} collapsed={collapsed} />
              ))}
              {/* Цеха — сразу под «Главным»: постоянный список участков с числом заданий */}
              {g.title === 'Главное' && deptItems.length > 0 && (
                <>
                  <div className={styles.navGroup}>Цеха</div>
                  {deptItems.map((d) => (
                    <NavItem
                      key={d.to}
                      item={{ to: d.to, label: d.label, icon: d.icon }}
                      count={d.count}
                      collapsed={collapsed}
                    />
                  ))}
                </>
              )}
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
          <span className={styles.navIcon} aria-hidden="true">{collapsed ? '»' : '«'}</span>
          <span className={styles.collapseLabel}>Свернуть меню</span>
        </button>
      </div>
    </aside>
  );
}
