/**
 * Карточка бизнес-задачи — что показать: подписи кнопок, тексты диалогов
 * действий, строки истории и происхождение файлов. Чистые функции: модель
 * задачи (роли, переходы, просрочка) — в `utils/bizTasks`, здесь только слова.
 */

import { formatDue } from '../../../utils/date';
import { pluralize } from '../../../utils/i18n';
import type { BizTaskTransitionAction } from '../../utils/bizTasks';
import type { ErpBizTaskChecklistItem, ErpBizTaskEvent, ErpOrderAttachment } from '../../types';
import type { BizTaskRow } from '../../store/types';

/** Подписи кнопок переходов; «Вернуть в работу» — и возврат с проверки, и из отменённой */
export const TRANSITION_LABELS: Record<BizTaskTransitionAction, string> = {
  start: 'Взять в работу',
  pause: 'Приостановить',
  resume: 'Возобновить',
  submit: 'Сдать на проверку',
  complete: 'Завершить',
  accept: 'Принять',
  return: 'Вернуть в работу',
  cancel: 'Отменить задачу',
  reopen: 'Вернуть в работу',
};

/** Порядок кнопок: главное действие исполнителя первым, отмена — последней */
export const TRANSITION_ORDER: readonly BizTaskTransitionAction[] = [
  'start', 'resume', 'complete', 'submit', 'accept', 'return', 'reopen', 'pause', 'cancel',
];

/** Переходы без текста — без диалога: одно нажатие, ответ писателя решает */
export const DIRECT_TRANSITIONS: readonly BizTaskTransitionAction[] = ['start', 'resume', 'accept'];

/** Диалог перехода: заголовок, подпись обязательного поля, кнопки */
export interface ActionDialogText {
  title: string;
  field: string;
  confirm: string;
  cancel: string;
}

/**
 * «Момент» по Москве без «до»: «20.10, 18:00». Срезается из `formatDue`
 * («до 20.10, 18:00 МСК»), а не собирается своим `isoToFactoryInput`: новый
 * импорт из `utils/date` в ленивом чанке добавил бы экспорт общему чанку дат,
 * который грузит оболочка ERP, — и сдвинул бы её строгую базу (bundle:budget).
 */
export function formatMoment(iso: string | null | undefined): string {
  const due = iso ? formatDue(iso) : '';
  return due ? due.slice('до '.length, -' МСК'.length) : '';
}

/** Сколько пунктов чек-листа не отмечено — и из скольких */
export function checklistLeft(items: readonly Pick<ErpBizTaskChecklistItem, 'done'>[]) {
  return { left: items.filter((i) => !i.done).length, total: items.length };
}

/**
 * Тексты диалога перехода. Сдача и завершение с невыполненными пунктами
 * чек-листа — предупреждение в заголовке и «Вернуться к чек-листу» вместо
 * «Отмена»: человек видит, сколько не сделано, до того как сдаст результат.
 */
export function actionDialogText(
  action: BizTaskTransitionAction,
  checklist: readonly Pick<ErpBizTaskChecklistItem, 'done'>[],
): ActionDialogText | null {
  const { left, total } = checklistLeft(checklist);
  const warn = left > 0
    ? `Не выполнено ${left} ${pluralize(left, 'пункт', 'пункта', 'пунктов')} чек-листа из ${total}.`
    : '';
  switch (action) {
    case 'pause':
      return { title: 'Приостановить задачу?', field: 'Причина', confirm: 'Приостановить', cancel: 'Отмена' };
    case 'return':
      return { title: 'Вернуть в работу?', field: 'Что исправить', confirm: 'Вернуть в работу', cancel: 'Отмена' };
    case 'reopen':
      return { title: 'Вернуть в работу?', field: 'Комментарий', confirm: 'Вернуть в работу', cancel: 'Отмена' };
    case 'cancel':
      return { title: 'Отменить задачу?', field: 'Причина', confirm: 'Отменить задачу', cancel: 'Не отменять' };
    case 'complete':
      return warn
        ? { title: `${warn} Завершить?`, field: 'Результат', confirm: 'Завершить', cancel: 'Вернуться к чек-листу' }
        : { title: 'Завершить задачу?', field: 'Результат', confirm: 'Завершить', cancel: 'Отмена' };
    case 'submit':
      return warn
        ? { title: `${warn} Сдать на проверку?`, field: 'Результат', confirm: 'Сдать на проверку', cancel: 'Вернуться к чек-листу' }
        : { title: 'Сдать на проверку?', field: 'Результат', confirm: 'Сдать на проверку', cancel: 'Отмена' };
    default:
      return null;
  }
}

type Names = ReadonlyMap<string, string>;

const nameOf = (names: Names, id: unknown) =>
  (typeof id === 'string' && names.get(id)) || '—';

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : '');

const withText = (head: string, label: string, text: unknown) =>
  (str(text) ? `${head}. ${label}: ${str(text)}` : head);

const EDITED_FIELDS: Record<string, string> = { title: 'название', description: 'описание', kind: 'тип' };

function peopleList(names: Names, ids: unknown): string {
  return Array.isArray(ids) ? ids.map((id) => nameOf(names, id)).join(', ') : '';
}

function checklistText(p: Record<string, unknown>): string {
  const item = str(p.text) ? ` «${str(p.text)}»` : '';
  switch (p.op) {
    case 'add': return `Чек-лист: добавлен пункт${item}`;
    case 'remove': return `Чек-лист: убран пункт${item}`;
    case 'rename': return `Чек-лист: пункт переименован${item ? ` в${item}` : ''}`;
    default: return p.done ? `Чек-лист: отмечен пункт${item}` : `Чек-лист: снята отметка${item}`;
  }
}

/**
 * Строка истории. Перенос срока — прежний И новый срок с причиной: история
 * не стирается переносом. Удаление сообщения-результата — отдельной строкой:
 * текст результата остаётся в блоке «Результат».
 */
export function eventText(e: Pick<ErpBizTaskEvent, 'kind' | 'payload'>, names: Names): string {
  const p = e.payload ?? {};
  switch (e.kind) {
    case 'created': return 'Задача создана';
    case 'started': return 'Взята в работу';
    case 'paused': return withText('Приостановлена', 'Причина', p.text);
    case 'resumed': return 'Возобновлена';
    case 'submitted': return withText('Сдана на проверку', 'Результат', p.text);
    case 'accepted': return 'Результат принят';
    case 'returned': return withText('Возвращена в работу', 'Что исправить', p.text);
    case 'completed': return withText('Завершена', 'Результат', p.text);
    case 'cancelled': return withText('Отменена', 'Причина', p.text);
    case 'reopened': return withText('Возвращена в работу', 'Комментарий', p.text);
    case 'assignee_changed':
      return `Ответственный: ${nameOf(names, p.from)} → ${nameOf(names, p.to)}`;
    case 'due_changed':
      return withText(
        `Срок перенесён: ${formatMoment(str(p.from))} → ${formatMoment(str(p.to))} МСК`, 'Причина', p.reason,
      );
    case 'watchers_changed': {
      const parts = [];
      const added = peopleList(names, p.added);
      const removed = peopleList(names, p.removed);
      if (added) parts.push(`добавлены ${added}`);
      if (removed) parts.push(`убраны ${removed}`);
      return `Наблюдатели: ${parts.join('; ') || 'без изменений'}`;
    }
    case 'edited': {
      const fields = Array.isArray(p.fields) ? p.fields.map((f) => EDITED_FIELDS[String(f)] ?? String(f)) : [];
      return fields.length ? `Изменено: ${fields.join(', ')}` : 'Задача изменена';
    }
    case 'result_changed':
      return p.message_deleted
        ? 'Сообщение-результат удалено; текст результата сохранён'
        : withText('Результат изменён', 'Результат', p.to);
    case 'checklist_changed': return checklistText(p);
    case 'due_soon': return 'До срока меньше суток';
    case 'overdue': return 'Срок истёк';
    default: return 'Событие';
  }
}

/** Откуда файл: из диалога (сообщение-результат — «Результат») или из описания */
export function fileOrigin(
  f: Pick<ErpOrderAttachment, 'message_id'>,
  task: Pick<BizTaskRow, 'result_message_id'>,
): 'description' | 'chat' | 'result' {
  if (!f.message_id) return 'description';
  return f.message_id === task.result_message_id ? 'result' : 'chat';
}

export const FILE_ORIGIN_LABELS = { description: 'Описание', chat: 'Обсуждение', result: 'Результат' } as const;
