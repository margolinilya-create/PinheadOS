import { describe, expect, it } from 'vitest';
import {
  currentBlocker,
  devOverdue,
  devReadiness,
  devState,
  isDelegated,
  isTaskReady,
  nextAction,
  taskGroup,
  taskLabel,
  taskWaitingReason,
} from './experimentalTasks';
import type { ErpExperimental, ErpExperimentalTask } from '../types';

/**
 * Примеры взяты прямо из ТЗ заказчика 12.08 — это и есть проверка того,
 * что модель отвечает документу, а не наоборот.
 */

const TODAY = '2026-08-12';
const NOW = new Date('2026-08-12T10:00:00');

function task(over: Partial<ErpExperimentalTask> = {}): ErpExperimentalTask {
  return {
    id: 't1', experimental_id: 'e1', task_type: 'patterns', title: null,
    responsible: null, due_date: null, status: 'todo', blocked_reason: null,
    depends_on: [], cycle: 0, sort_order: 10, qty: null, comment: null,
    result: null, department_id: null, stage_id: null, done_on: null,
    created_at: '', updated_at: '', ...over,
  };
}

/**
 * Разработка в объёме, который читает логика. Именно так, а не
 * `Partial<ErpExperimental>`: у таблицы есть колонка `constructor`, и в частичном
 * типе она сталкивается с `Object.prototype.constructor` — TS отказывается
 * принимать любой объектный литерал. Узкий тип честнее и заодно показывает,
 * от чего функции на самом деле зависят.
 */
type DevInput = {
  outcome?: ErpExperimental['outcome'];
  due_date?: string | null;
  order?: { due_date?: string | null } | null;
};

const dev = (over: DevInput = {}): DevInput =>
  ({ outcome: null, due_date: null, ...over });

const TYPES = new Map([
  ['patterns', 'Лекала'], ['material', 'Подбор материала'],
  ['sample', 'Проработка образца'], ['fitting', 'Примерка'], ['dtf', 'ДТФ'],
]);

describe('готовность задачи к запуску', () => {
  it('без зависимостей готова сразу — параллельные задачи из примера 1', () => {
    // «Тогда одновременно: Лекала — в работе, Материал — в работе»
    const patterns = task({ id: 'a', task_type: 'patterns' });
    const material = task({ id: 'b', task_type: 'material' });
    const all = [patterns, material];
    expect(isTaskReady(patterns, all)).toBe(true);
    expect(isTaskReady(material, all)).toBe(true);
  });

  it('ждёт незакрытую зависимость — проработка после лекал', () => {
    // ТЗ п.13: «Проработка образца может начать работу после того,
    // как готовы необходимые лекала»
    const patterns = task({ id: 'a' });
    const sample = task({ id: 'b', task_type: 'sample', depends_on: ['a'] });
    expect(isTaskReady(sample, [patterns, sample])).toBe(false);
    patterns.status = 'done';
    expect(isTaskReady(sample, [patterns, sample])).toBe(true);
  });

  it('ОТМЕНЁННАЯ зависимость не держит', () => {
    // Подбор материала не потребовался (пример 2) — проработка обязана пойти
    const material = task({ id: 'a', status: 'cancelled' });
    const sample = task({ id: 'b', depends_on: ['a'] });
    expect(isTaskReady(sample, [material, sample])).toBe(true);
  });

  it('несуществующая зависимость не держит — fail-open, как в маршруте', () => {
    // Ссылка в никуда закрыла бы задачу навсегда; лишний запуск дешевле
    expect(isTaskReady(task({ depends_on: ['нет-такой'] }), [])).toBe(true);
  });

  it('ромб зависимостей: ждёт обе ветки', () => {
    const a = task({ id: 'a', status: 'done' });
    const b = task({ id: 'b', depends_on: ['a'] });
    const c = task({ id: 'c', depends_on: ['a'], status: 'done' });
    const d = task({ id: 'd', depends_on: ['b', 'c'] });
    const all = [a, b, c, d];
    expect(isTaskReady(d, all)).toBe(false);
    b.status = 'done';
    expect(isTaskReady(d, all)).toBe(true);
  });
});

describe('группа задачи', () => {
  it('закрытые и отменённые — свои группы', () => {
    expect(taskGroup(task({ status: 'done' }), [])).toBe('done');
    expect(taskGroup(task({ status: 'cancelled' }), [])).toBe('cancelled');
  });

  it('блокировка перебивает всё', () => {
    expect(taskGroup(task({ status: 'blocked' }), [])).toBe('blocked');
  });

  it('переданная в цех ждёт цех, а не зависимости', () => {
    // Предлагать «начать» здесь нельзя: работу делает цех
    const t = task({ status: 'waiting', stage_id: 'st1' });
    expect(taskGroup(t, [t])).toBe('waiting');
  });

  it('не начатая без зависимостей — готова', () => {
    const t = task({ status: 'todo' });
    expect(taskGroup(t, [t])).toBe('ready');
  });
});

describe('готовность разработки', () => {
  it('«3 / 5 задач» из карточки ТЗ', () => {
    const tasks = [
      task({ id: '1', status: 'done' }), task({ id: '2', status: 'done' }),
      task({ id: '3', status: 'done' }), task({ id: '4', status: 'in_progress' }),
      task({ id: '5', status: 'todo' }),
    ];
    expect(devReadiness(tasks)).toEqual({ done: 3, total: 5, pct: 60 });
  });

  it('отменённые в знаменатель не входят — они не работа', () => {
    const tasks = [
      task({ id: '1', status: 'done' }),
      task({ id: '2', status: 'cancelled' }),
    ];
    expect(devReadiness(tasks)).toEqual({ done: 1, total: 1, pct: 100 });
  });

  it('ноль задач — «неизвестно», а не «готово»', () => {
    // Правило проекта: ноль в знаменателе даёт null, интерфейс рисует «—».
    // 100 % на пустой разработке означало бы «всё сделано» на пустом месте
    expect(devReadiness([])).toEqual({ done: 0, total: 0, pct: null });
  });
});

describe('текущий блокер и следующее действие', () => {
  it('блокировка важнее просрочки и работы', () => {
    const tasks = [
      task({ id: 'a', status: 'in_progress' }),
      task({ id: 'b', status: 'blocked', blocked_reason: 'Нет ткани' }),
      task({ id: 'c', status: 'todo', due_date: '2026-08-01' }),
    ];
    expect(currentBlocker(tasks, TYPES, TODAY)?.id).toBe('b');
    expect(nextAction(dev(), tasks, TYPES, TODAY)).toBe('снять блокировку: Нет ткани');
  });

  it('просроченная задача важнее идущей по плану', () => {
    const tasks = [
      task({ id: 'a', status: 'in_progress' }),
      task({ id: 'b', status: 'todo', due_date: '2026-08-01', task_type: 'sample' }),
    ];
    expect(currentBlocker(tasks, TYPES, TODAY)?.id).toBe('b');
  });

  it('идущая задача — «завершить …»', () => {
    // Пример из карточки ТЗ: «Следующее действие: завершить пошив образца»
    const tasks = [task({ id: 'a', status: 'in_progress', task_type: 'sample' })];
    expect(nextAction(dev(), tasks, TYPES, TODAY)).toBe('завершить проработка образца');
  });

  it('готовая к запуску — «начать …»', () => {
    const tasks = [task({ id: 'a', status: 'todo', task_type: 'patterns' })];
    expect(nextAction(dev(), tasks, TYPES, TODAY)).toBe('начать лекала');
  });

  it('переданная в цех — «дождаться цеха»', () => {
    const tasks = [task({ id: 'a', status: 'waiting', stage_id: 'st1', task_type: 'dtf' })];
    expect(nextAction(dev(), tasks, TYPES, TODAY)).toBe('дождаться цеха: ДТФ');
  });

  it('всё закрыто — «зафиксировать исход»', () => {
    // ТЗ п.9: «Готово к серии» — это решение человека, а не автоматический шаг
    const tasks = [task({ id: 'a', status: 'done' })];
    expect(nextAction(dev(), tasks, TYPES, TODAY)).toBe('зафиксировать исход разработки');
  });

  it('задач нет вовсе — «добавить задачи»', () => {
    expect(nextAction(dev(), [], TYPES, TODAY)).toBe('добавить задачи разработки');
  });

  it('исход зафиксирован — действий больше нет', () => {
    expect(nextAction(dev({ outcome: 'ready_for_serial' }), [], TYPES, TODAY)).toBeNull();
    expect(currentBlocker([task({ status: 'done' })], TYPES, TODAY)).toBeNull();
  });
});

describe('причина ожидания', () => {
  it('называет ПЕРВУЮ незакрытую зависимость', () => {
    const patterns = task({ id: 'a', task_type: 'patterns' });
    const sample = task({ id: 'b', task_type: 'sample', depends_on: ['a'] });
    expect(taskWaitingReason(sample, [patterns, sample], TYPES)).toBe('Ждёт: Лекала');
  });

  it('переданная в цех называет цех', () => {
    const t = task({ status: 'waiting', stage_id: 'st', department_id: 'd1' });
    const depts = new Map([['d1', 'Цех ДТФ']]);
    expect(taskWaitingReason(t, [t], TYPES, depts, 'd1')).toBe('Передано в цех: Цех ДТФ');
  });

  it('заблокированная называет причину', () => {
    const t = task({ status: 'blocked', blocked_reason: 'Нет плёнки' });
    expect(taskWaitingReason(t, [t], TYPES)).toBe('Нет плёнки');
  });

  it('закрытая не ждёт ничего', () => {
    expect(taskWaitingReason(task({ status: 'done' }), [], TYPES)).toBeNull();
  });
});

describe('состояние разработки для верхних вкладок', () => {
  it('исход зафиксирован — «Готовы к серии»', () => {
    expect(devState(dev({ outcome: 'ready_for_serial' }), [], TODAY)).toBe('ready');
    // Даже неуспешный исход закрывает разработку: она больше не в работе
    expect(devState(dev({ outcome: 'cancelled' }), [], TODAY)).toBe('ready');
  });

  it('заблокированная задача — «Требуют внимания»', () => {
    expect(devState(dev(), [task({ status: 'blocked' })], TODAY)).toBe('attention');
  });

  it('просроченная задача — «Требуют внимания», даже если работа идёт', () => {
    // Группа перебивает «В работе»: она отвечает на более срочный вопрос
    const tasks = [task({ id: 'a', status: 'in_progress', due_date: '2026-08-01' })];
    expect(devState(dev(), tasks, TODAY)).toBe('attention');
  });

  it('просрочен срок самой разработки — тоже внимание', () => {
    expect(devState(dev({ due_date: '2026-08-01' }), [task({ status: 'todo' })], TODAY))
      .toBe('attention');
  });

  it('идёт примерка — «На примерке»', () => {
    const tasks = [
      task({ id: 'a', status: 'done' }),
      task({ id: 'b', task_type: 'fitting', status: 'in_progress' }),
    ];
    expect(devState(dev(), tasks, TODAY)).toBe('fitting');
  });

  it('примерка ещё не начата — не «На примерке»', () => {
    // Иначе на вкладке висело бы всё, где примерка когда-нибудь запланирована
    const tasks = [
      task({ id: 'a', status: 'in_progress' }),
      task({ id: 'b', task_type: 'fitting', status: 'todo' }),
    ];
    expect(devState(dev(), tasks, TODAY)).toBe('in_progress');
  });

  it('задача в цехе — «В работе»', () => {
    const tasks = [task({ status: 'waiting', stage_id: 'st' })];
    expect(devState(dev(), tasks, TODAY)).toBe('in_progress');
  });

  it('задач нет или все не начаты — «Новые»', () => {
    expect(devState(dev(), [], TODAY)).toBe('new');
    expect(devState(dev(), [task({ status: 'todo' })], TODAY)).toBe('new');
  });
});

describe('вспомогательное', () => {
  it('задача в цехе распознаётся по stage_id', () => {
    expect(isDelegated(task({ stage_id: 'st' }))).toBe(true);
    expect(isDelegated(task())).toBe(false);
  });

  it('название: своё → из справочника → код', () => {
    expect(taskLabel(task({ title: 'Лекала: рукав +2 см' }), TYPES))
      .toBe('Лекала: рукав +2 см');
    expect(taskLabel(task({ task_type: 'patterns' }), TYPES)).toBe('Лекала');
    expect(taskLabel(task({ task_type: 'неведомый' }), TYPES)).toBe('неведомый');
  });

  it('просрочка разработки берёт свой срок, иначе срок заказа', () => {
    expect(devOverdue(dev({ due_date: '2026-08-01' }), NOW)).toBe(true);
    expect(devOverdue(dev({ order: { due_date: '2026-08-01' } }), NOW)).toBe(true);
    expect(devOverdue(dev({ due_date: '2026-09-01' }), NOW)).toBe(false);
    // Закрытая разработка просроченной не считается — она больше не в работе
    expect(devOverdue(dev({ due_date: '2026-08-01', outcome: 'ready_for_serial' }), NOW))
      .toBe(false);
  });
});
