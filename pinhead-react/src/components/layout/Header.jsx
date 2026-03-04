import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { calcTotal } from '../../utils/pricing';
import { useDraft } from '../../hooks/useDraft';

export default function Header({ activePage, onNavigate, isAdmin }) {
  const state = useStore();
  const total = calcTotal(state);
  const formatted = total > 0 ? total.toLocaleString('ru-RU') + ' ₽' : '— ₽';
  const { draftStatus, resetDraft } = useDraft();
  const { user, logout } = useAuthStore();

  const draftLabel = draftStatus === 'saving' ? 'сохраняю...'
    : draftStatus === 'saved' ? 'сохранено'
    : 'черновик';

  return (
    <header>
      <div className="logo" onClick={() => onNavigate('wizard')} style={{ cursor: 'pointer' }}>
        <svg className="logo-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="16" y1="2" x2="16" y2="30" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="2" y1="16" x2="30" y2="16" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="5" y1="5" x2="27" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="27" y1="5" x2="5" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div>
          <div className="logo-text">pinhead</div>
          <div className="logo-sub">Order Studio · v1.7</div>
        </div>
      </div>

      <div className="header-center" />

      <div className="header-actions">
        <div className="header-draft-price">
          <div className={`draft-dot${draftStatus === 'saving' ? ' saving' : draftStatus === 'saved' ? ' saved' : ''}`} />
          <span className="draft-text">{draftLabel}</span>
          <button className="draft-reset-btn" onClick={resetDraft} title="Сбросить черновик и начать заново">✕</button>
          <div className="draft-price-sep" />
          <span className="total-label">Итого</span>
          <span className="total-value">{formatted}</span>
        </div>
        <button
          className={`header-btn express-trigger${activePage === 'express' ? ' active' : ''}`}
          onClick={() => onNavigate(activePage === 'express' ? 'wizard' : 'express')}
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="5" width="4" height="6" rx="0.5" fill="currentColor"/>
            <rect x="7" y="2" width="4" height="9" rx="0.5" fill="currentColor"/>
            <rect x="4" y="0" width="4" height="2" rx="0.5" fill="currentColor" opacity=".6"/>
          </svg>
          EXPRESS
        </button>
        <button
          className={`header-btn${activePage === 'prices' ? ' active' : ''}`}
          onClick={() => onNavigate(activePage === 'prices' ? 'wizard' : 'prices')}
        >
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none"><circle cx="6.5" cy="6.5" r="5.5" stroke="currentColor" strokeWidth="1.5"/><text x="6.5" y="10.5" textAnchor="middle" fontSize="8" fontWeight="700" fill="currentColor" fontFamily="monospace">₽</text></svg>
          ЦЕНЫ
        </button>
        <button
          className={`header-btn${activePage === 'sku' ? ' active' : ''}`}
          onClick={() => onNavigate(activePage === 'sku' ? 'wizard' : 'sku')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="8" y="1" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="1" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/><rect x="8" y="8" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/></svg>
          SKU
        </button>
        <button
          className={`header-btn${activePage === 'orders' ? ' active' : ''}`}
          onClick={() => onNavigate(activePage === 'orders' ? 'wizard' : 'orders')}
        >
          <svg width="14" height="12" viewBox="0 0 14 12" fill="none"><rect x="0" y="0" width="14" height="2" fill="currentColor"/><rect x="0" y="5" width="10" height="2" fill="currentColor"/><rect x="0" y="10" width="12" height="2" fill="currentColor"/></svg>
          ЗАКАЗЫ
        </button>
        <button
          className={`header-btn${activePage === 'print' ? ' active' : ''}`}
          onClick={() => onNavigate(activePage === 'print' ? 'wizard' : 'print')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 1h8v4H3V1Z" stroke="currentColor" strokeWidth="1.3"/><path d="M1 5h12v6H1V5Z" stroke="currentColor" strokeWidth="1.3"/><path d="M4 8h6v5H4V8Z" stroke="currentColor" strokeWidth="1.3"/></svg>
          ТЗ
        </button>
        {isAdmin && (
          <button
            className={`header-btn${activePage === 'admin' ? ' active' : ''}`}
            onClick={() => onNavigate(activePage === 'admin' ? 'wizard' : 'admin')}
          >
            ADMIN
          </button>
        )}
        <div className="user-info-wrap">
          <button className="user-logout-btn" onClick={logout}>Выйти</button>
        </div>
      </div>
    </header>
  );
}
