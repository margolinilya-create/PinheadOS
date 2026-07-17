import { Routes, Route, Navigate } from 'react-router-dom';
import ErpLayout from './layout/ErpLayout';
import ErpDashboard from './screens/ErpDashboard';
import OrdersScreen from './screens/OrdersScreen';
import ProductionBoard from './screens/ProductionBoard';
import DepartmentQueue from './screens/DepartmentQueue';
import OrderCard from './screens/OrderCard';
import AdminScreen from './screens/AdminScreen';
import FabricPurchasing from './screens/FabricPurchasing';
import styles from './erp.module.css';

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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErpLayout>
  );
}
