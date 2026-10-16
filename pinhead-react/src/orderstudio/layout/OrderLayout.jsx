import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '../../erp/components/Icon';
import appStyles from '../../App.module.css';
import { useAuthStore } from '../../store/useAuthStore';
import { confirm } from '../../store/useConfirmStore';
import { useTheme } from '../../hooks/useTheme';
import { setFeature } from '../../config/features';
import { useDraft } from '../../hooks/useDraft';
import { OrderSidebar } from './OrderSidebar';
import styles from './OrderLayout.module.css';

/**
 * Оболочка раздела «ТЗ» в стиле ERP (стили — снимок ERP, см. шапку OrderLayout.module.css): сайдбар, шапка, область прокрутки.
 * Skip-link и `main#main-content` живут здесь. Ниже 1024 px сайдбар
 * открывается кнопкой «Меню» и закрывается переходом, как в ERP.
 */
/** Подпись индикатора черновика — как у прежней шапки визарда */
const DRAFT_LABEL = { saving: 'сохраняю...', saved: 'сохранено', idle: 'черновик' };
/** Черновик есть только у визарда и экспресс-расчёта: на остальных экранах индикатор лгал бы */
const DRAFT_PATHS = new Set(['/', '/express']);

export default function OrderLayout({ user, children }) {
  const isAdmin = ['admin', 'director'].includes(user?.role);
  const { theme, toggleTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  // Автосохранение визарда (`pinhead_draft`) живёт здесь: оболочка смонтирована
  // всегда, как прежняя шапка. Без этого вызова черновик не пишется вовсе, а диалог
  // ухода обещает «черновик сохранится». Визард позиции v4 ставит паузу сам (itemSession).
  const { draftStatus, resetDraft } = useDraft();

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={appStyles.skipLink}>Перейти к основному содержимому</a>
      <OrderSidebar role={user?.role} open={navOpen} onNavigate={() => setNavOpen(false)} />
      {navOpen && (
        <button
          type="button"
          className={styles.sidebarScrim}
          aria-label="Закрыть меню"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div className={styles.rightcol}>
        <header className={styles.topbar}>
          <button
            type="button"
            className={`${styles.iconBtn} ${styles.navToggle}`}
            aria-label="Меню"
            aria-expanded={navOpen}
            title="Меню"
            onClick={() => setNavOpen((v) => !v)}
          >
            <Icon name="menu" size={19} />
          </button>
          <span className={styles.sectionTitle}>Оформление заказа</span>
          <div className={styles.spacer} />

          {DRAFT_PATHS.has(pathname) && (
            <div className={styles.draft}>
              <span className={`${styles.draftDot} ${styles[`draft_${draftStatus}`] || ''}`} />
              <span className={styles.draftText}>{DRAFT_LABEL[draftStatus] || DRAFT_LABEL.idle}</span>
              {/* Сброс переспрашивает: он стирает весь набранный заказ без возврата */}
              <button
                type="button"
                className={styles.iconBtn}
                title="Сбросить черновик"
                aria-label="Сбросить черновик"
                onClick={async () => {
                  const ok = await confirm({
                    title: 'Сбросить черновик?',
                    message: 'Введённые данные заказа будут удалены.',
                    confirmLabel: 'Сбросить',
                    variant: 'danger',
                  });
                  if (ok) resetDraft();
                }}
              >
                <Icon name="trash" size={17} />
              </button>
            </div>
          )}

          {isAdmin && (
            <button
              type="button"
              className={styles.iconBtn}
              title="Перейти в Производство"
              aria-label="Перейти в Производство"
              onClick={() => {
                setFeature('orderStudio', false);
                window.location.href = '/';
              }}
            >
              <Icon name="board" size={19} />
            </button>
          )}

          <button
            type="button"
            className={styles.iconBtn}
            onClick={toggleTheme}
            aria-label={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
            title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} size={19} />
          </button>

          <div className={styles.userChip}>
            {user?.name || user?.email}
            <div className={styles.userRole}>{user?.role}</div>
          </div>

          {/* Выход переспрашивает: промах пальцем стоил бы сессии и набранного в формах */}
          <button
            type="button"
            className={styles.iconBtn}
            title="Выйти"
            aria-label="Выйти"
            onClick={async () => {
              const ok = await confirm({
                title: 'Выйти из системы?',
                message: 'Несохранённые правки в открытых формах будут потеряны.',
                confirmLabel: 'Выйти',
              });
              if (ok) useAuthStore.getState().logout();
            }}
          >
            <Icon name="power" size={19} />
          </button>
        </header>

        <main
          className={styles.orderMain}
          id="main-content"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
