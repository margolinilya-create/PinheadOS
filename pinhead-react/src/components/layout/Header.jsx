import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { calcTotal } from '../../utils/pricing';
import { useDraft } from '../../hooks/useDraft';

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const state = useStore();
  const total = calcTotal(state);
  const formatted = total > 0 ? total.toLocaleString('ru-RU') + ' ₽' : '0 ₽';
  const { draftStatus, resetDraft } = useDraft();
  const { user, logout } = useAuthStore();

  const draftLabel = draftStatus === 'saving' ? 'сохраняю...'
    : draftStatus === 'saved' ? 'сохранено'
    : 'черновик';

  const [menuOpen, setMenuOpen] = useState(false);
  const isAdmin = ['admin', 'director'].includes(user?.role);
  const isProd = user?.role === 'production';
  const isDes = user?.role === 'designer';

  const nav = (path) => () => {
    navigate(pathname === path ? '/' : path);
    setMenuOpen(false);
  };
  const isActive = (path) => pathname === path;

  return (
    <header>
      {/* ── Logo ── */}
      <div className="logo" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        <svg className="logo-mark" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="16" y1="2" x2="16" y2="30" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="2" y1="16" x2="30" y2="16" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="5" y1="5" x2="27" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="27" y1="5" x2="5" y2="27" stroke="#000" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div>
          <div className="logo-text">pinhead</div>
          <div className="logo-sub">Order Studio · v2.0</div>
        </div>
      </div>

      {/* ── Burger (mobile) ── */}
      <button className="burger-btn" onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* ── Navigation (hidden items by role) ── */}
      <nav className={`header-nav${menuOpen ? ' open' : ''}`}>
        {!isProd && !isDes && (
          <button className={`header-nav-btn express-btn${isActive('/express') ? ' active' : ''}`} onClick={nav('/express')}>
            Express
          </button>
        )}
        <button className={`header-nav-btn${isActive('/orders') ? ' active' : ''}`} onClick={nav('/orders')}>
          Заказы
        </button>
        <button className={`header-nav-btn${isActive('/print') ? ' active' : ''}`} onClick={nav('/print')}>
          ТЗ
        </button>
        {!isProd && !isDes && (
          <button className={`header-nav-btn${isActive('/sku') ? ' active' : ''}`} onClick={nav('/sku')}>
            SKU
          </button>
        )}
        {!isProd && !isDes && (
          <button className={`header-nav-btn${isActive('/prices') ? ' active' : ''}`} onClick={nav('/prices')}>
            Цены
          </button>
        )}
        {(isAdmin || isProd || user?.role === 'rop') && (
          <button className={`header-nav-btn${isActive('/analytics') ? ' active' : ''}`} onClick={nav('/analytics')}>
            Аналитика
          </button>
        )}
        {isAdmin && (
          <button className={`header-nav-btn${isActive('/admin') ? ' active' : ''}`} onClick={nav('/admin')}>
            Admin
          </button>
        )}
      </nav>

      {/* ── Right: draft + price + logout ── */}
      <div className="header-right">
        <div className="header-draft">
          <div className={`draft-dot${draftStatus === 'saving' ? ' saving' : draftStatus === 'saved' ? ' saved' : ''}`} />
          <span className="draft-text">{draftLabel}</span>
          <button className="draft-reset-btn" onClick={resetDraft} title="Сбросить черновик">✕</button>
        </div>
        <div className="header-total">
          <span className="total-label">Итого</span>
          <span className="total-value">{formatted}</span>
        </div>
        <button className="header-logout" onClick={logout}>Выйти</button>
      </div>
    </header>
  );
}
