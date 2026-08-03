import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { useStore } from './store/useStore'
import { useAuthStore } from './store/useAuthStore'
import { toast } from './store/useToastStore'
import { FEATURES } from './config/features'
import { installGlobalErrorReporting, reportError } from './lib/errorReport'

// Ошибки вне React (события, таймеры, промисы) до ErrorBoundary не доходят.
// Тост остаётся пользователю, отчёт уходит наружу — если приёмник настроен.
installGlobalErrorReporting();

// Catch unhandled promise rejections globally
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason || 'Неизвестная ошибка');
  console.error('[unhandledrejection]', event.reason);
  reportError(event.reason, 'promise');
  toast.error(msg);
});

// Загружаем авторизацию сразу
useAuthStore.getState().init().catch(() => {});

// Order Studio-специфичное: черновик и каталоги грузим только при включённом флаге
if (FEATURES.orderStudio) {
  const draft = localStorage.getItem('pinhead_draft');
  if (draft) {
    try {
      useStore.getState().restoreFromDraft(JSON.parse(draft));
    } catch {
      localStorage.removeItem('pinhead_draft');
    }
  }
  useStore.getState().loadCatalogs().catch(() => {});
}

const router = createBrowserRouter([
  { path: '*', Component: App },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
