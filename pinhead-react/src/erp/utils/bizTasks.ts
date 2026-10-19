/**
 * БИЗНЕС-ЗАДАЧИ К ЗАКАЗАМ (правки 19.10, п. 7) — перечни, подписи, таблица
 * переходов и модель: роли участника, доступные действия, просрочка, подсказки
 * описания. Всё здесь обязано совпадать со схемой и с писателями на сервере:
 * кнопка, которой писатель откажет 42501, хуже отсутствующей.
 *
 * Перечни сверяются с CHECK миграции `20261020090000_erp_biz_tasks_schema`
 * сторожем `bizTasksSchema.test.ts`: вид или статус, заведённый в одном месте
 * из двух, даёт 23514 на вставке (в проекте так уже ловились с видами вложений).
 *
 * Таблица переходов — один источник для писателя `erp_biz_task_transition`
 * (матрица пробы строится из неё генератором) и для кнопок карточки.
 */

import type { ErpPermission } from '../permissionKeys';
import type { ErpBizTask, ErpBizTaskKind, ErpBizTaskStatus } from '../types';

export type BizTaskKind = ErpBizTaskKind;
export type BizTaskStatus = ErpBizTaskStatus;

/** Типы задачи — ровно три (Global Constraints плана) */
export const BIZ_TASK_KINDS: readonly BizTaskKind[] = ['delivery', 'purchase', 'other'];

/** Статусы в порядке жизни задачи; первый — статус новой задачи */
export const BIZ_TASK_STATUSES: readonly BizTaskStatus[] = [
  'new', 'in_progress', 'paused', 'review', 'done', 'cancelled',
];

export const BIZ_TASK_KIND_LABELS: Record<BizTaskKind, string> = {
  delivery: 'Доставка',
  purchase: 'Закупка',
  other: 'Другое',
};

/**
 * «Просрочена» сюда не входит: это не статус, а бейдж рядом со статусом
 * (иконка + текст) — задача может быть и «В работе», и просроченной сразу.
 */
export const BIZ_TASK_STATUS_LABELS: Record<BizTaskStatus, string> = {
  new: 'Новая',
  in_progress: 'В работе',
  paused: 'Приостановлена',
  review: 'На проверке',
  done: 'Завершена',
  cancelled: 'Отменена',
};

/** Переходы статуса — ровно девять, по одному на ветку `erp_biz_task_transition` */
export type BizTaskTransitionAction =
  | 'start' | 'pause' | 'resume' | 'submit' | 'complete'
  | 'accept' | 'return' | 'cancel' | 'reopen';

/**
 * Действия карточки помимо переходов — по писателю на каждое:
 * `edit` (название, описание, тип), `change_due`, `assignee`, `watchers` —
 * `erp_biz_task_update`; `checklist` (добавить, переименовать, убрать) и
 * `toggle_item` — `erp_biz_task_checklist_op`; `set_result` —
 * `erp_biz_task_set_result`; `attach` — `erp_biz_task_attach`; `write` —
 * сообщение в тред задачи (`erp_chat_send` с `p_task_id`).
 */
export type BizTaskEditAction =
  | 'edit' | 'change_due' | 'assignee' | 'watchers' | 'checklist'
  | 'toggle_item' | 'set_result' | 'attach' | 'write';

export type BizTaskAction = BizTaskTransitionAction | BizTaskEditAction;

/**
 * Кто вправе: `assignee` — ответственный; `creator` — постановщик или
 * обладатель `biz_task.manage`. Наблюдатель не делает ни одного перехода.
 *
 * Текст: `reason` — причина (приостановка, отмена), `result` — результат
 * (сдача, завершение), `fix` — что исправить или комментарий (возврат,
 * возобновление отменённой); `null` — текст не нужен.
 */
export interface BizTaskTransition {
  from: readonly BizTaskStatus[];
  to: BizTaskStatus;
  who: 'assignee' | 'creator';
  text: 'reason' | 'result' | 'fix' | null;
}

/**
 * Таблица Task 2 плана дословно. `submit` — только у задачи с проверкой
 * постановщиком (`review_required`), `complete` — только без неё; это условие
 * задачи, а не статуса, поэтому живёт у писателя и в модели, не в таблице.
 */
export const BIZ_TASK_TRANSITIONS: Record<BizTaskTransitionAction, BizTaskTransition> = {
  start: { from: ['new'], to: 'in_progress', who: 'assignee', text: null },
  pause: { from: ['in_progress'], to: 'paused', who: 'assignee', text: 'reason' },
  resume: { from: ['paused'], to: 'in_progress', who: 'assignee', text: null },
  submit: { from: ['in_progress'], to: 'review', who: 'assignee', text: 'result' },
  complete: { from: ['in_progress'], to: 'done', who: 'assignee', text: 'result' },
  accept: { from: ['review'], to: 'done', who: 'creator', text: null },
  return: { from: ['review', 'done'], to: 'in_progress', who: 'creator', text: 'fix' },
  cancel: { from: ['new', 'in_progress', 'paused', 'review'], to: 'cancelled', who: 'creator', text: 'reason' },
  reopen: { from: ['cancelled'], to: 'in_progress', who: 'creator', text: 'fix' },
};

/**
 * Право управлять чужими задачами (решение владельца Р2): менять описание,
 * ответственного, срок и участников, отменять и возвращать. Сервер выдаёт его
 * только по должности из `erp_employees`, не по запасной роли профиля.
 */
export function canManageBizTasks(can: (p: ErpPermission) => boolean): boolean {
  return can('biz_task.manage');
}

/** Роль человека в задаче; руководитель (`biz_task.manage`) — не роль, а право */
export type BizTaskRole = 'creator' | 'assignee' | 'watcher';

/** Открытые статусы: по ним «Мне» по умолчанию и счётчик открытых */
export const BIZ_TASK_ACTIVE: readonly BizTaskStatus[] = ['new', 'in_progress', 'paused', 'review'];

/** Закрытая задача: правится только состав наблюдателей (писатель T2) */
const CLOSED: readonly BizTaskStatus[] = ['done', 'cancelled'];

/**
 * Роли человека. Постановщик может быть и ответственным — тогда у него
 * действия обеих ролей. Наблюдателем считается только тот, кто не постановщик
 * и не ответственный: при совпадении ролей участник учитывается один раз.
 */
export function bizTaskRolesOf(
  task: Pick<ErpBizTask, 'creator_id' | 'assignee_id'>,
  userId: string | null,
  watchers: readonly string[],
): BizTaskRole[] {
  if (!userId) return [];
  const roles: BizTaskRole[] = [];
  if (task.creator_id === userId) roles.push('creator');
  if (task.assignee_id === userId) roles.push('assignee');
  if (roles.length === 0 && watchers.includes(userId)) roles.push('watcher');
  return roles;
}

/**
 * Что человек может сделать с задачей — зеркало проверок писателей T2/T3.
 *
 * Переходы: «для ответственного» — только сам ответственный (право управления
 * не делает руководителя исполнителем); «для постановщика» — постановщик или
 * `biz_task.manage`. `submit` есть только у задачи с проверкой постановщиком,
 * `complete` — только без неё. Наблюдатель пишет и прикладывает файлы, но не
 * завершает, не переносит срок и не меняет ответственного.
 */
export function bizTaskActions(
  task: Pick<ErpBizTask, 'status' | 'review_required'>,
  roles: readonly BizTaskRole[],
  canManage: boolean,
): BizTaskAction[] {
  const isAssignee = roles.includes('assignee');
  const lead = canManage || roles.includes('creator');
  const open = !CLOSED.includes(task.status);
  const out: BizTaskAction[] = [];

  for (const [action, t] of Object.entries(BIZ_TASK_TRANSITIONS) as [BizTaskTransitionAction, BizTaskTransition][]) {
    if (!t.from.includes(task.status)) continue;
    if (action === 'submit' && !task.review_required) continue;
    if (action === 'complete' && task.review_required) continue;
    if (t.who === 'assignee' ? isAssignee : lead) out.push(action);
  }
  if (lead && open) out.push('edit', 'change_due', 'assignee', 'checklist');
  if (lead) out.push('watchers');
  if (open && (lead || isAssignee)) out.push('toggle_item');
  if (isAssignee && (task.status === 'in_progress' || task.status === 'review')) out.push('set_result');
  if (lead || roles.length > 0) out.push('attach', 'write');
  return out;
}

/**
 * «Просрочена» — бейдж рядом со статусом, не статус.
 *
 * Открытая задача — срок прошёл. Сданная на проверку и завершённая судятся
 * по времени СДАЧИ (решение спеки: проверка после срока исполнителя не
 * винит), а без сдачи — по времени завершения. Возврат стирает время сдачи
 * на сервере, и задача с истёкшим сроком снова просрочена. Отменённая —
 * никогда: её не учитывают ни успешной, ни проваленной.
 */
export function isOverdue(
  task: Pick<ErpBizTask, 'status' | 'due_at' | 'submitted_at' | 'completed_at'>,
  now: Date,
): boolean {
  const due = Date.parse(task.due_at);
  if (Number.isNaN(due)) return false;
  if (task.status === 'cancelled') return false;
  if (task.status === 'review' || task.status === 'done') {
    const at = task.submitted_at ?? task.completed_at;
    return at !== null && Date.parse(at) > due;
  }
  return due < now.getTime();
}

/** Подсказки описания по типу — не обязательная анкета, а напоминание, о чём написать */
const KIND_HINTS: Record<BizTaskKind, readonly string[]> = {
  delivery: ['Откуда', 'Куда', 'Контакт', 'Груз', 'Время'],
  purchase: ['Материал', 'Количество', 'Единица', 'Поставщик', 'Нужная дата'],
  other: [],
};

export function kindHints(kind: BizTaskKind): string[] {
  return [...KIND_HINTS[kind]];
}

/**
 * Какие задачи грузить списком. `scope` — роль текущего пользователя
 * («Мне», «Поставленные мной», «Наблюдаю») либо все видимые; `statuses` —
 * пусто или не задано означает «любые».
 */
export type BizTaskScope = BizTaskRole | 'all';

export interface BizTaskFilter {
  scope: BizTaskScope;
  statuses?: readonly BizTaskStatus[];
}
