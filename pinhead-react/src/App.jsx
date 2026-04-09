import React, { useEffect, useState, Suspense } from 'react'
import { Routes, Route, Navigate, useBlocker } from 'react-router-dom'
import './styles/index.css'
import { useStore } from './store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from './store/useAuthStore'
import ErrorBoundary from './components/shared/ErrorBoundary'
import Header from './components/layout/Header'
import ProgressBar from './components/layout/ProgressBar'
import StepGarment from './components/steps/StepGarment'
import StepDesign from './components/steps/StepDesign'
import StepItems from './components/steps/StepItems'
import StepDetails from './components/steps/StepDetails'
import StepSummary from './components/steps/StepSummary'
import AuthScreen from './components/auth/AuthScreen'
import ToastContainer from './components/shared/Toast'
import RolePreviewBar from './components/shared/RolePreviewBar'

const KanbanBoard = React.lazy(() => import('./components/orders/KanbanBoard'));
const PriceEditor = React.lazy(() => import('./components/editors/PriceEditor'));
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
      <main id="main-content" role="main" className="container">
        <CurrentStep />
      </main>
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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, color: 'var(--text-dim)' }}>
      <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTopColor: 'var(--accent, #333)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <span style={{ fontSize: 14 }}>Загрузка...</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
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
      <a href="#main-content" className="skip-link" style={{
        position: 'absolute', left: '-9999px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden',
        zIndex: 9999, padding: '8px 16px', background: '#000', color: '#fff', textDecoration: 'none',
      }} onFocus={e => { e.target.style.position = 'fixed'; e.target.style.left = '8px'; e.target.style.top = '8px'; e.target.style.width = 'auto'; e.target.style.height = 'auto'; }}
         onBlur={e => { e.target.style.position = 'absolute'; e.target.style.left = '-9999px'; e.target.style.width = '1px'; e.target.style.height = '1px'; }}>
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
      <RolePreviewBar />

      <Routes>
        <Route path="/" element={<WizardPage />} />
        <Route path="/orders" element={<Suspense fallback={<div className="panel-loading">Загрузка...</div>}><KanbanBoard /></Suspense>} />
        <Route path="/print" element={<Suspense fallback={<div className="panel-loading">Загрузка...</div>}><PrintPreview /></Suspense>} />
        <Route path="/express" element={<RoleGuard allowed={canEdit}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><ExpressCalc /></Suspense></RoleGuard>} />
        <Route path="/prices" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><PriceEditor /></Suspense></RoleGuard>} />
        <Route path="/sku" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><SkuEditor /></Suspense></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><AdminPanel /></Suspense></RoleGuard>} />
        <Route path="/analytics" element={<RoleGuard allowed={isAdmin || effectiveRole === 'rop' || isProduction}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><Dashboard /></Suspense></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {isRealAdmin && (
        <Suspense fallback={null}><Agentation /></Suspense>
      )}
      <ToastContainer />

      {blocker.state === 'blocked' && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 8, padding: 24, maxWidth: 360, width: '90%'
          }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
              Заказ не сохранён
            </div>
            <div style={{ color: 'var(--text-mid)', fontSize: 14, marginBottom: 20 }}>
              Если уйти сейчас — черновик сохранится, но несохранённые изменения потеряются.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }}
                onClick={() => blocker.reset()}>
                Остаться
              </button>
              <button className="btn" style={{ flex: 1 }}
                onClick={() => blocker.proceed()}>
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
