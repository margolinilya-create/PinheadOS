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

const STEPS = [StepGarment, StepExtras, StepDesign, StepDetails, StepSummary];

// Pages: 'wizard' (default step flow), 'express', 'prices', 'sku', 'orders', 'print', 'admin'
function App() {
  const step = useStore(s => s.step);
  const CurrentStep = STEPS[step] || StepGarment;
  const { user, loading, init } = useAuthStore();
  const [page, setPage] = useState('wizard');

  useEffect(() => { init(); }, [init]);

  if (loading) {
    return (
      <div className="app">
        <div className="auth-loading">
          <span className="header-logo" style={{ fontSize: 32 }}>✳</span>
          <span>Загрузка...</span>
        </div>
      </div>
    );
  }

  if (!user) return <AuthScreen />;

  if (user.approved === false) {
    return (
      <div className="auth-overlay">
        <div className="auth-card">
          <div className="auth-logo">✳ PINHEAD</div>
          <div className="auth-pending">
            <div className="auth-pending-icon">⏳</div>
            <h3>Ожидание подтверждения</h3>
            <p>Ваш аккаунт ещё не подтверждён администратором.</p>
            <p className="auth-pending-email">{user.email}</p>
            <button className="btn-secondary" onClick={() => useAuthStore.getState().logout()}>Выйти</button>
          </div>
        </div>
      </div>
    );
  }

  const isAdmin = user.role === 'admin';
  const goBack = () => setPage('wizard');

  return (
    <div className="app">
      <Header
        activePage={page}
        onNavigate={setPage}
        isAdmin={isAdmin}
      />

      {page === 'wizard' && (
        <>
          <ProgressBar />
          <main className="app-main">
            <CurrentStep />
          </main>
        </>
      )}

      {page === 'express' && (
        <main className="app-main page-view">
          <ExpressCalc onBack={goBack} />
        </main>
      )}

      {page === 'prices' && (
        <main className="app-main page-view">
          <PriceEditor onBack={goBack} />
        </main>
      )}

      {page === 'sku' && (
        <main className="app-main page-view">
          <SkuEditor onBack={goBack} />
        </main>
      )}

      {page === 'orders' && (
        <main className="app-main page-view">
          <KanbanBoard onBack={goBack} />
        </main>
      )}

      {page === 'print' && (
        <main className="app-main page-view">
          <PrintPreview onBack={goBack} />
        </main>
      )}

      {page === 'admin' && isAdmin && (
        <main className="app-main page-view">
          <AdminPanel onBack={goBack} />
        </main>
      )}

      {isAdmin && <Agentation />}
    </div>
  );
}

export default App
