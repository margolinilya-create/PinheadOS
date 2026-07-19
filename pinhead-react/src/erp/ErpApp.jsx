import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ErpLayout from './layout/ErpLayout';
import ErpDashboard from './screens/ErpDashboard';
import OrdersScreen from './screens/OrdersScreen';
import DepartmentQueue from './screens/DepartmentQueue';
import { ScreenSkeleton } from './components/ErpSkeletons';
import styles from './erp.module.css';

// Тяжёлые экраны — отдельные чанки (п.30): первые экраны остаются статикой
const OrderCard = lazy(() => import('./screens/OrderCard'));
const ProductionBoard = lazy(() => import('./screens/ProductionBoard')); // + ErpKanban в чанке
const AdminScreen = lazy(() => import('./screens/AdminScreen')); // + Employees/Departments
const FabricPurchasing = lazy(() => import('./screens/FabricPurchasing'));
const Subcontracting = lazy(() => import('./screens/Subcontracting'));

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
          <Route path="/orders/:orderId" element={<OrderCard />} />
          <Route path="/board" element={<ProductionBoard />} />
          <Route path="/queue" element={<DepartmentQueue />} />
          <Route path="/admin" element={<ErpGuard allowed={isAdmin}><AdminScreen /></ErpGuard>} />
          <Route path="/employees" element={<Navigate to="/admin?tab=users" replace />} />
          <Route path="/departments" element={<Navigate to="/admin?tab=depts" replace />} />
          <Route path="/purchasing" element={<ErpGuard allowed={isAdmin}><FabricPurchasing /></ErpGuard>} />
          <Route path="/subcontracting" element={<ErpGuard allowed={isAdmin}><Subcontracting /></ErpGuard>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErpLayout>
  );
}
