import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { useAuthStore, watchAuthState } from './store/useAuthStore'
import { toast } from './store/useToastStore'
import { installGlobalErrorReporting, reportError } from './lib/errorReport'
import { handlePossibleUpdate } from './lib/appUpdate'
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
  /**
   * «Вышло обновление» — не ошибка приложения, а устаревшая вкладка.
   *
   * Планшет в цеху держат открытым сутками; выкатка меняет имена чанков, и
   * первый же ленивый экран не грузится. Тост «Failed to fetch dynamically
   * imported module» человеку не говорит ничего. Лечится это перезагрузкой,
   * но делаем её НЕ САМИ: планшет — устройство ввода, и молчаливый reload съел
   * бы набранное в соседней форме. Спрашиваем (см. `lib/appUpdate`). Отчёт
   * не шлём: наблюдаемость должна показывать поломки, а не наши же деплои.
   */
  if (handlePossibleUpdate(event.reason)) return;
  reportError(event.reason, 'promise');
  toast.error(isNetworkFailure(event.reason)
    ? 'Нет связи с сервером — часть данных не загрузилась'
    : (event.reason?.message || 'Неизвестная ошибка'));
});

/**
 * Прогрев первого экрана — ДО `init()`, а не после.
 *
 * Цепочка старта была строго последовательной: входной чанк → `init()` →
 * ответ Supabase → рендер → и только теперь начинает грузиться чанк оболочки
 * ERP со всей своей статикой. Лишний полный круг «запрос-ответ» на самой
 * медленной части, притом что оболочку открывают 100 % пользователей.
 *
 * Что именно греть, решает наличие сохранённой сессии: supabase-js держит её
 * в localStorage под ключом `sb-<ref>-auth-token`. ЭТО ТОЛЬКО ПОДСКАЗКА
 * ЗАГРУЗЧИКУ и ни одно решение о доступе на ней не строится: промах стоит
 * одного лишнего чанка в фоне, а решает по-прежнему `init()` с настоящей
 * сессией. Не превращайте это в ветвление прав.
 *
 * Форму входа греть не нужно: она осталась статической (см. `App.jsx`),
 * потому что ленивая давала «Загрузка…» на её месте при промахе эвристики,
 * а это запрещено правилом проекта и сторожится `App.test.jsx`.
 */
function hasStoredSession() {
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.endsWith('-auth-token')) return true;
    }
  } catch {
    // Приватный режим или заблокированное хранилище: считаем, что сессии нет,
    // и ничего не греем — форма входа и так лежит во входном чанке
  }
  return false;
}

if (hasStoredSession()) import('./erp/ErpApp').catch(() => {});

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
