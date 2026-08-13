import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/useAuthStore';
import { useErpSearch } from '../store/useErpSearch';
import { useTheme } from '../../hooks/useTheme';
import {
  useErpStore,
  readyCountFor,
  readyOnlyCountFor,
  overdueUnackCountFor,
  openWarehouseTaskCount,
  openProcurementCount,
  openSubcontractCount,
  activeExperimentalCount,
} from '../store/useErpStore';
import { switchAppMode } from '../../config/appMode';
import { deptIcon, deptShortName, isProductionDept } from '../data/departments';
import { Sidebar } from './Sidebar';
import { Icon } from '../components/Icon';
import styles from '../erp.module.css';
import appStyles from '../../App.module.css';

export default function ErpLayout({ user, children }) {
  const isAdmin = ['admin', 'director'].includes(user?.role);
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const search = useErpSearch((s) => s.query);
  const setSearch = useErpSearch((s) => s.setQuery);
  const { orders, departments, myDeptId, subcontracting, experimental, bypasses } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      myDeptId: s.myDeptId,
      subcontracting: s.subcontracting,
      experimental: s.experimental,
      bypasses: s.bypasses,
    })),
  );

  // Сворачивание сайдбара (persist); на узких экранах — по умолчанию свёрнут
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('erp_sidebar_collapsed');
    if (saved != null) return saved === '1';
    return typeof window !== 'undefined' && window.innerWidth < 900;
  });
  useEffect(() => {
    localStorage.setItem('erp_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  // Ниже 760px сайдбар — выезжающий оверлей (см. erp.module.css): постоянная
  // колонка там занимала от 13% до половины ширины и убиралась только сворачиванием
  const [navOpen, setNavOpen] = useState(false);

  // Живой ERP: изменения этапов/заказов долетают без обновления страницы
  useEffect(() => {
    const unsubscribe = useErpStore.getState().subscribeRealtime();
    return unsubscribe;
  }, []);

  /**
   * Данные оболочки — ОДИН RPC вместо шести запросов.
   *
   * Здесь стояли: loadMyDept, loadPermissions, loadDictionaries,
   * loadSubcontracting, loadExperimental и цеха внутри loadAll — шесть
   * round-trip ради 28 кБ справочных данных. Бейджи «Подряд»/«Эксперим. цех»
   * и счётчики цехов обязаны быть верны на ЛЮБОМ экране (ERP-08), поэтому
   * грузятся заранее, — но заранее не значит по одному.
   *
   * Заказы остаются отдельным запросом: у них свои фильтры (архив, демо)
   * и вложенные эмбеды, ради которых PostgREST и нужен.
   */
  useEffect(() => {
    const s = useErpStore.getState();
    s.loadBootstrap();
    if (!s.loaded) s.loadAll();
    /**
     * Аварийно снятые блокировки (правки 10.08) — отдельным запросом, а не в
     * `erp_bootstrap()`: пакет оболочки едет КАЖДОМУ при каждой загрузке, и
     * добавлять в него список, который обычно пуст, значит платить за него всегда.
     * Таблица крошечная, запрос идёт один раз за сессию, дальше её обновляет
     * realtime.
     */
    if (!s.bypassesLoaded) s.loadBypasses();
  }, []);

  const myCode = useMemo(() => {
    const bound = departments.find((d) => d.id === myDeptId);
    return bound?.code || localStorage.getItem('erp_my_dept') || '';
  }, [departments, myDeptId]);

  // Счётчики активных задач по разделам (из уже загруженных данных стора)
  const counts = useMemo(
    () => ({
      '/queue': myCode ? readyOnlyCountFor(orders, departments, myCode, bypasses) : 0,
      '/warehouse': openWarehouseTaskCount(orders),
      // Заказы, ждущие закупки, + дозакупки. Без справочника цехов первое
      // не посчитать: участок берётся из данных, а не из константы
      '/purchasing': openProcurementCount(orders, departments),
      '/subcontracting': openSubcontractCount(subcontracting ?? []),
      '/experimental': activeExperimentalCount(experimental ?? []),
    }),
    [orders, departments, myCode, subcontracting, experimental, bypasses],
  );

  /**
   * Колокол просрочек. У диспетчера, РОПа и директора привязки к конкретному цеху
   * обычно нет, и бейдж всегда показывал 0 — единственный глобальный индикатор
   * «что горит» был мёртв именно для тех, кому адресован. Без своего цеха считаем
   * по всем производственным участкам.
   */
  const overdueCount = useMemo(() => {
    if (myCode) return overdueUnackCountFor(orders, departments, myCode);
    return departments
      .filter((d) => d.active && isProductionDept(d))
      .reduce((sum, d) => sum + overdueUnackCountFor(orders, departments, d.code), 0);
  }, [orders, departments, myCode]);

  // Постоянное меню цехов (правка 1): участок + число заданий в его очереди
  // (готовые к запуску + уже взятые в работу).
  const deptItems = useMemo(
    () => departments
      .filter((d) => d.active && isProductionDept(d))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((d) => ({
        to: `/queue/${d.code}`,
        label: deptShortName(d.code, d.name),
        icon: deptIcon(d.code),
        count: readyCountFor(orders, departments, d.code, bypasses),
      })),
    [orders, departments, bypasses],
  );

  return (
    <div className={styles.shell}>
      {/* Сайдбар — до 20+ ссылок, и клавиатурный пользователь проходил их заново
          на каждой странице. Якорь #main-content был, ссылки на него — нет. */}
      <a href="#main-content" className={appStyles.skipLink}>Перейти к содержимому</a>
      <Sidebar
        isAdmin={isAdmin}
        counts={counts}
        deptItems={deptItems}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        open={navOpen}
        onNavigate={() => setNavOpen(false)}
      />
      {navOpen && (
        <button
          type="button"
          className={styles.sidebarScrim}
          aria-label="Закрыть меню"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className={styles.rightcol}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.navToggle}`}
            aria-label="Меню"
            aria-expanded={navOpen}
            title="Меню"
            onClick={() => setNavOpen((v) => !v)}
          >
            <Icon name="menu" size={19} />
          </button>
          <div className={styles.headerSearch}>
            <Icon name="search" />
            <input
              type="search"
              placeholder="Поиск: заказ, № сделки, менеджер…"
              aria-label="Глобальный поиск"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') navigate('/orders'); }}
            />
          </div>
          <div className={styles.spacer} />

          {/*
            Колокол — ССЫЛКА, а не кнопка (H-09 отчёта QA 13.08.2026).

            Панели уведомлений в ERP нет и не планировалось: список живёт
            виджетом на обзоре (там он группируется по тому, что делать).
            Но иконка колокола обещает «сейчас откроется панель», и переход
            на другой экран читался как промах, а не как замысел. Ссылка это
            обещание снимает: видно, куда ведёт, работают Ctrl+клик и «открыть
            в новой вкладке», а подпись говорит прямо.

            `<Link>`, а не `navigate()`: прежний обработчик к тому же ничего
            не делал при повторном нажатии — адрес не менялся, и эффект
            прокрутки на обзоре не срабатывал.
          */}
          <Link
            to="/#notifications"
            className={styles.iconBtn}
            title="Уведомления — список на обзоре производства"
            aria-label={overdueCount > 0
              ? `Уведомления: ${overdueCount} — открыть список на обзоре`
              : 'Уведомления — открыть список на обзоре'}
          >
            <Icon name="bell" size={19} />
            {overdueCount > 0 && <span className={styles.iconDot}>{overdueCount}</span>}
          </Link>

          <button
            type="button"
            className={`${styles.iconBtn} ${styles.themeToggle}`}
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
            title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} />
          </button>

          {isAdmin && (
            <button
              type="button"
              className={styles.iconBtn}
              title="Перейти в Order Studio (создание ТЗ)"
              aria-label="Order Studio"
              onClick={() => switchAppMode('studio')}
            >
              <Icon name="pencil" size={19} />
            </button>
          )}

          <div className={styles.userChip}>
            {user?.name || user?.email}
            <div className={styles.userRole}>{user?.role}</div>
          </div>

          <button
            type="button"
            className={styles.iconBtn}
            title="Выйти"
            aria-label="Выйти"
            onClick={() => useAuthStore.getState().logout()}
          >
            <Icon name="power" size={19} />
          </button>
        </header>

        <main className={styles.main} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
