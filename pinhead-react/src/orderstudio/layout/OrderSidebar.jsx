import { Link, NavLink } from 'react-router-dom';
import { Icon } from '../../erp/components/Icon';
import styles from './OrderLayout.module.css';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { NEW_ORDER, navFor } from './orderNav';
import { useNewOrder } from '../screens/useNewOrder';

/**
 * Сайдбар раздела «ТЗ». Разметка — по образцу `erp/layout/Sidebar.jsx`
 * (импортировать его нельзя: он тянет стор ERP), без цехов, счётчиков
 * и сворачивания. Классы — снимок ERP в `OrderLayout.module.css`, поэтому вид и поведение
 * на узком экране те же: выезжающий оверлей, любой переход его закрывает (onClick на ссылках, а не на <aside>:
 * так линт не ругается на клик по неинтерактивному элементу).
 */
export function OrderSidebar({ user, open = false, onNavigate }) {
  // Ловушка фокуса только пока меню открыто как оверлей
  const trapRef = useFocusTrap(open, onNavigate);
  const { start: startNewOrder, busy } = useNewOrder();
  return (
    <aside
      ref={trapRef}
      className={[styles.sidebar, open ? styles.sidebarOpen : ''].filter(Boolean).join(' ')}
    >
      <Link to="/" onClick={onNavigate} className={styles.sidebarBrand} title="На главную раздела заказов" aria-label="На главную раздела заказов">
        <span className={styles.sidebarLogo}>P</span>
        <span className={styles.sidebarBrandText}>PINHEAD ORDER</span>
      </Link>

      <nav className={styles.sidebarNav} aria-label="Разделы заказа">
        {navFor(user).map((g) => (
          <div key={g.title}>
            <div className={styles.navGroup}>{g.title}</div>
            {g.items.map((n) => (n.action === NEW_ORDER ? (
              /* «Новый заказ» — действие: свой пустой черновик либо новый заказ */
              <button
                key={n.action}
                type="button"
                className={`${styles.navLink} ${styles.navButton}`}
                disabled={busy}
                onClick={() => { onNavigate?.(); startNewOrder(); }}
              >
                <span className={styles.navIcon}><Icon name={n.icon} size={19} /></span>
                <span className={styles.navLabel}>{n.label}</span>
              </button>
            ) : (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                onClick={onNavigate}
                className={({ isActive }) =>
                  isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
                }
              >
                <span className={styles.navIcon}><Icon name={n.icon} size={19} /></span>
                <span className={styles.navLabel}>{n.label}</span>
              </NavLink>
            )))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
