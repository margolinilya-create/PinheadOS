// redesign/v2 — floating v2 navigation bar
//
// Intentionally separate from Header.jsx (red-zone file per ADR-0009).
// Mounts only when at least one v2 flag is enabled; each link is
// individually flag-gated. Positioned under the main header as a
// horizontal chip row so it survives the main → v2 weekly sync merges
// without conflicting with header.

import { NavLink } from 'react-router-dom';
import { useFeatureFlag } from '../../../hooks/useFeatureFlag';

export default function V2Nav() {
  const techCard = useFeatureFlag('tech_card_builder');
  const workshop = useFeatureFlag('workshop_board');
  const foreman = useFeatureFlag('foreman_screen');
  const payroll = useFeatureFlag('payroll_screen');

  if (!techCard && !workshop && !foreman && !payroll) return null;

  const chipStyle = ({ isActive }) => ({
    padding: '6px 12px',
    borderRadius: 'var(--radius-md, 6px)',
    background: isActive ? 'var(--color-accent, #0ea5e9)' : 'var(--color-surface, #f1f5f9)',
    color: isActive ? 'white' : 'inherit',
    textDecoration: 'none',
    fontSize: '0.85em',
    fontWeight: 600,
    transition: 'background 0.15s',
  });

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        padding: '8px 16px',
        borderBottom: '1px solid var(--color-border-subtle, #e2e8f0)',
        background: 'var(--color-bg-subtle, #f8fafc)',
        alignItems: 'center',
        flexWrap: 'wrap',
      }}
      data-testid="v2-nav"
    >
      <span style={{ fontSize: '0.7em', opacity: 0.5, fontWeight: 700, letterSpacing: 0.5, marginRight: 4 }}>
        V2
      </span>
      {techCard && <NavLink to="/tech-cards" style={chipStyle}>Tech Cards</NavLink>}
      {workshop && <NavLink to="/workshop" style={chipStyle}>Цех</NavLink>}
      {foreman && <NavLink to="/foreman" style={chipStyle}>Мастер</NavLink>}
      {payroll && <NavLink to="/payroll" style={chipStyle}>Payroll</NavLink>}
    </div>
  );
}
