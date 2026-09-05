import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Skeleton } from '../../components/shared/Skeleton';
import styles from '../erp.module.css';
import { useErpAccess } from '../store/useErpAccess';
import { useFocusTrap } from '../../hooks/useFocusTrap';
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
      // Считается `readyOnlyCountFor` — ТОЛЬКО готовые к запуску
      /*
        «Мой цех» — ТОЛЬКО тем, у кого есть привязка к участку (обход 04.09).
        Пункт показывался всем, включая менеджера и диспетчера, и вёл
        в заглушку «Выберите свой цех выше»: постоянный пункт меню, ведущий
        в тупик, читается как поломка, а не как «это не для вас».
      */
      { to: '/queue', label: 'Мой цех', icon: 'queue', end: true, countLabel: 'Готово к запуску', needsDept: true },
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

/**
 * Пункт навигации со счётчиком заданий.
 *
 * `countLabel` — что ИМЕННО посчитано, и он обязателен потому, что в одном
 * сайдбаре живут ДВА разных счёта одного и того же цеха (правка 03.09):
 * «Мой цех» показывает `readyOnlyCountFor` (только готовые к запуску),
 * а пункт цеха в группе «Цеха» — `readyCountFor` (готовые ПЛЮС взятые
 * в работу). Оба подписывались одинаково — «Активных задач: N», — и человек
 * видел у своего участка два разных числа с одной и той же подписью,
 * не имея ни одного способа понять, какое из них про что.
 */
function NavItem({ item, count, collapsed, countLabel = 'Активных задач' }) {
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
        <span className={styles.navBadge} aria-label={`${countLabel}: ${count}`}>
          {count}
        </span>
      )}
    </NavLink>
  );
}

export function Sidebar({
  isAdmin, counts = {}, deptItems = [], collapsed, onToggleCollapse,
  open = false, onNavigate, reserveRows = 0, hasMyDept = false,
}) {
  // Тот же источник, что у маршрутов: пункт, ведущий в отказ, — хуже отсутствия
  const { can } = useErpAccess();
  /**
   * ВЫЕЗЖАЮЩЕЕ МЕНЮ — ЛОВУШКА ФОКУСА И ESCAPE (правка 03.09).
   *
   * Ниже 760px сайдбар это оверлей поверх экрана. Фокус в него не переносился,
   * Escape не закрывал, а весь фон оставался в порядке табуляции: открытое
   * меню для клавиатуры просто не существовало, зато сквозь него можно было
   * протабать на закрытый им экран (WCAG 2.4.3). Ловушка ставится ТОЛЬКО
   * когда меню открыто как оверлей: в обычной раскладке сайдбар — часть
   * страницы, и запирать в нём фокус было бы дефектом, а не починкой.
   */
  const trapRef = useFocusTrap(open, onNavigate);
  return (
    <aside
      ref={trapRef}
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
            (n) => (!n.admin || isAdmin)
              && canOpenScreen(can, n.to)
              && (!n.needsDept || hasMyDept),
          );
          if (items.length === 0) return null;
          return (
            <div key={g.title}>
              <div className={styles.navGroup}>{g.title}</div>
              {items.map((n) => (
                <NavItem
                  key={n.to}
                  item={n}
                  count={counts[n.to] || 0}
                  collapsed={collapsed}
                  countLabel={n.countLabel}
                />
              ))}
              {/* Цеха — сразу под «Главным»: постоянный список участков с числом заданий.
                  Пока состав участков не приехал, место под группу РЕЗЕРВИРУЕТСЯ: раньше
                  она отсутствовала и вставлялась целиком, сдвигая «Операции» и «Настройки»
                  на ≈315px вниз — пункт уходил из-под пальца уже после появления экрана. */}
              {g.title === 'Главное' && (deptItems.length > 0 || reserveRows > 0) && (
                <>
                  <div className={styles.navGroup}>Цеха</div>
                  {deptItems.length > 0
                    ? deptItems.map((d) => (
                      <NavItem
                        key={d.to}
                        item={{ to: d.to, label: d.label, icon: d.icon }}
                        count={d.count}
                        collapsed={collapsed}
                        /* `readyCountFor` — готовые к запуску И уже взятые в работу */
                        countLabel="Заданий в очереди"
                      />
                    ))
                    /* Заглушки — <div aria-hidden>, а не ссылки: спеки доступности считают
                       ссылки в nav, и фантомная ссылка была бы враньём для скринридера.
                       Класс тот же, что у строки (composes), поэтому переопределение
                       высоты под (pointer: coarse) применяется к заглушке само —
                       захардкоженные 38px промахнулись бы ровно на планшете. */
                    : Array.from({ length: reserveRows }).map((_, i) => (
                      <div key={i} className={styles.navLinkGhost} aria-hidden="true">
                        <span className={styles.navIcon}>
                          <Skeleton width={19} height={19} radius={4} />
                        </span>
                        <Skeleton width="55%" height={11} />
                      </div>
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
