import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { useStore } from './store/useStore'
import { useAuthStore } from './store/useAuthStore'
import { toast } from './store/useToastStore'

// Catch unhandled promise rejections globally
window.addEventListener('unhandledrejection', (event) => {
  const msg = event.reason?.message || String(event.reason || 'Неизвестная ошибка');
  console.error('[unhandledrejection]', event.reason);
  toast.error(msg);
});

// Restore draft from localStorage if available
const draft = localStorage.getItem('pinhead_draft');
if (draft) {
  try {
    useStore.getState().restoreFromDraft(JSON.parse(draft));
  } catch {
    localStorage.removeItem('pinhead_draft');
  }
}

// Загружаем авторизацию и каталоги параллельно при старте
Promise.all([
  useAuthStore.getState().init(),
  useStore.getState().loadCatalogs(),
]).catch(() => {});

const router = createBrowserRouter([
  { path: '*', Component: App },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
