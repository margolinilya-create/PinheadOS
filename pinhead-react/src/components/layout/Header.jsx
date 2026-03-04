import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { calcTotal } from '../../utils/pricing';
import { useDraft } from '../../hooks/useDraft';

export default function Header({ onToggleKanban, onToggleExpress, onTogglePrint, onTogglePrices, onToggleSku, onToggleAdmin }) {
  const state = useStore();
  const total = calcTotal(state);
  const formatted = total > 0 ? total.toLocaleString('ru-RU') + ' ₽' : '— ₽';
  const { draftStatus, resetDraft } = useDraft();
  const { user, logout } = useAuthStore();

  const draftLabel = draftStatus === 'saving' ? 'сохраняю...'
    : draftStatus === 'saved' ? 'сохранено'
    : 'черновик';

  return (
    <header className="header">
      <div className="header-left">
        <svg className="header-logo-svg" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="16" y1="2" x2="16" y2="30" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="2" y1="16" x2="30" y2="16" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="5" y1="5" x2="27" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="27" y1="5" x2="5" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div>
          <div className="header-brand">pinhead</div>
          <div className="header-title">Order Studio · v1.7</div>
        </div>
      </div>
      <div className="header-center" />
      <div className="header-right">
        <div className="header-draft">
          <span className={`draft-dot ${draftStatus}`} />
          <span className="draft-label">{draftLabel}</span>
          <button className="draft-reset" onClick={resetDraft} title="Сбросить черновик">✕</button>
          <div className="header-price-sep" />
          <span className="header-total-label">Итого</span>
          <span className="header-total">{formatted}</span>
        </div>
        <div className="header-btns">
          {onToggleExpress && (
            <button className="header-action-btn express" onClick={onToggleExpress}>EXPRESS</button>
          )}
          {onTogglePrices && (
            <button className="header-action-btn" onClick={onTogglePrices}>ЦЕНЫ</button>
          )}
          {onToggleSku && (
            <button className="header-action-btn" onClick={onToggleSku}>SKU</button>
          )}
          {onToggleKanban && (
            <button className="header-action-btn" onClick={onToggleKanban}>ЗАКАЗЫ</button>
          )}
          {onTogglePrint && (
            <button className="header-action-btn" onClick={onTogglePrint}>ТЗ</button>
          )}
          {onToggleAdmin && (
            <button className="header-action-btn" onClick={onToggleAdmin} style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>ADMIN</button>
          )}
        </div>
        {user && (
          <div className="header-user">
            <button className="header-logout" onClick={logout}>Выйти</button>
          </div>
        )}
      </div>
    </header>
  );
}
