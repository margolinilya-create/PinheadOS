// ═══════════════════════════════════════════
// Deadline helpers — unified across Kanban + Dashboard
// ═══════════════════════════════════════════

export const MS_PER_DAY = 86400000;

function daysUntil(deadline) {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dl = new Date(deadline);
  dl.setHours(0, 0, 0, 0);
  return Math.ceil((dl - now) / MS_PER_DAY);
}

/**
 * Full deadline info — used in KanbanBoard.
 * Returns null if no deadline.
 */
export function getDeadlineInfo(deadline) {
  if (!deadline) return null;
  const diff = daysUntil(deadline);
  if (diff < 0) return { label: 'ПРОСРОЧЕН', color: '#e53e3e', urgent: true };
  if (diff <= 3) return { label: `${diff} дн`, color: '#c04500', urgent: true };
  if (diff <= 7) return { label: `${diff} дн`, color: '#b89000', urgent: false };
  return {
    label: new Date(deadline).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }),
    color: '#888',
    urgent: false,
  };
}

/**
 * Just the color — used in Dashboard.
 */
export function getDeadlineColor(deadline) {
  const diff = daysUntil(deadline);
  if (diff < 0) return '#e53e3e';
  if (diff <= 3) return '#c04500';
  if (diff <= 7) return '#b89000';
  return '#007840';
}

/**
 * Just the label — used in Dashboard.
 */
export function getDeadlineLabel(deadline) {
  const diff = daysUntil(deadline);
  if (diff < 0) return 'ПРОСРОЧЕН';
  return `${diff} дн`;
}
