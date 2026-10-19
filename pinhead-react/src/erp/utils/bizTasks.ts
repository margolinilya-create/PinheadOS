/**
 * БИЗНЕС-ЗАДАЧИ К ЗАКАЗАМ (правки 19.10, п. 7) — перечни, подписи и таблица
 * переходов. Модель (роли, доступные действия, просрочка) — следующий шаг;
 * здесь только то, что обязано совпадать со схемой и с писателями на сервере.
 *
 * Перечни сверяются с CHECK миграции `20261020090000_erp_biz_tasks_schema`
 * сторожем `bizTasksSchema.test.ts`: вид или статус, заведённый в одном месте
 * из двух, даёт 23514 на вставке (в проекте так уже ловились с видами вложений).
 *
 * Таблица переходов — один источник для писателя `erp_biz_task_transition`
 * (матрица пробы строится из неё генератором) и для кнопок карточки.
 */

import type { ErpPermission } from '../permissionKeys';
import type { ErpBizTaskKind, ErpBizTaskStatus } from '../types';

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

export type BizTaskAction =
  | 'start' | 'pause' | 'resume' | 'submit' | 'complete'
  | 'accept' | 'return' | 'cancel' | 'reopen';

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
export const BIZ_TASK_TRANSITIONS: Record<BizTaskAction, BizTaskTransition> = {
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
