/**
 * Мок бизнес-задач (правки 19.10, п. 7) — диалог задачи и её строки для e2e.
 *
 * Контракт — миграция `20261020100000_erp_biz_tasks_rpc`:
 *   · тред задачи — ОТДЕЛЬНАЯ лента (`erp_chat_page`/`erp_chat_send`
 *     с `p_task_id`), в переписку сделки (`chatState` в `mockSupabase.ts`)
 *     не попадает; сообщение задачи с `p_order_id` — отказ 22023, как у сервера;
 *   · повтор отправки с тем же `p_client_key` — то же сообщение, `duplicate: true`;
 *   · писать — участник задачи (постановщик, ответственный, наблюдатель), иначе 42501;
 *   · `erp_chat_unread_tasks` только считает; `erp_biz_task_set_result` —
 *     только ответственный, своё живое сообщение, в работе или на проверке.
 *
 * Ответ писателя — строка `erp_biz_tasks` ЦЕЛИКОМ: стор кладёт её как есть,
 * и огрызок стёр бы поля задачи (тот же урок, что `createdTasks` в моке).
 *
 * Возвращает `undefined`, если вызов не его: тогда отвечает общий мок.
 */
import { RpcFailure } from './orderV4Rpc';

/** Вызывающий в e2e — dev-автологин; участник фикстурной задачи */
const ME = 'dev-user';
const OTHER = 'u-maria';
const AT = '2026-07-20T09:00:00Z';

/** Тексты сервера — побуквенно как в миграции */
export const BIZ_TASK_TEXTS = {
  dealAnchor: 'erp_chat_send: сообщение задачи не адресуется сделке или разработке',
  writeRights: 'erp_chat_send: писать могут участники задачи',
  resultRights: 'Результат фиксирует ответственный',
  resultStatus: 'Результат фиксируется в работе или на проверке',
  resultMessage: 'Результатом отмечается своё сообщение из обсуждения этой задачи',
  notFound: 'Задача не найдена',
} as const;

interface TaskMsg {
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: string;
  client_key: string | null;
  deleted_at: string | null;
  [key: string]: unknown;
}

type TaskRow = Record<string, unknown> & {
  id: string; order_id: string; creator_id: string; assignee_id: string; status: string;
};

/** Фикстура: задача заказа `ord-a`, ответственный — вызывающий, в работе */
function seedTasks(): Map<string, TaskRow> {
  const row: TaskRow = {
    id: 'bt-1', order_id: 'ord-a', title: 'Заказать молнии', kind: 'purchase',
    description: 'Молнии 20 см, 120 шт.', assignee_id: ME, creator_id: OTHER,
    due_at: '2026-07-22T15:00:00Z', status: 'in_progress', review_required: false,
    pause_reason: null, cancel_reason: null, return_reason: null,
    result_text: null, result_message_id: null, submitted_at: null, reviewed_at: null,
    completed_at: null, cancelled_at: null, client_key: 'bt-1-key',
    created_at: AT, updated_at: AT,
  };
  return new Map([[row.id, row]]);
}

const state = {
  tasks: seedTasks(),
  watchers: new Map<string, string[]>([['bt-1', []]]),
  threads: new Map<string, TaskMsg[]>(),
};

export function resetBizTasksMock(): void {
  state.tasks = seedTasks();
  state.watchers = new Map([['bt-1', []]]);
  state.threads = new Map([['bt-1', [{
    id: 'bt-1-msg-1', thread_id: 'thr-task-bt-1', author_id: OTHER,
    body: 'Уточни срок у поставщика', created_at: AT, client_key: null, deleted_at: null,
  }]]]);
}
resetBizTasksMock();

const isParticipant = (task: TaskRow, user: string) => task.creator_id === user
  || task.assignee_id === user || (state.watchers.get(task.id) ?? []).includes(user);

/** Сообщение в форме `erp_chat_page` */
function pageRow(m: TaskMsg) {
  return {
    item_id: null, stage_id: null, experimental_id: null, reply_to: null, reply: null,
    edited_at: null, mentions: [], attachments: [], read_count: 0, reactions: [],
    ...m,
  };
}

export function bizTasksRpc(fn: string, body: Record<string, unknown>): unknown {
  const taskId = typeof body.p_task_id === 'string' ? body.p_task_id : null;
  switch (fn) {
    case 'erp_chat_page': {
      if (!taskId) return undefined;
      return { messages: (state.threads.get(taskId) ?? []).map(pageRow), has_more: false };
    }
    case 'erp_chat_send': {
      if (!taskId) return undefined;
      if (body.p_order_id != null || body.p_experimental_id != null) {
        return new RpcFailure('22023', BIZ_TASK_TEXTS.dealAnchor);
      }
      const task = state.tasks.get(taskId);
      if (!task) return new RpcFailure('P0002', 'erp_chat_send: задача не найдена');
      if (!isParticipant(task, ME)) return new RpcFailure('42501', BIZ_TASK_TEXTS.writeRights);
      const thread = state.threads.get(taskId) ?? [];
      const key = String(body.p_client_key ?? '');
      const known = thread.find((m) => m.client_key === key);
      if (known) {
        return { message_id: known.id, thread_id: known.thread_id, duplicate: true, mentioned: [] };
      }
      const msg: TaskMsg = {
        id: `${taskId}-msg-${thread.length + 1}`, thread_id: `thr-task-${taskId}`, author_id: ME,
        body: String(body.p_body ?? ''), created_at: '2026-07-20T09:05:00Z',
        client_key: key, deleted_at: null,
      };
      state.threads.set(taskId, [...thread, msg]);
      return { message_id: msg.id, thread_id: msg.thread_id, duplicate: false, mentioned: [] };
    }
    case 'erp_chat_unread_tasks':
      // Только счёт: в фикстуре всё прочитано, отметок этот вызов не ставит
      return [];
    case 'erp_biz_task_set_result': {
      const task = state.tasks.get(String(body.p_id ?? ''));
      if (!task) return new RpcFailure('P0002', BIZ_TASK_TEXTS.notFound);
      if (task.assignee_id !== ME) return new RpcFailure('42501', BIZ_TASK_TEXTS.resultRights);
      if (!['in_progress', 'review'].includes(task.status)) {
        return new RpcFailure('22023', BIZ_TASK_TEXTS.resultStatus);
      }
      const messageId = typeof body.p_message_id === 'string' ? body.p_message_id : null;
      const msg = messageId
        ? (state.threads.get(task.id) ?? []).find((m) => m.id === messageId && m.author_id === ME && !m.deleted_at)
        : null;
      if (messageId && !msg) return new RpcFailure('22023', BIZ_TASK_TEXTS.resultMessage);
      const next: TaskRow = {
        ...task,
        result_text: (typeof body.p_text === 'string' && body.p_text.trim()) || msg?.body || task.result_text,
        result_message_id: messageId,
        updated_at: '2026-07-20T09:06:00Z',
      };
      state.tasks.set(task.id, next);
      return { ...next };
    }
    default:
      return undefined;
  }
}

/**
 * Строки таблиц задачи — для экранов, читающих `erp_biz_tasks` select-ом
 * (наблюдатели и заказ — вложенными выборками, как у `BIZ_TASK_SELECT`).
 */
export function bizTasksTable(table: string, params: URLSearchParams): unknown[] | undefined {
  if (table === 'erp_biz_tasks') {
    const id = params.get('id');
    const order = params.get('order_id');
    return [...state.tasks.values()]
      .filter((t) => !id?.startsWith('eq.') || t.id === id.slice(3))
      .filter((t) => !order?.startsWith('eq.') || t.order_id === order.slice(3))
      .map((t) => ({
        ...t,
        watchers: (state.watchers.get(t.id) ?? []).map((user_id) => ({ user_id })),
        order: { id: t.order_id, bitrix_id: null, title: t.order_id },
      }));
  }
  if (['erp_biz_task_watchers', 'erp_biz_task_checklist', 'erp_biz_task_events'].includes(table)) return [];
  return undefined;
}
