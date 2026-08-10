import { lazy, useEffect, Suspense } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import ErrorBoundary from '../components/shared/ErrorBoundary';
import ErpLayout from './layout/ErpLayout';
import { ScreenSkeleton } from './components/ErpSkeletons';
import { LoadFailed } from './components/ErpStates';
import { Icon } from './components/Icon';
import { OrderDrawerHost } from './screens/orderCard/OrderDrawerHost';
import { FEATURES } from '../config/features';
import { useErpAccess } from './store/useErpAccess';
import { canOpenScreen } from './utils/screenAccess';
import styles from './erp.module.css';

/**
 * ВСЕ экраны — отдельные чанки, включая три первых.
 *
 * Обзор, заказы и очередь цеха оставались статикой ради «без мигания на первом
 * экране», и это стоило оболочке 125 кБ (37 кБ gzip): их код ехал каждому и
 * всегда — в том числе рабочему, который открывает только свой цех, и с
 * планшета по цеховому Wi-Fi. Скелетоны у экранов есть, а `prefetchScreens`
 * ниже подтягивает соседние сразу после первой отрисовки: к моменту, когда
 * человек нажмёт на пункт меню, чанк уже в кэше.
 */
const ErpDashboard = lazy(() => import('./screens/ErpDashboard'));
const OrdersScreen = lazy(() => import('./screens/OrdersScreen'));
const DepartmentQueue = lazy(() => import('./screens/DepartmentQueue'));
const OrderCard = lazy(() => import('./screens/OrderCard'));
const ProductionBoard = lazy(() => import('./screens/ProductionBoard')); // + ErpKanban в чанке
const AdminScreen = lazy(() => import('./screens/AdminScreen')); // + Employees/Departments
const ProductionTask = lazy(() => import('./screens/ProductionTask'));
const FabricPurchasing = lazy(() => import('./screens/FabricPurchasing'));
const Warehouse = lazy(() => import('./screens/Warehouse'));
const Subcontracting = lazy(() => import('./screens/Subcontracting'));
const Experimental = lazy(() => import('./screens/Experimental'));
const DeptLoad = lazy(() => import('./screens/DeptLoad'));
const PlanScreen = lazy(() => import('./screens/PlanScreen'));
// Витрина дизайн-системы — за флагом `styleguide`, отдельным чанком.
// Ленивый импорт обязателен: иначе список всех иконок и демо-разметка
// уехали бы в оболочку, которую грузят все и всегда.
const StyleGuide = lazy(() => import('./screens/StyleGuide'));

/**
 * Предзагрузка соседних экранов в простое.
 *
 * Ленивый экран экономит критический путь, но переносит ожидание на первый
 * переход — на цеховом планшете это заметно. Поэтому после первой отрисовки,
 * когда браузер свободен, тянем то, куда человек пойдёт почти наверняка:
 * обзор, заказы и свой цех. Это НЕ критический путь — оболочка к этому моменту
 * уже интерактивна, а промахи глушим: неудачная предзагрузка не должна
 * всплывать ошибкой, обычный переход просто подождёт чанк.
 */
const PREFETCH = [
  () => import('./screens/ErpDashboard'),
  () => import('./screens/OrdersScreen'),
  () => import('./screens/DepartmentQueue'),
];

function usePrefetchScreens() {
  useEffect(() => {
    const run = () => PREFETCH.forEach((load) => { load().catch(() => {}); });
    // requestIdleCallback есть не везде (Safari) — там просто небольшая пауза
    const idle = window.requestIdleCallback;
    if (typeof idle === 'function') {
      const id = idle(run, { timeout: 2000 });
      return () => window.cancelIdleCallback?.(id);
    }
    const t = setTimeout(run, 1200);
    return () => clearTimeout(t);
  }, []);
}

/**
 * Кей по orderId → свежий инстанс карточки на каждый заказ: при переходе A→B страница
 * ремонтируется, useOrderDetail стартует с чистого стейта (без мигания данных прошлого заказа).
 * Зеркалит OrderDrawerHost (key={orderId}).
 */
function OrderCardRoute() {
  const { orderId } = useParams();
  return <OrderCard key={orderId} />;
}

/** То же для задания: переход A→B ремонтирует страницу, без мигания прошлых данных */
function ProductionTaskRoute() {
  const { stageId } = useParams();
  return <ProductionTask key={stageId} />;
}

/** Инлайн-панель «нет доступа» — без redirect, чтобы избежать гонки с загрузкой роли */
function ErpGuard({ allowed, children }) {
  if (!allowed) {
    return (
      <div className={styles.noAccess}>
        <div className={styles.stubIcon} aria-hidden="true"><Icon name="ban" size={34} /></div>
        <div>Нет доступа к этому разделу</div>
      </div>
    );
  }
  return children;
}

export default function ErpApp({ user }) {
  const { pathname } = useLocation();
  // Админка остаётся за учётной записью: это настройка системы, а не работа
  const isAdmin = ['admin', 'director'].includes(user?.role);
  /**
   * Разделы «Операции» открываются ПРАВОМ, а не типом учётной записи.
   * Иначе выданное право недостижимо: кладовщик с `warehouse.manage`
   * не видел пункта «Склад» и не мог открыть адрес. Список — в screenAccess,
   * один и тот же для маршрута и для меню.
   */
  usePrefetchScreens();
  const { can } = useErpAccess();
  const canOpen = (path) => canOpenScreen(can, path);

  return (
    <ErpLayout user={user}>
      {/* key={pathname}: падение одного экрана не роняет всю оболочку, а уход
          в другой раздел пересоздаёт границу — экран восстанавливается сам. */}
      <ErrorBoundary
        key={pathname}
        fallback={(error, reset) => (
          <LoadFailed what={`экран (${error?.message || 'непредвиденная ошибка'})`} onRetry={reset} />
        )}
      >
        <Suspense fallback={<ScreenSkeleton />}>
          <Routes>
          <Route path="/" element={<ErpDashboard />} />
          <Route path="/orders" element={<OrdersScreen />} />
          <Route path="/orders/:orderId" element={<OrderCardRoute />} />
          <Route path="/load" element={<DeptLoad />} />
          {/* Недельный и ежедневный план производства (правка менеджера 2026-08-03) */}
          <Route path="/plan" element={<PlanScreen />} />
          <Route path="/board" element={<ProductionBoard />} />
          {/* /queue — «Мой цех» (автопривязка), /queue/:deptCode — очередь конкретного участка */}
          <Route path="/queue" element={<DepartmentQueue />} />
          <Route path="/queue/:deptCode" element={<DepartmentQueue />} />
          {/* Страница производственного задания (правка 5); key — свежий инстанс на задание */}
          <Route path="/task/:stageId" element={<ProductionTaskRoute />} />
          <Route path="/admin" element={<ErpGuard allowed={isAdmin}><AdminScreen /></ErpGuard>} />
          <Route path="/employees" element={<Navigate to="/admin?tab=users" replace />} />
          <Route path="/departments" element={<Navigate to="/admin?tab=depts" replace />} />
          <Route path="/purchasing" element={<ErpGuard allowed={canOpen('/purchasing')}><FabricPurchasing /></ErpGuard>} />
          <Route path="/warehouse" element={<ErpGuard allowed={canOpen('/warehouse')}><Warehouse /></ErpGuard>} />
          <Route path="/subcontracting" element={<ErpGuard allowed={canOpen('/subcontracting')}><Subcontracting /></ErpGuard>} />
          <Route path="/experimental" element={<ErpGuard allowed={canOpen('/experimental')}><Experimental /></ErpGuard>} />
          {/* Инструмент разработки, не раздел ERP: в меню нет, по умолчанию выключен */}
          {FEATURES.styleguide && <Route path="/styleguide" element={<StyleGuide />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
      <OrderDrawerHost />
    </ErpLayout>
  );
}
