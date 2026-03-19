import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { useStore } from './store/useStore'

// Restore draft from localStorage if available
const draft = localStorage.getItem('pinhead_draft');
if (draft) {
  try {
    useStore.getState().restoreFromDraft(JSON.parse(draft));
  } catch (e) {
    localStorage.removeItem('pinhead_draft');
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
