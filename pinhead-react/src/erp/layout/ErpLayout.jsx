import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/useAuthStore';
import { confirm } from '../../store/useConfirmStore';
import { useErpSearch } from '../store/useErpSearch';
import { useTheme } from '../../hooks/useTheme';
import {
  useErpStore,
  readyCountFor,
  readyOnlyCountFor,
  overdueUnackCountFor,
  openWarehouseTaskCount,
  openProcurementCount,
  activeExperimentalCount,
} from '../store/useErpStore';
import { ordersWithOutsourcing } from '../utils/outsourcing';
import { setFeature } from '../../config/features';
import { storageGet, storageSet, storageGetRaw, storageSetRaw } from '../../lib/storage';
import { deptsSettled } from '../store/shared';
import { deptIcon, deptShortName, isProductionDept } from '../data/departments';
import { Sidebar } from './Sidebar';
import { Icon } from '../components/Icon';
import StaleDataBar from '../components/StaleDataBar';
import styles from '../erp.module.css';
import appStyles from '../../App.module.css';

export default function ErpLayout({ user, children }) {
  const isAdmin = ['admin', 'director'].includes(user?.role);
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const search = useErpSearch((s) => s.query);
  const setSearch = useErpSearch((s) => s.setQuery);
  const { orders, departments, myDeptId, experimental, bypasses, bootstrapLoaded } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      myDeptId: s.myDeptId,
      experimental: s.experimental,
      bypasses: s.bypasses,
      bootstrapLoaded: s.bootstrapLoaded,
    })),
  );

  // Сворачивание сайдбара (persist); на узких экранах — по умолчанию свёрнут
  const [collapsed, setCollapsed] = useState(() => {
    const saved = storageGetRaw('erp_sidebar_collapsed');
    if (saved != null) return saved === '1';
    return typeof window !== 'undefined' && window.innerWidth < 900;
  });
  useEffect(() => {
    storageSetRaw('erp_sidebar_collapsed', collapsed ? '1' : '0');
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
    return bound?.code || storageGetRaw('erp_my_dept') || '';
  }, [departments, myDeptId]);

  // Счётчики активных задач по разделам (из уже загруженных данных стора)
  const counts = useMemo(
    () => ({
      '/queue': myCode ? readyOnlyCountFor(orders, departments, myCode, bypasses) : 0,
      '/warehouse': openWarehouseTaskCount(orders),
      // Заказы, ждущие закупки, + дозакупки. Без справочника цехов первое
      // не посчитать: участок берётся из данных, а не из константы
      '/purchasing': openProcurementCount(orders, departments),
      /**
       * Считаем по ЗАКАЗАМ из ядра, а не по лениво загружаемому реестру подряда:
       * пока бейдж стоял на `subcontracting`, он показывал 0 до тех пор, пока
       * раздел не открыли, — то есть молчал ровно тогда, когда был нужен.
       */
      '/subcontracting': ordersWithOutsourcing(orders).length,
      '/experimental': activeExperimentalCount(experimental ?? []),
    }),
    [orders, departments, myCode, experimental, bypasses],
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

  /**
   * Резерв места под меню цехов, пока не приехал состав участков.
   *
   * До этого группа «Цеха» просто отсутствовала, а потом вставлялась целиком —
   * ≈315px разметки между «Мой цех» и «Операции», то есть пункт меню уходил
   * из-под пальца через доли секунды после появления экрана.
   *
   * Запоминается ОДНО ЧИСЛО — сколько строк рисовать, — и берётся оно из уже
   * отфильтрованного списка: непроизводственных участков в справочнике больше,
   * чем производственных, и `departments.length` зарезервировал бы вдвое лишнее.
   * Правило «список участков — из данных» не нарушено: ни одного кода участка
   * и ни одного решения о видимости отсюда не выводится, это высота места.
   *
   * Читается в рендере, а не в эффекте: эффект выполняется ПОСЛЕ первой
   * отрисовки, то есть после того самого кадра, ради которого всё делается.
   */
  const deptsReady = deptsSettled(departments, bootstrapLoaded);
  const reserveRows = useMemo(() => {
    if (deptsReady) return 0;
    const saved = Number(storageGet('erp_dept_rows'));
    if (!Number.isFinite(saved) || saved <= 0) return 0;
    // Битое значение не должно нарисовать сотню строк
    return Math.min(Math.round(saved), 12);
  }, [deptsReady]);

  useEffect(() => {
    if (!deptsReady || deptItems.length === 0) return;
    storageSet('erp_dept_rows', deptItems.length);
  }, [deptsReady, deptItems.length]);

  return (
    <div className={styles.shell}>
      {/* Сайдбар — до 20+ ссылок, и клавиатурный пользователь проходил их заново
          на каждой странице. Якорь #main-content был, ссылки на него — нет. */}
      <a href="#main-content" className={appStyles.skipLink}>Перейти к содержимому</a>
      <Sidebar
        isAdmin={isAdmin}
        reserveRows={reserveRows}
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
            Счётчик просрочек ВХОДИТ в доступное имя кнопки (правка 03.09).
            `aria-label="Уведомления"` перекрывал содержимое целиком, включая
            число внутри: единственный глобальный индикатор «что горит»
            не озвучивался вовсе. В сайдбаре та же задача решена верно —
            имя даёт сам бейдж внутри ссылки (`Sidebar.jsx`).
          */}
          <button
            type="button"
            className={styles.iconBtn}
            title="Уведомления"
            aria-label={overdueCount > 0
              ? `Уведомления: просрочено ${overdueCount}`
              : 'Уведомления'}
            onClick={() => navigate('/#notifications')}
          >
            <Icon name="bell" size={19} />
            {overdueCount > 0 && (
              <span className={styles.iconDot} aria-hidden="true">{overdueCount}</span>
            )}
          </button>

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
              onClick={() => {
                setFeature('orderStudio', true);
                window.location.href = '/';
              }}
            >
              <Icon name="pencil" size={19} />
            </button>
          )}

          <div className={styles.userChip}>
            {user?.name || user?.email}
            <div className={styles.userRole}>{user?.role}</div>
          </div>

          {/*
            ВЫХОД ПЕРЕСПРАШИВАЕТ (правка 03.09). Это иконка в ряду из пяти
            одинаковых по размеру, и на цеховом планшете промах пальцем стоил
            сессии посреди смены: следующий человек должен был знать логин
            и пароль, а набранное в открытых формах терялось. Действие
            дешёвое по коду и дорогое по последствиям — ровно тот случай,
            когда подтверждение уместно.
          */}
          <button
            type="button"
            className={styles.iconBtn}
            title="Выйти"
            aria-label="Выйти"
            onClick={async () => {
              const ok = await confirm({
                title: 'Выйти из системы?',
                message: 'Несохранённые правки в открытых формах будут потеряны.',
                confirmLabel: 'Выйти',
              });
              if (ok) useAuthStore.getState().logout();
            }}
          >
            <Icon name="power" size={19} />
          </button>
        </header>

        {/*
          `tabIndex={-1}` — чтобы skip-link ДЕЙСТВИТЕЛЬНО переносил фокус
          (правка 03.09). Chrome и Firefox двигают фокус по фрагменту сами,
          а WebKit исторически — нет, и на iPad, с которого идёт пилот,
          «Перейти к содержимому» прокручивал страницу, оставляя фокус
          на самой ссылке: следующий Tab возвращал в начало сайдбара.
          Спека проверяла только видимость цели, а не перенос фокуса.
        */}
        <main className={styles.main} id="main-content" tabIndex={-1}>
          {/* Разрыв канала виден на ЛЮБОМ экране: устареть может любой */}
          <StaleDataBar />
          {children}
        </main>
      </div>
    </div>
  );
}
