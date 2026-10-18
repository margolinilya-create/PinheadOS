import { Link, useLocation } from 'react-router-dom';
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
/**
 * Пункт-пресет (адрес с `?…`, «К запуску») активен, когда путь и все его
 * параметры совпали с адресом. NavLink сравнивает только путь — горели бы оба
 * пункта списка заказов сразу (и оба с `aria-current`), поэтому активность
 * считается здесь, а ссылка — обычный `Link`
 */
function presetMatches(to, loc) {
  const at = to.indexOf('?');
  if (at < 0 || loc.pathname !== to.slice(0, at)) return false;
  const here = new URLSearchParams(loc.search);
  return [...new URLSearchParams(to.slice(at))].every(([k, v]) => here.get(k) === v);
}

export function OrderSidebar({ user, open = false, onNavigate }) {
  // Ловушка фокуса только пока меню открыто как оверлей
  const trapRef = useFocusTrap(open, onNavigate);
  const { start: startNewOrder, busy } = useNewOrder();
  const loc = useLocation();
  const groups = navFor(user);
  const preset = groups.flatMap((g) => g.items).find((i) => i.to?.includes('?') && presetMatches(i.to, loc));
  // Как NavLink без `end`: путь пункта или вложенный; пресет перекрывает обычный пункт
  const activeOf = (n) => (n.to?.includes('?')
    ? n === preset
    : !preset && (loc.pathname === n.to || loc.pathname.startsWith(`${n.to}/`)));
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
        {groups.map((g) => (
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
              <Link
                key={n.to}
                to={n.to}
                onClick={onNavigate}
                aria-current={activeOf(n) ? 'page' : undefined}
                className={activeOf(n) ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink}
              >
                <span className={styles.navIcon}><Icon name={n.icon} size={19} /></span>
                <span className={styles.navLabel}>{n.label}</span>
              </Link>
            )))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
