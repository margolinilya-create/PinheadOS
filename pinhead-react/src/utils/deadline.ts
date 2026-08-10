// ═══════════════════════════════════════════
// Deadline helpers — unified across Kanban + Dashboard
// ═══════════════════════════════════════════

import { diffDays, factoryDate, factoryToday } from './date';

export const MS_PER_DAY = 86400000;

export interface DeadlineInfo {
  label: string;
  color: string;
  urgent: boolean;
}

/**
 * Дней до срока — от дня ПРОИЗВОДСТВА, как и `erp/utils/time.daysLeft`.
 * Здесь считалась разность местных полуночей: у человека в другом поясе
 * «сегодня» было своим, и один и тот же заказ подписывался по-разному
 * в Order Studio и в ERP.
 */
function daysUntil(deadline: string | Date): number {
  const dl = typeof deadline === 'string' ? deadline.slice(0, 10) : factoryDate(deadline);
  return diffDays(factoryToday(), dl);
}

/**
 * Full deadline info — used in KanbanBoard.
 * Returns null if no deadline.
 */
export function getDeadlineInfo(deadline: string | Date | null | undefined): DeadlineInfo | null {
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
export function getDeadlineColor(deadline: string | Date): string {
  const diff = daysUntil(deadline);
  if (diff < 0) return '#e53e3e';
  if (diff <= 3) return '#c04500';
  if (diff <= 7) return '#b89000';
  return '#007840';
}

/**
 * Just the label — used in Dashboard.
 */
export function getDeadlineLabel(deadline: string | Date): string {
  const diff = daysUntil(deadline);
  if (diff < 0) return 'ПРОСРОЧЕН';
  return `${diff} дн`;
}
