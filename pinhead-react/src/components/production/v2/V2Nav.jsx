// redesign/v2 — floating v2 navigation bar
//
// Intentionally separate from Header.jsx (red-zone file per ADR-0009).
// Mounts only when at least one v2 flag is enabled; each link is
// individually flag-gated.

import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import { useAuthStore } from '../../../store/useAuthStore';
import { supabase } from '../../../lib/supabase';
import { toast } from '../../../store/useToastStore';
import s from './v2.module.css';

const DEMO_EMAIL = 'demo@pinhead.local';
const DEMO_PASSWORD = 'DemoPass2026!';

// Onboarding toggle — per director UAT feedback, tips should be
// opt-out (hard off) AND replayable. When flipped ON we also clear
// ph_onboarding_done so the tour restarts on next reload.
function readOnboardingEnabled() {
  return localStorage.getItem('ph_onboarding_enabled') !== '0';
}
function writeOnboardingEnabled(next) {
  if (next) {
    localStorage.setItem('ph_onboarding_enabled', '1');
    localStorage.removeItem('ph_onboarding_done');
  } else {
    localStorage.setItem('ph_onboarding_enabled', '0');
  }
}

async function signInAsDemo() {
  const { error } = await supabase.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (error) {
    toast.error(`Login failed: ${error.message}`);
    return;
  }
  // Reload so useAuthStore.init picks up the fresh session.
  window.location.reload();
}

async function signOutDemo() {
  await supabase.auth.signOut();
  window.location.reload();
}

export default function V2Nav() {
  const userId = useAuthStore((st) => st.user?.id);
  const userEmail = useAuthStore((st) => st.user?.email);
  // 'dev' = fake DEV_MODE user → no real Supabase session → RLS blocks reads.
  // Show a one-click "log in as demo" button.
  const isFakeDev = userId === 'dev';

  const [tipsEnabled, setTipsEnabled] = useState(readOnboardingEnabled);
  const toggleTips = () => {
    const next = !tipsEnabled;
    writeOnboardingEnabled(next);
    setTipsEnabled(next);
    if (next) window.location.reload();
  };

  const techCard = useFeatureFlag('tech_card_builder');
  const workshop = useFeatureFlag('workshop_board');
  const foreman = useFeatureFlag('foreman_screen');
  const payroll = useFeatureFlag('payroll_screen');
  const trash = useFeatureFlag('trash_screen');
  const ordersTable = useFeatureFlag('orders_table_view');
  const workersScreen = useFeatureFlag('workers_screen');
  const notificationsScreen = useFeatureFlag('notifications_screen');

  if (!techCard && !workshop && !foreman && !payroll && !trash && !ordersTable && !workersScreen && !notificationsScreen) return null;

  const chipClass = ({ isActive }) => `${s.navChip} ${isActive ? s.navChipActive : ''}`;

  return (
    <div className={s.navBar} data-testid="v2-nav">
      <span className={s.navLabel}>V2</span>
      {ordersTable && <NavLink to="/orders/table" className={chipClass}>Заказы (таблица)</NavLink>}
      {techCard && <NavLink to="/tech-cards" className={chipClass}>Tech Cards</NavLink>}
      {workshop && <NavLink to="/workshop" className={chipClass}>Цех</NavLink>}
      {foreman && <NavLink to="/foreman" className={chipClass}>Мастер</NavLink>}
      {workersScreen && <NavLink to="/workers" className={chipClass}>Работники</NavLink>}
      {payroll && <NavLink to="/payroll" className={chipClass}>Payroll</NavLink>}
      {notificationsScreen && <NavLink to="/notifications" className={chipClass}>Уведомления</NavLink>}
      {trash && <NavLink to="/trash" className={chipClass}>Корзина</NavLink>}

      <span style={{ flex: 1 }} />
      <button
        type="button"
        className={s.navChip}
        onClick={toggleTips}
        title={tipsEnabled ? 'Выключить подсказки интерфейса' : 'Включить подсказки и перезагрузить'}
        aria-pressed={tipsEnabled}
      >
        🎓 Подсказки: {tipsEnabled ? 'вкл' : 'выкл'}
      </button>
      {isFakeDev ? (
        <button
          type="button"
          className={s.navChip}
          onClick={signInAsDemo}
          title="Создать реальную сессию через demo@pinhead.local — нужно для RLS"
        >
          🔐 Войти как demo
        </button>
      ) : userEmail === DEMO_EMAIL ? (
        <button
          type="button"
          className={s.navChip}
          onClick={signOutDemo}
          title="Выйти из demo сессии"
        >
          {userEmail} · выход
        </button>
      ) : null}
    </div>
  );
}
