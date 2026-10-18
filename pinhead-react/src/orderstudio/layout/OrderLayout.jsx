import { useState } from 'react';
import { Icon } from '../../erp/components/Icon';
import appStyles from '../../App.module.css';
import { useAuthStore } from '../../store/useAuthStore';
import { confirm } from '../../store/useConfirmStore';
import { useTheme } from '../../hooks/useTheme';
import { switchToProduction } from '../switchToProduction';
import { ROLE_LABELS } from '../../data/roles';
import { canUseSales } from './orderNav';
import { OrderSidebar } from './OrderSidebar';
import styles from './OrderLayout.module.css';

/** Подпись роли в шапке: в разделе важна роль продаж; код роли человек не читает (обход, M-2) */
function roleCaption(user) {
  if (!user) return '';
  if (user.is_ms) return 'Менеджер сопровождения';
  if (user.is_sales) return 'Менеджер продаж';
  return ROLE_LABELS[user.role] ?? user.role ?? '';
}

/**
 * Оболочка раздела «ТЗ» в стиле ERP (стили — снимок ERP, см. шапку OrderLayout.module.css): сайдбар, шапка, область прокрутки.
 * Skip-link и `main#main-content` живут здесь. Ниже 1024 px сайдбар
 * открывается кнопкой «Меню» и закрывается переходом, как в ERP.
 */
/*
 * Индикатора черновика визарда здесь больше нет (веха 3): визард v3 и его
 * автосохранение `pinhead_draft` убраны, заказ v4 сохраняется сам и показывает
 * состояние на рабочем месте.
 */

export default function OrderLayout({ user, children }) {
  // «в Производство» — всем с доступом к разделу (веха 8, К1). Помнит ли выбор,
  // решает `switchToProduction`: admin/director — да, продавец/МС/rop — один заход
  const canLeave = canUseSales(user);
  const { theme, toggleTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className={styles.shell}>
      <a href="#main-content" className={appStyles.skipLink}>Перейти к основному содержимому</a>
      <OrderSidebar user={user} open={navOpen} onNavigate={() => setNavOpen(false)} />
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

          {canLeave && (
            <button
              type="button"
              className={styles.prodBtn}
              title="Перейти в раздел Производство"
              aria-label="Перейти в раздел Производство"
              onClick={() => switchToProduction('/', user)}
            >
              <Icon name="board" size={19} />
              {/* На ≤ 480 px подпись только для читалки — кнопка иконкой 44 px */}
              <span className={styles.prodLabel}>Производство</span>
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
            <div className={styles.userRole}>{roleCaption(user)}</div>
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
