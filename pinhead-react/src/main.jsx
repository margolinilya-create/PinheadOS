import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { useStore } from './store/useStore'
import { useAuthStore } from './store/useAuthStore'

// Restore draft from localStorage if available
const draft = localStorage.getItem('pinhead_draft');
if (draft) {
  try {
    useStore.getState().restoreFromDraft(JSON.parse(draft));
  } catch (e) {
    localStorage.removeItem('pinhead_draft');
  }
}

// Загружаем авторизацию и каталоги параллельно при старте
Promise.all([
  useAuthStore.getState().init(),
  useStore.getState().loadCatalogs(),
]).catch(() => {});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
