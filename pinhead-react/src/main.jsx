import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { useAuthStore, watchAuthState } from './store/useAuthStore'
import { toast } from './store/useToastStore'
import { installGlobalErrorReporting, reportError } from './lib/errorReport'
import { isNetworkFailure } from './utils/i18n'

// Ошибки вне React (события, таймеры, промисы) до ErrorBoundary не доходят.
// Тост остаётся пользователю, отчёт уходит наружу — если приёмник настроен.
installGlobalErrorReporting();

/**
 * Необработанные отклонения промисов.
 *
 * Сюда долетает всё, что не поймали на месте, — и человеку доставалось сырое
 * `Load failed` (так WebKit называет несостоявшийся fetch) или `Failed to fetch`
 * из Chromium. Это не сообщение, а внутренний текст браузера: он не говорит ни
 * что случилось, ни что делать. Переводим причину словами; сам стек уходит
 * в консоль и в отчёт, как и раньше.
 */
window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandledrejection]', event.reason);
  reportError(event.reason, 'promise');
  toast.error(isNetworkFailure(event.reason)
    ? 'Нет связи с сервером — часть данных не загрузилась'
    : (event.reason?.message || 'Неизвестная ошибка'));
});

// Загружаем авторизацию сразу и следим за ней дальше: сессия может кончиться
// в любой момент, и до этой подписки приложение узнавало об этом только отказами RLS.
useAuthStore.getState().init().catch(() => {});
watchAuthState();

// Черновик визарда и каталоги Order Studio запускает САМ РАЗДЕЛ
// (`orderstudio/OrderStudioApp`): здесь их инициализация тянула его стор,
// `src/data` и `utils/pricing` во входной чанк — при выключенном флаге тоже.

const router = createBrowserRouter([
  { path: '*', Component: App },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
