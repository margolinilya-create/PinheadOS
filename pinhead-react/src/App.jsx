import { useEffect, useState } from 'react'
import './App.css'
import { Agentation } from 'agentation'
import { useStore } from './store/useStore'
import { useAuthStore } from './store/useAuthStore'
import Header from './components/layout/Header'
import ProgressBar from './components/layout/ProgressBar'
import StepGarment from './components/steps/StepGarment'
import StepExtras from './components/steps/StepExtras'
import StepDesign from './components/steps/StepDesign'
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

const STEPS = [StepGarment, StepExtras, StepDesign, StepDetails, StepSummary];

function App() {
  const step = useStore(s => s.step);
  const CurrentStep = STEPS[step] || StepGarment;
  const { user, loading, init } = useAuthStore();
  const [page, setPage] = useState('wizard');

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

  const isAdmin = user.role === 'admin';
  const closePage = () => setPage('wizard');

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

      <Header
        activePage={page}
        onNavigate={setPage}
        isAdmin={isAdmin}
      />

      <ProgressBar />

      <main className="container">
        <CurrentStep onNavigate={setPage} />
      </main>

      {/* ── Fullscreen overlay panels (like original HTML) ── */}
      {page === 'express' && <ExpressCalc onClose={closePage} />}
      {page === 'prices' && <PriceEditor onClose={closePage} />}
      {page === 'sku' && <SkuEditor onClose={closePage} />}
      {page === 'orders' && <KanbanBoard onClose={closePage} onNavigate={setPage} />}
      {page === 'print' && <PrintPreview onClose={closePage} />}
      {page === 'admin' && isAdmin && <AdminPanel onClose={closePage} />}

      {isAdmin && <Agentation />}
      <ToastContainer />
    </>
  );
}

export default App
