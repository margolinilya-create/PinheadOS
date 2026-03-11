import { useEffect, useState } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import './styles/index.css'
import { Agentation } from 'agentation'
import { useStore } from './store/useStore'
import { useAuthStore } from './store/useAuthStore'
import { useOrdersStore } from './store/useOrdersStore'
import Header from './components/layout/Header'
import ProgressBar from './components/layout/ProgressBar'
import StepGarment from './components/steps/StepGarment'
import StepExtras from './components/steps/StepExtras'
import StepDesign from './components/steps/StepDesign'
import StepItems from './components/steps/StepItems'
import StepDetails from './components/steps/StepDetails'
import StepSummary from './components/steps/StepSummary'
import AuthScreen from './components/auth/AuthScreen'
import KanbanBoard from './components/orders/KanbanBoard'
import PrintPreview from './components/output/PrintPreview'
import ExpressCalc from './components/editors/ExpressCalc'
import PriceEditor from './components/editors/PriceEditor'
import SkuEditor from './components/editors/SkuEditor'
import AdminPanel from './components/auth/AdminPanel'
import ToastContainer from './components/shared/Toast'
import TechCard from './components/production/TechCard'
import Dashboard from './components/analytics/Dashboard'

const STEPS = [StepGarment, StepExtras, StepDesign, StepItems, StepDetails, StepSummary];

// Wizard page — main step-based flow
function WizardPage() {
  const step = useStore(s => s.step);
  const CurrentStep = STEPS[step] || StepGarment;
  return (
    <>
      <ProgressBar />
      <main className="container">
        <CurrentStep />
      </main>
    </>
  );
}

// Role guard — redirects to / if role doesn't match
function RoleGuard({ allowed, children }) {
  const user = useAuthStore(s => s.user);
  if (!allowed) return <Navigate to="/" replace />;
  return children;
}

function App() {
  const { user, loading, init } = useAuthStore();
  const [techCardOrder, setTechCardOrder] = useState(null);
  const updateStatus = useOrdersStore(s => s.updateStatus);

  useEffect(() => { init(); }, [init]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 14, color: 'var(--text-dim)' }}>
        <span style={{ fontSize: 32 }}>✳</span>
        <span>Загрузка...</span>
      </div>
    );
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

  const isAdmin = ['admin', 'director'].includes(user.role);
  const isProduction = user.role === 'production';
  const isDesigner = user.role === 'designer';
  const canEdit = !isProduction && !isDesigner;

  return (
    <>
      {/* ── RAY DECO SVG ── */}
      <svg style={{ position: 'fixed', top: -120, right: -80, width: 420, opacity: 0.04, pointerEvents: 'none', zIndex: 0 }} viewBox="0 0 400 400" fill="none" xmlns="http://www.w3.org/2000/svg">
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

      <Routes>
        <Route path="/" element={<WizardPage />} />
        <Route path="/orders" element={<KanbanBoard onOpenTechCard={setTechCardOrder} />} />
        <Route path="/print" element={<PrintPreview />} />
        <Route path="/express" element={<RoleGuard allowed={canEdit}><ExpressCalc /></RoleGuard>} />
        <Route path="/prices" element={<RoleGuard allowed={canEdit}><PriceEditor /></RoleGuard>} />
        <Route path="/sku" element={<RoleGuard allowed={canEdit}><SkuEditor /></RoleGuard>} />
        <Route path="/admin" element={<RoleGuard allowed={isAdmin}><AdminPanel /></RoleGuard>} />
        <Route path="/analytics" element={<RoleGuard allowed={isAdmin || user.role === 'rop'}><Dashboard /></RoleGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {/* TechCard overlay (opened from kanban) */}
      {techCardOrder && (
        <TechCard
          order={techCardOrder}
          onClose={() => setTechCardOrder(null)}
          onStatusChange={(id, status) => { updateStatus(id, status); setTechCardOrder(prev => prev ? { ...prev, status } : null); }}
        />
      )}

      {isAdmin && <Agentation />}
      <ToastContainer />
    </>
  );
}

export default App
