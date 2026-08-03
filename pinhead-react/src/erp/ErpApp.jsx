import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams, useLocation } from 'react-router-dom';
import ErrorBoundary from '../components/shared/ErrorBoundary';
import ErpLayout from './layout/ErpLayout';
import ErpDashboard from './screens/ErpDashboard';
import OrdersScreen from './screens/OrdersScreen';
import DepartmentQueue from './screens/DepartmentQueue';
import { ScreenSkeleton } from './components/ErpSkeletons';
import { LoadFailed } from './components/ErpStates';
import { Icon } from './components/Icon';
import { OrderDrawerHost } from './screens/orderCard/OrderDrawerHost';
import { FEATURES } from '../config/features';
import styles from './erp.module.css';

// Тяжёлые экраны — отдельные чанки (п.30): первые экраны остаются статикой
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
  const isAdmin = ['admin', 'director'].includes(user?.role);

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
          <Route path="/purchasing" element={<ErpGuard allowed={isAdmin}><FabricPurchasing /></ErpGuard>} />
          <Route path="/warehouse" element={<ErpGuard allowed={isAdmin}><Warehouse /></ErpGuard>} />
          <Route path="/subcontracting" element={<ErpGuard allowed={isAdmin}><Subcontracting /></ErpGuard>} />
          <Route path="/experimental" element={<ErpGuard allowed={isAdmin}><Experimental /></ErpGuard>} />
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
