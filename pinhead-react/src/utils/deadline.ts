// ═══════════════════════════════════════════
// Deadline helpers — unified across Kanban + Dashboard
// ═══════════════════════════════════════════

import { diffDays, factoryDate, factoryToday, parseDateLocal } from './date';
import { URGENT_DAYS } from '../erp/utils/time';

/** Срок «скоро»: до недели включительно — жёлтая зона канбана */
export const SOON_DAYS = 7;

export type DeadlineTone = 'overdue' | 'urgent' | 'soon' | 'ok';

export interface DeadlineInfo {
  label: string;
  /** CSS-цвет: токен темы, а не hex (обзор 26.09, п. 17) */
  color: string;
  urgent: boolean;
  tone: DeadlineTone;
}

/**
 * Цвета — ТОКЕНЫ темы, а не литералы: hex-коды здесь не переключались
 * с тёмной темой и дублировали `--color-error`/`--color-warning` из index.css.
 */
const TONE_COLOR: Record<DeadlineTone, string> = {
  overdue: 'var(--color-error)',
  urgent: 'var(--color-warning-ink)',
  soon: 'var(--color-warning)',
  ok: 'var(--text-dim)',
};

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

/** Пороги — те же, что у ERP (`URGENT_DAYS`), а не свои литералы */
export function deadlineTone(deadline: string | Date): DeadlineTone {
  const diff = daysUntil(deadline);
  if (diff < 0) return 'overdue';
  if (diff <= URGENT_DAYS) return 'urgent';
  if (diff <= SOON_DAYS) return 'soon';
  return 'ok';
}

/** Короткая дата срока «14 авг.» — строка без времени читается как местная полночь */
export function formatDeadlineShort(deadline: string | Date): string {
  const dt = typeof deadline === 'string' ? parseDateLocal(deadline) : deadline;
  return dt ? dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }) : '';
}

/**
 * Full deadline info — used in KanbanBoard.
 * Returns null if no deadline.
 */
export function getDeadlineInfo(deadline: string | Date | null | undefined): DeadlineInfo | null {
  if (!deadline) return null;
  const diff = daysUntil(deadline);
  const tone = deadlineTone(deadline);
  const label = tone === 'overdue' ? 'ПРОСРОЧЕН'
    : tone === 'ok' ? formatDeadlineShort(deadline)
      : `${diff} дн`;
  return { label, color: TONE_COLOR[tone], urgent: tone === 'overdue' || tone === 'urgent', tone };
}

/**
 * Just the color — used in Dashboard. Далёкий срок здесь зелёный: точка
 * в списке дедлайнов говорит «в порядке», а не «неважно».
 */
export function getDeadlineColor(deadline: string | Date): string {
  const tone = deadlineTone(deadline);
  return tone === 'ok' ? 'var(--color-success)' : TONE_COLOR[tone];
}

/**
 * Just the label — used in Dashboard.
 */
export function getDeadlineLabel(deadline: string | Date): string {
  const diff = daysUntil(deadline);
  if (diff < 0) return 'ПРОСРОЧЕН';
  return `${diff} дн`;
}
