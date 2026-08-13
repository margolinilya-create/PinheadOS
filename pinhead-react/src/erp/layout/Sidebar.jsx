import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import styles from '../erp.module.css';
import { useErpAccess } from '../store/useErpAccess';
import { canOpenScreen } from '../utils/screenAccess';

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
      { to: '/', label: 'Обзор', icon: 'overview', end: true },
      { to: '/orders', label: 'Заказы', icon: 'orders' },
      /**
       * Один пункт вместо трёх (решение заказчика 03.08.2026). Раньше рядом
       * стояли «Производство» → /board, «План производства» → /plan и
       * «Загрузка цехов» → /load, причём заголовок /board гласил
       * «Производственный план» — то есть пункт меню и страница назывались
       * по-разному, а два соседних пункта отвечали на близкие вопросы.
       * Вкладки внутри раздела — ProductionTabs; адреса не менялись,
       * поэтому закладки и ссылки в переписке живы.
       *
       * `match` — маршруты, на которых пункт считается активным: без него
       * человек, стоящий на вкладке «План», видел бы меню без подсветки.
       */
      { to: '/board', label: 'Производство', icon: 'board', match: ['/plan', '/load'] },
      { to: '/queue', label: 'Мой цех', icon: 'queue', end: true },
    ],
  },
  {
    title: 'Операции',
    items: [
      // Видимость — по ПРАВУ (`utils/screenAccess`), общий список с маршрутами.
      // `admin: true` здесь стоял до 10.08 и делал выданные права недостижимыми:
      // кладовщик с `warehouse.manage` не видел «Склад» и не мог открыть адрес.
      { to: '/purchasing', label: 'Закупка', icon: 'truck' },
      { to: '/warehouse', label: 'Склад', icon: 'box' },
      { to: '/subcontracting', label: 'Подряд', icon: 'users' },
      { to: '/experimental', label: 'Эксперим. цех', icon: 'flask' },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { to: '/admin', label: 'Админка', icon: 'settings', admin: true },
    ],
  },
];

/** Пункт навигации со счётчиком заданий */
function NavItem({ item, count, collapsed }) {
  const { pathname } = useLocation();
  // Пункт-раздел подсвечивается и на своих вкладках (см. `match` в GROUPS)
  const matched = item.match?.some((m) => pathname === m || pathname.startsWith(`${m}/`));
  return (
    <NavLink
      to={item.to}
      end={item.end}
      // В свёрнутом виде подпись видна только в подсказке — счётчик тоже туда
      title={collapsed ? `${item.label}${count > 0 ? ` — ${count}` : ''}` : undefined}
      className={({ isActive }) =>
        (isActive || matched) ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink
      }
    >
      <span className={styles.navIcon}><Icon name={item.icon} size={19} /></span>
      <span className={styles.navLabel}>{item.label}</span>
      {count > 0 && (
        <span className={styles.navBadge} aria-label={`Активных задач: ${count}`}>
          {count}
        </span>
      )}
    </NavLink>
  );
}

/**
 * Сколько мест держать под цеха, пока их список не приехал.
 *
 * L-01 отчёта QA 13.08.2026: меню сначала рисовалось без секции «ЦЕХА»
 * и без счётчиков, потом они появлялись — весь низ меню прыгал вниз, и
 * попасть по пункту в первую секунду было нельзя. Цеха приезжают пакетом
 * оболочки, то есть задержка неизбежна; убрать надо не её, а скачок.
 * Шесть — размер боевого набора участков; ошибка на один-два ряда стоит
 * куда меньше прыжка на всю секцию.
 */
const DEPT_PLACEHOLDERS = 6;

export function Sidebar({
  isAdmin, counts = {}, deptItems = [], collapsed, onToggleCollapse,
  open = false, onNavigate,
}) {
  // Тот же источник, что у маршрутов: пункт, ведущий в отказ, — хуже отсутствия
  const { can } = useErpAccess();
  return (
    <aside
      className={[
        styles.sidebar,
        collapsed ? styles.sidebarCollapsed : '',
        open ? styles.sidebarOpen : '',
      ].filter(Boolean).join(' ')}
      // На узком экране сайдбар — выезжающий оверлей: любой переход его закрывает,
      // иначе панель остаётся поверх только что открытого экрана
      onClick={onNavigate}
    >
      <Link to="/" className={styles.sidebarBrand} title="На главную ERP" aria-label="На главную ERP">
        <span className={styles.sidebarLogo}>P</span>
        <span className={styles.sidebarBrandText}>PINHEAD ERP</span>
      </Link>

      <nav className={styles.sidebarNav}>
        {GROUPS.map((g) => {
          const items = g.items.filter(
            (n) => (!n.admin || isAdmin) && canOpenScreen(can, n.to),
          );
          if (items.length === 0) return null;
          return (
            <div key={g.title}>
              <div className={styles.navGroup}>{g.title}</div>
              {items.map((n) => (
                <NavItem key={n.to} item={n} count={counts[n.to] || 0} collapsed={collapsed} />
              ))}
              {/* Цеха — сразу под «Главным»: постоянный список участков с числом заданий */}
              {g.title === 'Главное' && (
                <>
                  <div className={styles.navGroup}>Цеха</div>
                  {deptItems.length > 0
                    ? deptItems.map((d) => (
                      <NavItem
                        key={d.to}
                        item={{ to: d.to, label: d.label, icon: d.icon }}
                        count={d.count}
                        collapsed={collapsed}
                      />
                    ))
                    : Array.from({ length: DEPT_PLACEHOLDERS }, (_, i) => (
                      <div
                        key={`dept-skeleton-${i}`}
                        className={`${styles.navLink} ${styles.navLinkSkeleton}`}
                        aria-hidden="true"
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
          <span className={styles.navIcon}>
            <Icon name={collapsed ? 'chevronRight' : 'chevronLeft'} size={19} />
          </span>
          <span className={styles.collapseLabel}>Свернуть меню</span>
        </button>
      </div>
    </aside>
  );
}
