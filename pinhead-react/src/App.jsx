import './App.css'
import { useStore } from './store/useStore'
import Header from './components/layout/Header'
import ProgressBar from './components/layout/ProgressBar'
import StepGarment from './components/steps/StepGarment'
import StepExtras from './components/steps/StepExtras'
import StepDesign from './components/steps/StepDesign'
import StepDetails from './components/steps/StepDetails'
import StepSummary from './components/steps/StepSummary'

const STEPS = [StepGarment, StepExtras, StepDesign, StepDetails, StepSummary];

function App() {
  const step = useStore(s => s.step);
  const CurrentStep = STEPS[step] || StepGarment;

  return (
    <div className="app">
      <Header />
      <ProgressBar />
      <main className="app-main">
        <CurrentStep />
      </main>
    </div>
  );
}

export default App
