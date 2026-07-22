import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import ErpLayout from './layout/ErpLayout';
import ErpDashboard from './screens/ErpDashboard';
import OrdersScreen from './screens/OrdersScreen';
import DepartmentQueue from './screens/DepartmentQueue';
import { ScreenSkeleton } from './components/ErpSkeletons';
import { OrderDrawerHost } from './screens/orderCard/OrderDrawerHost';
import styles from './erp.module.css';

// Тяжёлые экраны — отдельные чанки (п.30): первые экраны остаются статикой
const OrderCard = lazy(() => import('./screens/OrderCard'));
const ProductionBoard = lazy(() => import('./screens/ProductionBoard')); // + ErpKanban в чанке
const AdminScreen = lazy(() => import('./screens/AdminScreen')); // + Employees/Departments
const FabricPurchasing = lazy(() => import('./screens/FabricPurchasing'));
const Warehouse = lazy(() => import('./screens/Warehouse'));
const Subcontracting = lazy(() => import('./screens/Subcontracting'));
const Experimental = lazy(() => import('./screens/Experimental'));

/**
 * Кей по orderId → свежий инстанс карточки на каждый заказ: при переходе A→B страница
 * ремонтируется, useOrderDetail стартует с чистого стейта (без мигания данных прошлого заказа).
 * Зеркалит OrderDrawerHost (key={orderId}).
 */
function OrderCardRoute() {
  const { orderId } = useParams();
  return <OrderCard key={orderId} />;
}

/** Инлайн-панель «нет доступа» — без redirect, чтобы избежать гонки с загрузкой роли */
function ErpGuard({ allowed, children }) {
  if (!allowed) {
    return (
      <div className={styles.noAccess}>
        <div className={styles.stubIcon} aria-hidden="true">🔒</div>
        <div>Нет доступа к этому разделу</div>
      </div>
    );
  }
  return children;
}

export default function ErpApp({ user }) {
  const isAdmin = ['admin', 'director'].includes(user?.role);

  return (
    <ErpLayout user={user}>
      <Suspense fallback={<ScreenSkeleton />}>
        <Routes>
          <Route path="/" element={<ErpDashboard />} />
          <Route path="/orders" element={<OrdersScreen user={user} />} />
          <Route path="/orders/:orderId" element={<OrderCardRoute />} />
          <Route path="/board" element={<ProductionBoard />} />
          <Route path="/queue" element={<DepartmentQueue />} />
          <Route path="/admin" element={<ErpGuard allowed={isAdmin}><AdminScreen /></ErpGuard>} />
          <Route path="/employees" element={<Navigate to="/admin?tab=users" replace />} />
          <Route path="/departments" element={<Navigate to="/admin?tab=depts" replace />} />
          <Route path="/purchasing" element={<ErpGuard allowed={isAdmin}><FabricPurchasing /></ErpGuard>} />
          <Route path="/warehouse" element={<ErpGuard allowed={isAdmin}><Warehouse /></ErpGuard>} />
          <Route path="/subcontracting" element={<ErpGuard allowed={isAdmin}><Subcontracting /></ErpGuard>} />
          <Route path="/experimental" element={<ErpGuard allowed={isAdmin}><Experimental /></ErpGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <OrderDrawerHost />
    </ErpLayout>
  );
}
