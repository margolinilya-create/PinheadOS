import React, { lazy, useEffect, useState, Suspense } from 'react'
import { Routes, Route, Navigate, useBlocker } from 'react-router-dom'
import styles from '../App.module.css'
import { useStore } from './store/useStore'
import { useShallow } from 'zustand/react/shallow'
import { useAuthStore } from '../store/useAuthStore'
import Header from './components/layout/Header'
import ProgressBar from './components/layout/ProgressBar'
import StepGarment from './components/steps/StepGarment'

// Lazy-load wizard steps 2-5 (rendered only when user advances)
const StepDesign = lazy(() => import('./components/steps/StepDesign'));
const StepItems = lazy(() => import('./components/steps/StepItems'));
const StepDetails = lazy(() => import('./components/steps/StepDetails'));
const StepSummary = lazy(() => import('./components/steps/StepSummary'));
import RolePreviewBar from './components/shared/RolePreviewBar'
import OnboardingTips from './components/shared/OnboardingTips'
import CommandPalette from './components/shared/CommandPalette'

const KanbanBoard = React.lazy(() => import('./components/orders/KanbanBoard'));
// PriceEditor is now embedded inside SkuEditor as the "Ценообразование" tab.
// /prices redirects to /sku?tab=pricing
const ExpressCalc = React.lazy(() => import('./components/editors/ExpressCalc'));
const AdminScreen = React.lazy(() => import('../erp/screens/AdminScreen'));
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

/**
 * Order Studio — визард оформления заказа + цены (заархивировано за feature-flag).
 * Показывается только при FEATURES.orderStudio === true.
 */
export default function OrderStudioApp({ user }) {
  const previewRole = useAuthStore(s => s.previewRole);
  const [catalogsReady, setCatalogsReady] = useState(false);
  const { step, saved } = useStore(useShallow(s => ({ step: s.step, saved: s.saved })));

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    step > 0 &&
    !saved &&
    currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    useStore.getState().loadCatalogs().finally(() => setCatalogsReady(true));
  }, []);

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

  if (!catalogsReady) {
    return <LoadingScreen />;
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
        <Route path="/admin" element={<RoleGuard allowed={isAdmin}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><div className="container"><AdminScreen /></div></Suspense></RoleGuard>} />
        <Route path="/analytics" element={<RoleGuard allowed={isAdmin || effectiveRole === 'rop' || isProduction}><Suspense fallback={<div className="panel-loading">Загрузка...</div>}><Dashboard /></Suspense></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </main>

      {isRealAdmin && (
        <Suspense fallback={null}><Agentation /></Suspense>
      )}

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
