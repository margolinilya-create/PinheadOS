import { Link, NavLink, useLocation } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { Skeleton } from '../../components/shared/Skeleton';
import styles from '../erp.module.css';
import { useErpAccess } from '../store/useErpAccess';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { canOpenScreen } from '../utils/screenAccess';
import { NAV_GROUPS } from './navGroups';

/**
 * Вертикальная сгруппированная навигация ERP (редизайн, по макету).
 * Пункты ведут только на существующие маршруты; счётчики активных задач — `counts` (route→N).
 * Сворачивается в узкую иконочную панель (`collapsed`).
 *
 * Группа «Цеха» (правка 1) — постоянное меню производственных участков со счётчиком
 * заданий у каждого; пункт открывает рабочую очередь цеха (/queue/:code).
 * Логотип (правка 13) — ссылка на главную ERP, кликабелен весь блок.
 */


/**
 * Пункт навигации со счётчиком заданий.
 *
 * `countLabel` — что ИМЕННО посчитано: число у пункта видно, а его смысл нет,
 * и скринридер читает только `aria-label`. Правило записано 03.09, когда
 * в меню стояли ДВА разных счёта одного цеха под одной подписью «Активных
 * задач»; второго счёта не стало вместе с пунктом «Мой цех» (07.09), но
 * называть посчитанное надо по-прежнему — молчащее число объяснить нечем.
 */
function NavItem({ item, count, collapsed, countLabel = 'Активных задач' }) {
  const { pathname } = useLocation();
  // Пункт-раздел подсвечивается и на своих вкладках (см. `match` в navGroups)
  const matched = item.match?.some((m) => pathname === m || pathname.startsWith(`${m}/`));
  /**
   * АКТИВНЫЙ ПУНКТ ОБЯЗАН БЫТЬ ВИДЕН.
   *
   * Список участков и операций длиннее рабочей высоты панели, а `.sidebarNav`
   * прокручивается. Открыв «Эксперим. цех» — последний пункт группы «Операции» —
   * человек видел меню без единой подсветки: активный пункт был ниже видимой
   * области, из-под подвала торчал только край заливки. То есть навигация
   * не отвечала на вопрос «где я», ровно тогда, когда это нужнее всего:
   * на дальнем разделе, куда заходят редко.
   *
   * До 06.09 дефект существовал, но не бросался в глаза: невидимой была бледная
   * подсветка `--accent-light`. Сплошная заливка сделала его очевидным — это
   * не новая поломка, а проявленная.
   *
   * ПРОКРУЧИВАЕТСЯ КОНТЕЙНЕР, А НЕ `scrollIntoView`. Первая редакция звала
   * `node.scrollIntoView({ block: 'nearest' })` — и сломала клавиатуру:
   * в Chromium прокрутка сдвигает ТОЧКУ СТАРТА последовательной навигации,
   * поэтому первый Tab переставал попадать на skip-link и уводил сразу
   * в середину меню. Причём даже когда прокручивать было нечего: `nearest`
   * не двигает панель, но точку старта переносит всё равно. Поймал
   * `erp-a11y.spec.ts` («skip-link — первая остановка Tab»), то есть сторож,
   * написанный ровно про это.
   *
   * Прямая правка `scrollTop` фокуса не касается вовсе и вдобавок честно
   * ничего не делает, когда пункт и так виден.
   */
  const keepVisible = (node) => {
    // Активность СПРАШИВАЕТСЯ У КЛАССА, который поставил сам NavLink, а не
    // считается вторым выражением из pathname: два правила «этот пункт
    // активен» разошлись бы, и подсветка ездила бы отдельно от прокрутки.
    if (!node?.classList.contains(styles.navLinkActive)) return;
    const nav = node.closest('nav');
    if (!nav) return;
    const area = nav.getBoundingClientRect();
    const link = node.getBoundingClientRect();
    if (link.top < area.top) nav.scrollTop -= area.top - link.top;
    else if (link.bottom > area.bottom) nav.scrollTop += link.bottom - area.bottom;
  };
  return (
    <NavLink
      to={item.to}
      end={item.end}
      ref={keepVisible}
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
  open = false, onNavigate, reserveRows = 0,
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
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter(
            (n) => (!n.admin || isAdmin) && canOpenScreen(can, n.to),
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
