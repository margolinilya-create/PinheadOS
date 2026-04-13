// redesign/v2 — floating v2 navigation bar
//
// Intentionally separate from Header.jsx (red-zone file per ADR-0009).
// Mounts only when at least one v2 flag is enabled; each link is
// individually flag-gated.

import { NavLink } from 'react-router-dom';
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';
import s from './v2.module.css';

export default function V2Nav() {
  const techCard = useFeatureFlag('tech_card_builder');
  const workshop = useFeatureFlag('workshop_board');
  const foreman = useFeatureFlag('foreman_screen');
  const payroll = useFeatureFlag('payroll_screen');
  const trash = useFeatureFlag('trash_screen');
  const ordersTable = useFeatureFlag('orders_table_view');

  if (!techCard && !workshop && !foreman && !payroll && !trash && !ordersTable) return null;

  const chipClass = ({ isActive }) => `${s.navChip} ${isActive ? s.navChipActive : ''}`;

  return (
    <div className={s.navBar} data-testid="v2-nav">
      <span className={s.navLabel}>V2</span>
      {ordersTable && <NavLink to="/orders/table" className={chipClass}>Заказы (таблица)</NavLink>}
      {techCard && <NavLink to="/tech-cards" className={chipClass}>Tech Cards</NavLink>}
      {workshop && <NavLink to="/workshop" className={chipClass}>Цех</NavLink>}
      {foreman && <NavLink to="/foreman" className={chipClass}>Мастер</NavLink>}
      {payroll && <NavLink to="/payroll" className={chipClass}>Payroll</NavLink>}
      {trash && <NavLink to="/trash" className={chipClass}>Корзина</NavLink>}
    </div>
  );
}
