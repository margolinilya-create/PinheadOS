import { WORKSHOP_MAP } from '../data/workshops';
import { MS_PER_DAY } from './format';

/**
 * Assess deadline risk for a single order.
 *
 * @param {object} order  - Order object (must have .id, .data?.deadline)
 * @param {Array}  tasks  - Full flat tasks array from the store
 * @returns {{ level: 'critical'|'warning'|'ok', label: string, color: string, type: 'risk'|'warn'|'ok', message: string }}
 *
 * Return shape covers both previous local implementations:
 *   - CapacityBoard used `type` + `message`
 *   - DirectorView  used `level` + `label` + `color`
 * Both fields are always populated so either consumer can destructure what it needs.
 */
export function assessOrderRisk(order, tasks) {
  if (!order) return null;

  const orderTasks = tasks.filter(t => t.order_id === order.id);

  // Blocked tasks take highest priority
  const blockedTask = orderTasks.find(t => t.status === 'blocked');
  if (blockedTask) {
    const ws = WORKSHOP_MAP[blockedTask.workshop_code];
    const wsName = ws?.name || blockedTask.workshop_code;
    return {
      level: 'critical',
      label: `${wsName} заблокирована`,
      color: 'var(--color-error)',
      type: 'risk',
      message: `Риск: ${wsName} заблокирована`,
    };
  }

  const remaining = orderTasks.filter(t => t.status !== 'done').length;
  const deadline = order.data?.deadline;

  if (deadline) {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const deadlineDate = new Date(deadline);
    const daysLeft = Math.ceil((deadlineDate - now) / MS_PER_DAY);

    if (daysLeft < 0) {
      return {
        level: 'critical',
        label: 'Просрочен',
        color: 'var(--color-error)',
        type: 'risk',
        message: 'Просрочен',
      };
    }

    if (remaining > daysLeft) {
      return {
        level: 'warning',
        label: `${remaining} опер. / ${daysLeft} дн`,
        color: 'var(--color-warning)',
        type: 'warn',
        message: `Может не успеть (${remaining} оп., ${daysLeft} дн.)`,
      };
    }
  }

  if (remaining === 0) {
    return {
      level: 'ok',
      label: 'Завершён',
      color: 'var(--color-success)',
      type: 'ok',
      message: 'На графике',
    };
  }

  return {
    level: 'ok',
    label: 'На графике',
    color: 'var(--color-success)',
    type: 'ok',
    message: 'На графике',
  };
}
