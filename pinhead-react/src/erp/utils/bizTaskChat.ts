import type { ErpBizTask, ErpChatMessage } from '../types';

/**
 * ДИАЛОГ БИЗНЕС-ЗАДАЧИ — кто пишет, кого зовут, чьё сообщение становится
 * результатом (правки 19.10, п. 7). Зеркало проверок сервера
 * (`erp_chat_send` с `p_task_id`, `erp_biz_task_set_result`): кнопка,
 * которую сервер отвергнет 42501, — обещание, которого интерфейс не держит.
 *
 * Чистые функции без стора: их читают панель чата и карточка задачи.
 */

type TaskPeople = Pick<ErpBizTask, 'creator_id' | 'assignee_id'> & { watchers?: readonly string[] | null };

/** Участники задачи: постановщик, ответственный, наблюдатели — каждый один раз */
export function bizTaskParticipants(task: TaskPeople): string[] {
  const ids = [task.creator_id, task.assignee_id, ...(task.watchers ?? [])];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/**
 * Писать в тред задачи — участник или `biz_task.manage` (Р1: читать может
 * любой участник раздела, писать — нет). `canManage` — `canManageBizTasks(...)`
 * у вызывающего: право без карточки сотрудника сервер не признаёт.
 */
export function canWriteBizTaskChat(
  task: TaskPeople, userId: string | null, canManage: boolean,
): boolean {
  if (!userId) return false;
  return canManage || bizTaskParticipants(task).includes(userId);
}

/** Статусы, в которых ответственный фиксирует результат (`erp_biz_task_set_result`) */
const RESULT_STATUSES: readonly ErpBizTask['status'][] = ['in_progress', 'review'];

/**
 * «Отметить как результат» — своё живое сообщение ответственного, пока задача
 * в работе или на проверке. Чужое сообщение результатом не становится:
 * ответственный отвечает за результат своими словами.
 */
export function canMarkAsResult(
  task: Pick<ErpBizTask, 'assignee_id' | 'status' | 'result_message_id'>,
  message: Pick<ErpChatMessage, 'id' | 'author_id' | 'deleted_at'>,
  userId: string | null,
): boolean {
  if (!userId || task.assignee_id !== userId || message.author_id !== userId) return false;
  if (message.deleted_at || task.result_message_id === message.id) return false;
  return RESULT_STATUSES.includes(task.status);
}
