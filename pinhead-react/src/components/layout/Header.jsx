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
        <span className="header-logo">✳</span>
        <span className="header-brand">pinhead</span>
        <span className="header-title">Order Studio</span>
        <span className="header-version">v2.0</span>
      </div>
      <div className="header-right">
        <div className="header-draft">
          <span className={`draft-dot ${draftStatus}`} />
          <span className="draft-label">{draftLabel}</span>
          <button className="draft-reset" onClick={resetDraft} title="Сбросить черновик">✕</button>
        </div>
        <div className="header-price-sep" />
        <div className="header-total">{formatted}</div>
        <div className="header-price-sep" />
        <div className="header-btns">
          {onToggleExpress && (
            <button className="header-action-btn" onClick={onToggleExpress}>EXPRESS</button>
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
          <>
            <div className="header-price-sep" />
            <div className="header-user">
              <span className="header-user-name">{user.name}</span>
              <button className="header-logout" onClick={logout}>Выйти</button>
            </div>
          </>
        )}
      </div>
    </header>
  );
}
