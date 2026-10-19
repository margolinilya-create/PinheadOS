import { useCallback } from 'react';
import { useErpStore } from '../store/useErpStore';
import { confirm } from '../../store/useConfirmStore';
import { BIZ_TASK_ACTIVE, BIZ_TASK_STATUS_LABELS } from '../utils/bizTasks';

/**
 * ВОПРОС ПЕРЕД ОТГРУЗКОЙ — С ОТКРЫТЫМИ БИЗНЕС-ЗАДАЧАМИ (правки 19.10, п. 7,
 * «Завершение заказа»): «при закрытии заказа предупредить об открытых
 * бизнес-задачах и показать их список. Закрытие заказа не завершает задачи
 * автоматически… По умолчанию бизнес-задача не блокирует закрытие заказа».
 *
 * Поэтому здесь только ВОПРОС: «Отгрузить» отгрузку продолжает, «Не
 * отгружать» её отменяет, задачи не трогаются ни в одном исходе. Сбой чтения
 * задач отгрузку тоже не блокирует — вопрос задаётся прежний.
 *
 * Вынесено из `OrdersScreen.jsx` (ратчет размера 793/793): тот же вопрос
 * задаёт и карточка склада «Упаковка и отгрузка».
 */

/** Сколько задач назвать поимённо; остальные — честным «и ещё N» */
const SHOWN = 10;

/**
 * Параметры диалога при открытых задачах. Список — строками: диалог
 * подтверждения показывает текст с переносами (`white-space: pre-line`).
 */
export function shipConfirmOptions(order, openTasks, message) {
  const lines = openTasks.slice(0, SHOWN)
    .map((t) => `• «${t.title}» — ${BIZ_TASK_STATUS_LABELS[t.status] ?? t.status}`);
  if (openTasks.length > SHOWN) lines.push(`и ещё ${openTasks.length - SHOWN}`);
  return {
    title: `Отгрузить заказ «${order.title}»?`,
    message: [
      `Открытые бизнес-задачи: ${openTasks.length}`,
      ...lines,
      'Отгрузка их не завершает и не отменяет.',
      ...(message ? [message] : []),
    ].join('\n'),
    confirmLabel: 'Отгрузить',
    cancelLabel: 'Не отгружать',
  };
}

/**
 * `ask(order, { message, onlyIfTasks })` → `true`, если отгружать.
 * `message` — прежний текст вопроса; `onlyIfTasks` — без открытых задач
 * не спрашивать вовсе (карточка склада отгружала без вопроса и так).
 */
export function useShipConfirm() {
  const loadOrderBizTasks = useErpStore((s) => s.loadOrderBizTasks);
  return useCallback(async (order, { message, onlyIfTasks = false } = {}) => {
    const rows = await loadOrderBizTasks(order.id);
    const open = (rows ?? []).filter((t) => BIZ_TASK_ACTIVE.includes(t.status));
    if (open.length > 0) return confirm(shipConfirmOptions(order, open, message));
    if (onlyIfTasks) return true;
    return confirm({ title: `Отгрузить заказ «${order.title}»?`, message, confirmLabel: 'Отгрузить' });
  }, [loadOrderBizTasks]);
}
