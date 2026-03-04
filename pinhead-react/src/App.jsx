import { useEffect, useState } from 'react'
import './App.css'
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

const STEPS = [StepGarment, StepExtras, StepDesign, StepDetails, StepSummary];

function App() {
  const step = useStore(s => s.step);
  const CurrentStep = STEPS[step] || StepGarment;
  const { user, loading, init } = useAuthStore();
  const [showKanban, setShowKanban] = useState(false);
  const [showExpress, setShowExpress] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  useEffect(() => { init(); }, [init]);

  // Загрузка
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

  // Не авторизован
  if (!user) {
    return <AuthScreen />;
  }

  // Ожидание подтверждения
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

  return (
    <div className="app">
      <Header
        onToggleKanban={() => setShowKanban(!showKanban)}
        onToggleExpress={() => setShowExpress(!showExpress)}
        onTogglePrint={() => setShowPrint(!showPrint)}
      />
      <ProgressBar />
      <main className="app-main">
        <CurrentStep />
      </main>

      {showKanban && <KanbanBoard onClose={() => setShowKanban(false)} />}
      {showExpress && <ExpressCalc onClose={() => setShowExpress(false)} />}
      {showPrint && <PrintPreview onClose={() => setShowPrint(false)} />}
    </div>
  );
}

export default App
