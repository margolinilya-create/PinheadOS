// redesign/v2 — Orders page shell
//
// Thin wrapper that adds a "Канбан / Таблица" tab bar above the two
// existing orders views. Director decided in session 13 that Kanban
// stays primary; the table is available as a second tab on the same
// page instead of a separate route in V2Nav.
//
// Does NOT modify KanbanBoard.jsx (red zone for merge conflicts) or
// OrdersTableView.jsx. Instead it wraps each at the route level:
//
//   /orders        → <OrdersPageShell><KanbanBoard /></OrdersPageShell>
//   /orders/table  → <OrdersPageShell><OrdersTableView /></OrdersPageShell>
//
// The tab bar uses NavLink so the browser back button keeps working
// and the active state tracks the actual route.

import { NavLink } from 'react-router-dom';
import s from './v2.module.css';

export default function OrdersPageShell({ children }) {
  const chipClass = ({ isActive }) => `${s.navChip} ${isActive ? s.navChipActive : ''}`;
  return (
    <div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: '12px 24px 0',
          alignItems: 'center',
        }}
      >
        <NavLink to="/orders" end className={chipClass}>
          Канбан
        </NavLink>
        <NavLink to="/orders/table" className={chipClass}>
          Таблица
        </NavLink>
      </div>
      {children}
    </div>
  );
}
