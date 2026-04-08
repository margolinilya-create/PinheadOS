import { useNavigate, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import styles from './NavBar.module.css';

const NAV_LINKS = [
  { path: '/',                    label: 'Цех' },
  { path: '/director',            label: 'Панель' },
  { path: '/capacity',            label: 'Мощности' },
  { path: '/analytics',           label: 'Аналитика' },
  { path: '/kanban',              label: 'Канбан' },
  { path: '/instructions/t1',     label: 'Инструкции' },
  { path: '/scan',                label: 'Сканер' },
  { path: '/batches',             label: 'Батчи' },
];

const DISPLAY_LINKS = [
  { path: '/andon', label: 'Andon' },
  { path: '/kiosk', label: 'Киоск' },
  { path: '/tv',    label: 'ТВ' },
];

export default function NavBar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <nav className={styles.bar}>
      <div className={styles.links}>
        {NAV_LINKS.map(({ path, label }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              className={`${styles.link}${isActive ? ' ' + styles.linkActive : ''}`}
              onClick={() => navigate(path)}
            >
              {label}
            </button>
          );
        })}

        <span className={styles.separator} />

        <span className={styles.groupLabel}>Дисплеи</span>

        {DISPLAY_LINKS.map(({ path, label }) => {
          const isActive = location.pathname === path;
          return (
            <button
              key={path}
              className={`${styles.link} ${styles.linkDisplay}${isActive ? ' ' + styles.linkActive : ''}`}
              onClick={() => navigate(path)}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className={styles.right}>
        <NotificationBell />
      </div>
    </nav>
  );
}
