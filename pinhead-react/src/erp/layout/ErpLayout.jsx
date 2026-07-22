import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../store/useAuthStore';
import { useTheme } from '../../hooks/useTheme';
import {
  useErpStore,
  readyCountFor,
  overdueUnackCountFor,
  openWarehouseTaskCount,
  openProcurementCount,
  openSubcontractCount,
  activeExperimentalCount,
} from '../store/useErpStore';
import { setFeature } from '../../config/features';
import { Sidebar } from './Sidebar';
import styles from '../erp.module.css';

export default function ErpLayout({ user, children }) {
  const isAdmin = ['admin', 'director'].includes(user?.role);
  const { theme, toggleTheme } = useTheme();
  const { orders, departments, myDeptId, myDeptLoaded, subcontracting, experimental } = useErpStore(
    useShallow((s) => ({
      orders: s.orders,
      departments: s.departments,
      myDeptId: s.myDeptId,
      myDeptLoaded: s.myDeptLoaded,
      subcontracting: s.subcontracting,
      experimental: s.experimental,
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

  // Живой ERP: изменения этапов/заказов долетают без обновления страницы
  useEffect(() => {
    const unsubscribe = useErpStore.getState().subscribeRealtime();
    return unsubscribe;
  }, []);

  // Цех пользователя для бейджей «Мой цех» / уведомлений
  useEffect(() => {
    if (!myDeptLoaded) useErpStore.getState().loadMyDept(user?.id);
  }, [myDeptLoaded, user?.id]);

  const myCode = useMemo(() => {
    const bound = departments.find((d) => d.id === myDeptId);
    return bound?.code || localStorage.getItem('erp_my_dept') || '';
  }, [departments, myDeptId]);

  // Счётчики активных задач по разделам (из уже загруженных данных стора)
  const counts = useMemo(
    () => ({
      '/queue': myCode ? readyCountFor(orders, departments, myCode) : 0,
      '/warehouse': openWarehouseTaskCount(orders),
      '/purchasing': openProcurementCount(orders),
      '/subcontracting': openSubcontractCount(subcontracting ?? []),
      '/experimental': activeExperimentalCount(experimental ?? []),
    }),
    [orders, departments, myCode, subcontracting, experimental],
  );

  const overdueCount = useMemo(
    () => (myCode ? overdueUnackCountFor(orders, departments, myCode) : 0),
    [orders, departments, myCode],
  );

  return (
    <div className={styles.shell}>
      <Sidebar
        isAdmin={isAdmin}
        counts={counts}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />

      <div className={styles.rightcol}>
        <header className={styles.topbar}>
          <div className={styles.headerSearch}>
            <span aria-hidden="true">🔍</span>
            <input type="search" placeholder="Поиск: заказы, изделия, задачи…" aria-label="Глобальный поиск" />
          </div>
          <div className={styles.spacer} />

          <button type="button" className={styles.iconBtn} title="Уведомления" aria-label="Уведомления">
            🔔
            {overdueCount > 0 && <span className={styles.iconDot}>{overdueCount}</span>}
          </button>

          <button
            type="button"
            className={`${styles.iconBtn} ${styles.themeToggle}`}
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
            title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
          >
            {theme === 'light' ? '🌙' : '☀️'}
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
              ✏️
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
            ⏻
          </button>
        </header>

        <main className={styles.main} id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
}
