import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import { calcTotal } from '../../utils/pricing';
import { useDraft } from '../../hooks/useDraft';
import styles from './Header.module.css';

export default function Header() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // calcTotal: Zustand сравнит число — компонент ререндерится только при реальном изменении суммы
  const total = useStore(calcTotal);
  const formatted = total > 0 ? total.toLocaleString('ru-RU') + ' ₽' : '0 ₽';
  const { draftStatus, resetDraft } = useDraft();
  const { logout, effectiveRole } = useAuthStore(useShallow(s => ({
    logout: s.logout,
    effectiveRole: s.previewRole || s.user?.role,
  })));

  const draftLabel = draftStatus === 'saving' ? 'сохраняю...'
    : draftStatus === 'saved' ? 'сохранено'
    : 'черновик';

  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('ph_theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ph_theme', theme);
  }, [theme]);
  const isAdmin = ['admin', 'director'].includes(effectiveRole);
  const isProd = effectiveRole === 'production';
  const isDes = effectiveRole === 'designer';

  const nav = (path) => () => {
    navigate(pathname === path ? '/' : path);
    setMenuOpen(false);
  };
  const isActive = (path) => pathname === path;

  return (
    <header className={styles.header}>
      {/* ── Logo ── */}
      <div className={styles.logo} onClick={() => { useStore.getState().resetOrder(); navigate('/'); }} style={{ cursor: 'pointer' }}>
        <svg className={styles['logo-mark']} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" width="24" height="24" style={{ width: 24, height: 24, flexShrink: 0 }}>
          <line x1="16" y1="2" x2="16" y2="30" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="2" y1="16" x2="30" y2="16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="5" y1="5" x2="27" y2="27" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="27" y1="5" x2="5" y2="27" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
        </svg>
        <div>
          <div className={styles['logo-text']}>pinhead</div>
          <div className={styles['logo-sub']}>Order Studio · v2.0</div>
        </div>
      </div>

      {/* ── Burger (mobile) ── */}
      <button className={styles['burger-btn']} aria-label="Меню навигации" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
        {menuOpen ? '✕' : '☰'}
      </button>

      {/* ── Navigation (hidden items by role) ── */}
      <nav className={`${styles['header-nav']}${menuOpen ? ` ${styles.open}` : ''}`} aria-label="Основная навигация">
        {!isProd && !isDes && (
          <button className={`${styles['header-nav-btn']} ${styles['express-btn']}${isActive('/express') ? ` ${styles.active}` : ''}`} onClick={nav('/express')}>
            Экспресс
          </button>
        )}
        <button className={`${styles['header-nav-btn']}${isActive('/orders') ? ` ${styles.active}` : ''}`} data-nav="orders" onClick={nav('/orders')}>
          Заказы
        </button>
        <button className={`${styles['header-nav-btn']}${isActive('/print') ? ` ${styles.active}` : ''}`} onClick={nav('/print')}>
          ТЗ
        </button>
        {isAdmin && (
          <button className={`${styles['header-nav-btn']}${isActive('/sku') ? ` ${styles.active}` : ''}`} onClick={nav('/sku')}>
            SKU
          </button>
        )}
        {/* "Цены нанесений" tab removed — pricing is now the 6th tab inside SKU Editor */}
        {(isAdmin || isProd || effectiveRole === 'rop') && (
          <button className={`${styles['header-nav-btn']}${isActive('/analytics') ? ` ${styles.active}` : ''}`} onClick={nav('/analytics')}>
            Аналитика
          </button>
        )}
        {isAdmin && (
          <button className={`${styles['header-nav-btn']}${isActive('/admin') ? ` ${styles.active}` : ''}`} onClick={nav('/admin')}>
            Админ
          </button>
        )}
      </nav>

      {/* ── Right: draft + price + logout ── */}
      <div className={styles['header-right']}>
        {(pathname === '/' || pathname === '/express') && (
          <>
            <div className={styles['header-draft']}>
              <div className={`${styles['draft-dot']}${draftStatus === 'saving' ? ` ${styles.saving}` : draftStatus === 'saved' ? ` ${styles.saved}` : ''}`} />
              <span className={styles['draft-text']}>{draftLabel}</span>
              <button className={styles['draft-reset-btn']} onClick={resetDraft} title="Сбросить черновик" aria-label="Сбросить черновик">✕</button>
            </div>
            <div className={styles['header-total']}>
              <span className={styles['total-label']}>Итого</span>
              <span className={styles['total-value']}>{formatted}</span>
            </div>
          </>
        )}
        <button
          className={styles['theme-toggle']}
          onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
          aria-label={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
          title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <button className={styles['header-logout']} onClick={logout}>Выйти</button>
      </div>
    </header>
  );
}
