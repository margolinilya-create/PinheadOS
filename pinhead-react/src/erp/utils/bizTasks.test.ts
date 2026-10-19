import { describe, expect, it } from 'vitest';
import {
  BIZ_TASK_TRANSITIONS,
  bizTaskActions,
  bizTaskRolesOf,
  canManageBizTasks,
  isBizTaskStaff,
  isOverdue,
  kindHints,
} from './bizTasks';
import type { ErpBizTask } from '../types';

/**
 * Модель бизнес-задачи (правки 19.10, п. 7): кто кем является, какие кнопки
 * видит и когда задача «Просрочена». Кнопки — зеркало писателей T2: кнопка,
 * которой сервер откажет 42501, хуже отсутствующей.
 */

const T = (over: Partial<ErpBizTask> = {}): ErpBizTask => ({
  id: 't1',
  order_id: 'o1',
  title: 'Заказать молнии',
  kind: 'purchase',
  description: null,
  assignee_id: 'u-assignee',
  creator_id: 'u-creator',
  due_at: '2026-10-20T15:00:00.000Z',
  status: 'in_progress',
  review_required: false,
  pause_reason: null,
  cancel_reason: null,
  return_reason: null,
  result_text: null,
  result_message_id: null,
  submitted_at: null,
  reviewed_at: null,
  completed_at: null,
  cancelled_at: null,
  client_key: null,
  created_at: '2026-10-19T09:00:00.000Z',
  updated_at: '2026-10-19T09:00:00.000Z',
  ...over,
});

const BEFORE_DUE = new Date('2026-10-20T14:00:00.000Z');
const AFTER_DUE = new Date('2026-10-20T16:00:00.000Z');

describe('роли участника', () => {
  it('постановщик, ответственный и наблюдатель различаются', () => {
    const task = T();
    expect(bizTaskRolesOf(task, 'u-creator', [])).toEqual(['creator']);
    expect(bizTaskRolesOf(task, 'u-assignee', [])).toEqual(['assignee']);
    expect(bizTaskRolesOf(task, 'u-w', ['u-w'])).toEqual(['watcher']);
    expect(bizTaskRolesOf(task, 'u-stranger', ['u-w'])).toEqual([]);
    expect(bizTaskRolesOf(task, null, ['u-w'])).toEqual([]);
  });

  it('совпадение ролей — человек учитывается один раз, наблюдатель не дублирует', () => {
    const task = T({ creator_id: 'u1', assignee_id: 'u1' });
    expect(bizTaskRolesOf(task, 'u1', ['u1'])).toEqual(['creator', 'assignee']);
  });
});

describe('доступные действия', () => {
  it('наблюдатель не получает complete/change_due/assignee', () => {
    const task = T();
    const acts = bizTaskActions(task, ['watcher'], false, true);
    expect(acts).not.toContain('complete');
    expect(acts).not.toContain('change_due');
    expect(acts).not.toContain('assignee');
    expect(acts).not.toContain('cancel');
    // Наблюдатель участвует в обсуждении и прикладывает файлы
    expect(acts).toEqual(expect.arrayContaining(['write', 'attach']));
  });

  it('посторонний без права управления — ничего, даже писать в тред', () => {
    expect(bizTaskActions(T(), [], false, true)).toEqual([]);
  });

  it('постановщик-он-же-ответственный — действия обеих ролей', () => {
    const task = T({ creator_id: 'u1', assignee_id: 'u1' });
    const acts = bizTaskActions(task, bizTaskRolesOf(task, 'u1', []), false, true);
    expect(acts).toEqual(expect.arrayContaining([
      'complete', 'pause', 'set_result', 'toggle_item', // ответственный
      'cancel', 'change_due', 'assignee', 'edit', 'watchers', 'checklist', // постановщик
    ]));
  });

  it('ответственный в «Новая» — «Взять в работу», без завершения', () => {
    const acts = bizTaskActions(T({ status: 'new' }), ['assignee'], false, true);
    expect(acts).toContain('start');
    expect(acts).not.toContain('complete');
    expect(acts).not.toContain('change_due');
  });

  it('review_required: complete заменён submit', () => {
    const acts = bizTaskActions(T({ review_required: true }), ['assignee'], false, true);
    expect(acts).toContain('submit');
    expect(acts).not.toContain('complete');
    const plain = bizTaskActions(T({ review_required: false }), ['assignee'], false, true);
    expect(plain).toContain('complete');
    expect(plain).not.toContain('submit');
  });

  it('на проверке у постановщика — «Принять» и «Вернуть в работу»', () => {
    const acts = bizTaskActions(T({ status: 'review', review_required: true }), ['creator'], false, true);
    expect(acts).toEqual(expect.arrayContaining(['accept', 'return', 'cancel']));
    expect(acts).not.toContain('submit');
  });

  it('право управления даёт действия постановщика, но не ответственного', () => {
    const acts = bizTaskActions(T(), [], true, true);
    expect(acts).toEqual(expect.arrayContaining(['cancel', 'change_due', 'assignee', 'write']));
    expect(acts).not.toContain('complete');
    expect(acts).not.toContain('set_result');
  });

  it('завершённая: правка только наблюдателей, возврат — постановщику', () => {
    const acts = bizTaskActions(T({ status: 'done' }), ['creator'], false, true);
    expect(acts).toContain('return');
    expect(acts).toContain('watchers');
    expect(acts).not.toContain('change_due');
    expect(acts).not.toContain('checklist');
    expect(acts).not.toContain('cancel');
  });

  it('отменённая — «Возобновить» постановщику', () => {
    expect(bizTaskActions(T({ status: 'cancelled' }), ['creator'], false, true)).toContain('reopen');
  });

  it('BIZ_TASK_TRANSITIONS — 9 действий', () => {
    expect(Object.keys(BIZ_TASK_TRANSITIONS).sort()).toEqual([
      'accept', 'cancel', 'complete', 'pause', 'reopen', 'resume', 'return', 'start', 'submit',
    ]);
  });
});

describe('просрочка', () => {
  it('открытая задача после срока — да, до срока — нет', () => {
    for (const status of ['new', 'in_progress', 'paused'] as const) {
      expect(isOverdue(T({ status }), AFTER_DUE), status).toBe(true);
      expect(isOverdue(T({ status }), BEFORE_DUE), status).toBe(false);
    }
  });

  it('isOverdue: сдано до срока, проверено после — нет', () => {
    const review = T({ status: 'review', review_required: true, submitted_at: '2026-10-20T14:30:00.000Z' });
    expect(isOverdue(review, AFTER_DUE)).toBe(false);
    const done = T({
      status: 'done',
      review_required: true,
      submitted_at: '2026-10-20T14:30:00.000Z',
      reviewed_at: '2026-10-21T10:00:00.000Z',
      completed_at: '2026-10-21T10:00:00.000Z',
    });
    expect(isOverdue(done, AFTER_DUE)).toBe(false);
  });

  it('сдано или завершено после срока — да', () => {
    expect(isOverdue(T({ status: 'review', submitted_at: '2026-10-20T15:30:00.000Z' }), AFTER_DUE)).toBe(true);
    expect(isOverdue(T({ status: 'done', completed_at: '2026-10-20T15:30:00.000Z' }), AFTER_DUE)).toBe(true);
  });

  it('isOverdue: возврат после срока — да', () => {
    // Возврат стирает время сдачи (писатель T2): задача снова в работе и снова просрочена
    const returned = T({ status: 'in_progress', submitted_at: null, return_reason: 'Не тот поставщик' });
    expect(isOverdue(returned, AFTER_DUE)).toBe(true);
  });

  it('отменённая не бывает просроченной', () => {
    expect(isOverdue(T({ status: 'cancelled' }), AFTER_DUE)).toBe(false);
  });
});

describe('подсказки описания и право управления', () => {
  it('подсказки зависят от типа', () => {
    expect(kindHints('delivery')).toEqual(['Откуда', 'Куда', 'Контакт', 'Груз', 'Время']);
    expect(kindHints('purchase')).toEqual(['Материал', 'Количество', 'Единица', 'Поставщик', 'Нужная дата']);
    expect(kindHints('other')).toEqual([]);
  });

  it('право управления — biz_task.manage И сотрудник ERP', () => {
    expect(canManageBizTasks((p) => p === 'biz_task.manage', true)).toBe(true);
    expect(canManageBizTasks((p) => p === 'order.manage', true)).toBe(false);
    // Продавец без карточки: запасная роль manager несёт право, сервер — нет
    expect(canManageBizTasks((p) => p === 'biz_task.manage', false)).toBe(false);
  });

  it('сотрудник ERP — активная карточка или admin/director профиля', () => {
    expect(isBizTaskStaff('manager', null)).toBe(false);
    expect(isBizTaskStaff('manager', 'manager')).toBe(true);
    expect(isBizTaskStaff('production', 'worker')).toBe(true);
    expect(isBizTaskStaff('admin', null)).toBe(true);
    expect(isBizTaskStaff('director', null)).toBe(true);
    expect(isBizTaskStaff('rop', null)).toBe(false);
    expect(isBizTaskStaff(null, null)).toBe(false);
  });

  it('профиль manager без карточки — ни одного действия', () => {
    const can = (p: string) => p === 'biz_task.manage';
    const staff = isBizTaskStaff('manager', null);
    const manage = canManageBizTasks(can, staff);
    for (const status of ['new', 'in_progress', 'paused', 'review', 'done', 'cancelled'] as const) {
      // Ни чужая задача, ни своя роль в ней: ворота писателя отказывают 42501
      expect(bizTaskActions(T({ status }), [], manage, staff)).toEqual([]);
      expect(bizTaskActions(T({ status }), ['creator', 'assignee'], true, staff)).toEqual([]);
      expect(bizTaskActions(T({ status }), ['watcher'], manage, staff)).toEqual([]);
    }
  });
});
