import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import NavBar from './components/NavBar';

const WorkshopBoard = lazy(() => import('./components/WorkshopBoard'));
const DirectorView = lazy(() => import('./components/DirectorView'));
const CapacityBoard = lazy(() => import('./components/CapacityBoard'));
const AnalyticsView = lazy(() => import('./components/AnalyticsView'));
const KanbanMock = lazy(() => import('./components/KanbanMock'));
const AndonBoard = lazy(() => import('./components/AndonBoard'));
const KioskView = lazy(() => import('./components/KioskView'));
const TVDashboard = lazy(() => import('./components/TVDashboard'));
const WorkInstructions = lazy(() => import('./components/WorkInstructions'));
const QRScanner = lazy(() => import('./components/QRScanner'));
const BatchView = lazy(() => import('./components/BatchView'));

const FULL_SCREEN_PATHS = ['/andon', '/kiosk', '/tv'];

function AppContent() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Загрузка...</div>}>
      <Routes>
        <Route path="/" element={<WorkshopBoard />} />
        <Route path="/director" element={<DirectorView />} />
        <Route path="/capacity" element={<CapacityBoard />} />
        <Route path="/analytics" element={<AnalyticsView />} />
        <Route path="/kanban" element={<KanbanMock />} />
        <Route path="/andon" element={<AndonBoard />} />
        <Route path="/kiosk" element={<KioskView />} />
        <Route path="/tv" element={<TVDashboard />} />
        <Route path="/instructions/:taskId" element={<WorkInstructions />} />
        <Route path="/scan" element={<QRScanner />} />
        <Route path="/batches" element={<BatchView />} />
      </Routes>
    </Suspense>
  );
}

function Layout() {
  const location = useLocation();
  const isFullScreen = FULL_SCREEN_PATHS.includes(location.pathname);
  return (
    <>
      {!isFullScreen && <NavBar />}
      <AppContent />
    </>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout />
    </BrowserRouter>
  );
}
