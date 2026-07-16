import React, { useEffect, Suspense } from 'react'
import './styles/index.css'
import styles from './App.module.css'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from './store/useAuthStore'
import ErrorBoundary from './components/shared/ErrorBoundary'
import AuthScreen from './components/auth/AuthScreen'
import ToastContainer from './components/shared/Toast'
import ConfirmDialogHost from './components/shared/ConfirmDialogHost'
import { FEATURES } from './config/features'

// Order Studio (визард/цены) — заархивирован за feature-flag, грузится только при включении.
const OrderStudioApp = React.lazy(() => import('./orderstudio/OrderStudioApp'))
// Внутреннее ERP — новый корень приложения.
const ErpApp = React.lazy(() => import('./erp/ErpApp'))

function LoadingScreen() {
  return (
    <div className={styles.loadingScreen}>
      <div className={styles.spinner} />
      <span className={styles.loadingLabel}>Загрузка...</span>
    </div>
  );
}

function GlobalHosts() {
  return (
    <>
      <ToastContainer />
      <ConfirmDialogHost />
    </>
  );
}

function App() {
  const { user, authLoading, init } = useAuthStore(useShallow(s => ({
    user: s.user,
    authLoading: s.loading,
    init: s.init,
  })));

  useEffect(() => {
    init();
  }, [init]);

  if (authLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return (
      <>
        <AuthScreen />
        <GlobalHosts />
      </>
    );
  }

  if (user.approved === false) {
    return (
      <>
        <div id="pendingScreen" className="show">
          <div className="pending-box">
            <div className="pending-icon">⏳</div>
            <div className="pending-title">Ожидание подтверждения</div>
            <p className="pending-desc">Ваш аккаунт ещё не подтверждён администратором.</p>
            <p className="pending-email">{user.email}</p>
            <button className="pending-logout" onClick={() => useAuthStore.getState().logout()}>Выйти</button>
          </div>
        </div>
        <GlobalHosts />
      </>
    );
  }

  const Shell = FEATURES.orderStudio ? OrderStudioApp : ErpApp;

  return (
    <>
      <Suspense fallback={<LoadingScreen />}>
        <Shell user={user} />
      </Suspense>
      <GlobalHosts />
    </>
  );
}

export default function AppWithErrorBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
