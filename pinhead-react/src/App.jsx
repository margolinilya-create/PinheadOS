import React, { lazy, useEffect, useState, Suspense } from 'react'
import { Routes, Route, Navigate, useBlocker } from 'react-router-dom'
import './styles/index.css'
import styles from './App.module.css'
import { useStore } from './store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from './store/useAuthStore'
import ErrorBoundary from './components/shared/ErrorBoundary'
import Header from './components/layout/Header'
import ProgressBar from './components/layout/ProgressBar'
import StepGarment from './components/steps/StepGarment'

// Lazy-load wizard steps 2-5 (rendered only when user advances)
const StepDesign = lazy(() => import('./components/steps/StepDesign'));
const StepItems = lazy(() => import('./components/steps/StepItems'));
const StepDetails = lazy(() => import('./components/steps/StepDetails'));
const StepSummary = lazy(() => import('./components/steps/StepSummary'));
import AuthScreen from './components/auth/AuthScreen'
import ToastContainer from './components/shared/Toast'
import ConfirmDialogHost from './components/shared/ConfirmDialogHost'
import RolePreviewBar from './components/shared/RolePreviewBar'
import OnboardingTips from './components/shared/OnboardingTips'
import CommandPalette from './components/shared/CommandPalette'
import { useFeatureFlag } from './hooks/useFeatureFlag'

const KanbanBoard = React.lazy(() => import('./components/orders/KanbanBoard'));
const TechCardOrderList = React.lazy(() => import('./components/production/v2/TechCardOrderList'));
const TechCardBuilder = React.lazy(() => import('./components/production/v2/TechCardBuilder'));
const WorkshopBoard = React.lazy(() => import('./components/production/v2/WorkshopBoard'));
const ForemanScreen = React.lazy(() => import('./components/production/v2/ForemanScreen'));
const PayrollScreen = React.lazy(() => import('./components/production/v2/PayrollScreen'));
const TrashScreen = React.lazy(() => import('./components/production/v2/TrashScreen'));
const OrdersTableView = React.lazy(() => import('./components/production/v2/OrdersTableView'));
const WorkersScreen = React.lazy(() => import('./components/production/v2/WorkersScreen'));
const NotificationsBell = React.lazy(() => import('./components/production/v2/NotificationsBell'));
const V2Nav = React.lazy(() => import('./components/production/v2/V2Nav'));
const UndoToastHost = React.lazy(() => import('./components/production/v2/UndoToastHost'));
// PriceEditor is now embedded inside SkuEditor as the "Ценообразование" tab.
// /prices redirects to /sku?tab=pricing
const ExpressCalc = React.lazy(() => import('./components/editors/ExpressCalc'));
const AdminPanel = React.lazy(() => import('./components/auth/AdminPanel'));
const Dashboard = React.lazy(() => import('./components/analytics/Dashboard'));
const PrintPreview = React.lazy(() => import('./components/output/PrintPreview'));
const SkuEditor = React.lazy(() => import('./components/editors/SkuEditor'));
// Agentation — dev widget, lazy-loaded (tree-shakes out of prod admin bundle)
const Agentation = React.lazy(() =>
  import('agentation').then(m => ({ default: m.Agentation }))
);

const STEPS = [StepGarment, StepDesign, StepItems, StepDetails, StepSummary];

// Wizard page — main step-based flow
function WizardPage() {
  const step = useStore(s => s.step);
  const CurrentStep = STEPS[step] || StepGarment;
  return (
    <>
      <ProgressBar />
      <div className="container">
        <Suspense fallback={<div className="panel-loading">Загрузка...</div>}>
          <CurrentStep />
        </Suspense>
      </div>
    </>
  );
}

// Role guard — redirects to / if role doesn't match
function RoleGuard({ allowed, children }) {
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}

function LoadingScreen() {
  return (
    <div className={styles.loadingScreen}>
      <div className={styles.spinner} />
      <span className={styles.loadingLabel}>Загрузка...</span>
    </div>
  );
}

function App() {
  const { user, authLoading, init, previewRole } = useAuthStore(useShallow(s => ({
    user: s.user,
    authLoading: s.loading,
    init: s.init,
    previewRole: s.previewRole,
  })));
  const [catalogsReady, setCatalogsReady] = useState(false);
  const { step, saved } = useStore(useShallow(s => ({ step: s.step, saved: s.saved })));

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    step > 0 &&
    !saved &&
    currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    Promise.all([
      init(),
      useStore.getState().loadCatalogs(),
    ]).finally(() => setCatalogsReady(true));
  }, [init]);

  useEffect(() => {
    const handleBeforeUnload = (e) => {
      const { step, saved } = useStore.getState();
      if (step > 0 && !saved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const isRealAdmin = ['admin', 'director'].includes(user?.role);
  useEffect(() => {
    document.body.classList.toggle('has-preview-bar', isRealAdmin);
    return () => document.body.classList.remove('has-preview-bar');
  }, [isRealAdmin]);

  // redesign/v2 feature flags — must be called before any early return to
  // satisfy rules-of-hooks. Routes are dark on prod main, live on v2 preview.
  const techCardBuilderEnabled = useFeatureFlag('tech_card_builder');
  const workshopBoardEnabled = useFeatureFlag('workshop_board');
  const foremanScreenEnabled = useFeatureFlag('foreman_screen');
  const payrollScreenEnabled = useFeatureFlag('payroll_screen');
  const notificationsBellEnabled = useFeatureFlag('notifications_bell');
  const trashScreenEnabled = useFeatureFlag('trash_screen');
  const ordersTableViewEnabled = useFeatureFlag('orders_table_view');
  const workersScreenEnabled = useFeatureFlag('workers_screen');

  if (authLoading || !catalogsReady) {
    return <LoadingScreen />;
  }

  if (!user) return <AuthScreen />;

  if (user.approved === false) {
    return (
      <div id="pendingScreen" className="show">
        <div className="pending-box">
          <div className="pending-icon">⏳</div>
          <div className="pending-title">Ожидание подтверждения</div>
          <p className="pending-desc">Ваш аккаунт ещё не подтверждён администратором.</p>
          <p className="pending-email">{user.email}</p>
          <button className="pending-logout" onClick={() => useAuthStore.getState().logout()}>Выйти</button>
        </div>
      </div>
    );
  }

  const effectiveRole = previewRole || user.role;
  const isAdmin = ['admin', 'director'].includes(effectiveRole);
  const isProduction = effectiveRole === 'production';
  const isDesigner = effectiveRole === 'designer';
  const canEdit = !isProduction && !isDesigner;

  return (
    <>
      {/* ── Skip to content ── */}
      <a href="#main-content" className={styles.skipLink}>
        Перейти к основному содержимому
      </a>

      {/* ── RAY DECO SVG ── */}
      <svg aria-hidden="true" style={{ position: 'fixed', top: -120, right: -80, width: 420, opacity: 0.04, pointerEvents: 'none', zIndex: 0 }} viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
        <line x1="200" y1="200" x2="20"  y2="10"  stroke="#000" strokeWidth="1"/>
        <line x1="200" y1="200" x2="390" y2="30"  stroke="#000" strokeWidth="1"/>
        <line x1="200" y1="200" x2="380" y2="200" stroke="#000" strokeWidth="1"/>
        <line x1="200" y1="200" x2="370" y2="370" stroke="#000" strokeWidth="1"/>
        <line x1="200" y1="200" x2="200" y2="390" stroke="#000" strokeWidth="1"/>
        <line x1="200" y1="200" x2="10"  y2="350" stroke="#000" strokeWidth="1"/>
        <line x1="200" y1="200" x2="30"  y2="200" stroke="#000" strokeWidth="1"/>
        <line x1="200" y1="200" x2="60"  y2="20"  stroke="#000" strokeWidth="1"/>
      </svg>

      <Header />
      <Suspense fallback={null}><V2Nav /></Suspense>
      <RolePreviewBar />
      <OnboardingTips />
      <CommandPalette />

      <main id="main-content">
      <Routes>
        <Route path="/" element={<WizardPage />} />
        <Route path="/orders" element={<Suspense fallback={<div className="panel-loading">Загрузка...</div>}><KanbanBoard /></Suspense>} />
        <Route path="/print" element={<Suspense fallback={<div className="panel-loading">Загрузка...</div>}><PrintPreview /></Suspense>} />
        <Route path="/express" element={<RoleGuard allowed={canEdit}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><ExpressCalc /></Suspense></RoleGuard>} />
        <Route path="/prices" element={<Navigate to="/sku?tab=pricing" replace />} />
        <Route path="/sku" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><SkuEditor /></Suspense></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><AdminPanel /></Suspense></RoleGuard>} />
        <Route path="/analytics" element={<RoleGuard allowed={isAdmin || effectiveRole === 'rop' || isProduction}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><Dashboard /></Suspense></RoleGuard>} />
        {techCardBuilderEnabled && (
          <>
            <Route path="/tech-cards" element={<RoleGuard allowed={isAdmin || isProduction}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><TechCardOrderList /></Suspense></RoleGuard>} />
            <Route path="/tech-cards/:orderId" element={<RoleGuard allowed={isAdmin || isProduction}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><TechCardBuilder /></Suspense></RoleGuard>} />
          </>
        )}
        {workshopBoardEnabled && (
          <Route path="/workshop" element={<RoleGuard allowed={isAdmin || isProduction}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><WorkshopBoard /></Suspense></RoleGuard>} />
        )}
        {foremanScreenEnabled && (
          <Route path="/foreman" element={<RoleGuard allowed={isAdmin || isProduction}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><ForemanScreen /></Suspense></RoleGuard>} />
        )}
        {payrollScreenEnabled && (
          <Route path="/payroll" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><PayrollScreen /></Suspense></RoleGuard>} />
        )}
        {trashScreenEnabled && (
          <Route path="/trash" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><TrashScreen /></Suspense></RoleGuard>} />
        )}
        {ordersTableViewEnabled && (
          <Route path="/orders/table" element={<Suspense fallback={<div className="panel-loading">Загрузка...</div>}><OrdersTableView /></Suspense>} />
        )}
        {workersScreenEnabled && (
          <Route path="/workers" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><WorkersScreen /></Suspense></RoleGuard>} />
        )}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </main>

      {isRealAdmin && (
        <Suspense fallback={null}><Agentation /></Suspense>
      )}
      {notificationsBellEnabled && (
        <Suspense fallback={null}><NotificationsBell /></Suspense>
      )}
      <Suspense fallback={null}><UndoToastHost /></Suspense>
      <ToastContainer />
      <ConfirmDialogHost />

      {blocker.state === 'blocked' && (
        <div className={styles.blockerOverlay} role="dialog" aria-modal="true" aria-labelledby="blocker-title">
          <div className={styles.blockerCard}>
            <div id="blocker-title" className={styles.blockerTitle}>
              Заказ не сохранён
            </div>
            <div className={styles.blockerText}>
              Если уйти сейчас — черновик сохранится, но несохранённые изменения потеряются.
            </div>
            <div className={styles.blockerActions}>
              <button className="btn btn-primary" onClick={() => blocker.reset()}>
                Остаться
              </button>
              <button className="btn" onClick={() => blocker.proceed()}>
                Всё равно уйти
              </button>
            </div>
          </div>
        </div>
      )}
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
