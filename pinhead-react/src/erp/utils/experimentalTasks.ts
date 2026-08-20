import type { DevOutcome, DevTaskStatus, ErpExperimental, ErpExperimentalTask } from '../types';
import { daysLeft } from './time';

/**
 * Чистая логика разработки: готовность, блокер, следующее действие, состояние.
 *
 * ЗАЧЕМ. Модель заказчика (ТЗ 12.08) — не цепочка фаз, а НАБОР ЗАДАЧ:
 * параллельных, необязательных, с зависимостями и повторяющимися циклами.
 * Верхняя панель экрана («Новые · В работе · Требуют внимания · На примерке ·
 * Готовы к серии») — это не хранимые статусы, а вычисляемые состояния, поэтому
 * колонка `phase` не заменяется другой колонкой, а становится мёртвой:
 * хранится только ИСХОД, всё остальное считается отсюда.
 *
 * Форма повторяет `utils/routes` + `utils/queueEntries` (та же семантика
 * «предшественник закрыт»), но НЕ переиспользует `isStageReady`: её сигнатура
 * тянет материалы, цех, гейт закупки и ТЗ, а у задач разработки этих гейтов
 * нет. Седьмой позиционный аргумент проект уже осудил вслух.
 *
 * Готовность считается в ЗАДАЧАХ, а не в штуках (`utils/progress`): это разные
 * величины, и смешение — ровно та ошибка, из-за которой мощность считали
 * в этапах вместо изделий.
 */

/** Задача не ждёт работы: сделана или отменена */
const CLOSED: ReadonlySet<DevTaskStatus> = new Set<DevTaskStatus>(['done', 'cancelled']);

/** Задача передана в цех — её статус ведёт триггер, клиент только читает */
export function isDelegated(task: Pick<ErpExperimentalTask, 'stage_id'>): boolean {
  return Boolean(task.stage_id);
}

/**
 * Все зависимости задачи закрыты.
 *
 * Отсутствующая зависимость считается выполненной — то же fail-open, что
 * в маршруте (`isStageReady`): ссылка в никуда держала бы задачу закрытой
 * навсегда, а это хуже, чем лишний запуск.
 */
export function isTaskReady(
  task: Pick<ErpExperimentalTask, 'depends_on'>,
  all: readonly Pick<ErpExperimentalTask, 'id' | 'status'>[],
): boolean {
  const byId = new Map(all.map((t) => [t.id, t]));
  return (task.depends_on ?? []).every((id) => {
    const dep = byId.get(id);
    return !dep || CLOSED.has(dep.status);
  });
}

/** Группа задачи для доски: как `QueueGroup`, но для разработки */
export type DevTaskGroup =
  'blocked' | 'in_progress' | 'waiting' | 'ready' | 'done' | 'cancelled';

export function taskGroup(
  task: Pick<ErpExperimentalTask, 'status' | 'depends_on'>,
  all: readonly Pick<ErpExperimentalTask, 'id' | 'status'>[],
): DevTaskGroup {
  if (task.status === 'done') return 'done';
  if (task.status === 'cancelled') return 'cancelled';
  if (task.status === 'blocked') return 'blocked';
  if (task.status === 'in_progress') return 'in_progress';
  // `waiting` ставит триггер, когда задача ушла в цех: она ждёт не зависимости,
  // а сам цех, и предлагать «начать» здесь нельзя
  if (task.status === 'waiting') return 'waiting';
  return isTaskReady(task, all) ? 'ready' : 'waiting';
}

/** Название задачи для человека: своё, иначе код типа */
export function taskLabel(
  task: Pick<ErpExperimentalTask, 'title' | 'task_type'>,
  typeNames?: Map<string, string> | null,
): string {
  return task.title?.trim() || typeNames?.get(task.task_type) || task.task_type;
}

/**
 * Почему задача ждёт. `null` — не ждёт.
 *
 * Называем ПЕРВУЮ незакрытую зависимость, а не их число: «Ждёт: Лекала»
 * отвечает на вопрос, «ждёт 2 задачи» — нет.
 */
export function taskWaitingReason(
  task: Pick<ErpExperimentalTask, 'status' | 'depends_on' | 'blocked_reason' | 'stage_id'>,
  all: readonly (Pick<ErpExperimentalTask, 'id' | 'status' | 'title' | 'task_type'>)[],
  typeNames?: Map<string, string> | null,
  deptNames?: Map<string, string> | null,
  departmentId?: string | null,
): string | null {
  if (task.status === 'blocked') return task.blocked_reason || 'Заблокировано';
  if (CLOSED.has(task.status as DevTaskStatus)) return null;
  if (isDelegated(task) && task.status === 'waiting') {
    const dept = departmentId ? deptNames?.get(departmentId) : null;
    return dept ? `Передано в цех: ${dept}` : 'Передано в цех';
  }
  const byId = new Map(all.map((t) => [t.id, t]));
  for (const id of task.depends_on ?? []) {
    const dep = byId.get(id);
    if (dep && !CLOSED.has(dep.status)) return `Ждёт: ${taskLabel(dep, typeNames)}`;
  }
  return null;
}

export interface DevReadiness {
  done: number;
  total: number;
  /** null — задач нет вовсе: это «неизвестно», а не «готово» */
  pct: number | null;
}

/**
 * Готовность разработки — «3 / 5 задач» из карточки ТЗ (п.12).
 *
 * Отменённые в знаменатель не входят: они не работа (ровно как `skipped`
 * в `itemProgress`). Ноль задач даёт `null`, а не 100 — правило проекта
 * про ноль в знаменателе.
 */
export function devReadiness(
  tasks: readonly Pick<ErpExperimentalTask, 'status'>[],
): DevReadiness {
  const relevant = (tasks ?? []).filter((t) => t.status !== 'cancelled');
  const done = relevant.filter((t) => t.status === 'done').length;
  const total = relevant.length;
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : null };
}

/**
 * Текущий блокер — на чём разработка стоит прямо сейчас.
 *
 * Порядок важен: сначала то, что требует РЕШЕНИЯ (заблокировано), потом
 * то, что требует внимания (просрочено), потом то, что просто идёт.
 * Руководителю нужен ответ «почему стоит», а не «что-нибудь незакрытое».
 */
export function currentBlocker(
  tasks: readonly ErpExperimentalTask[],
  typeNames?: Map<string, string> | null,
  today: string = '',
): ErpExperimentalTask | null {
  const open = (tasks ?? []).filter((t) => !CLOSED.has(t.status));
  if (open.length === 0) return null;
  const blocked = open.find((t) => t.status === 'blocked');
  if (blocked) return blocked;
  if (today) {
    const late = open
      .filter((t) => t.due_date && t.due_date < today)
      .sort((a, b) => (a.due_date ?? '').localeCompare(b.due_date ?? ''));
    if (late.length > 0) return late[0];
  }
  const working = open.find((t) => t.status === 'in_progress');
  if (working) return working;
  const delegated = open.find(isDelegated);
  if (delegated) return delegated;
  return open.find((t) => isTaskReady(t, tasks)) ?? open[0];
}

/**
 * Следующее действие — вторая строка карточки ТЗ (п.12).
 *
 * Формулируется ГЛАГОЛОМ: «завершить пошив образца», а не «пошив образца».
 * Руководитель читает её, чтобы понять, чего он ждёт от людей.
 */
export function nextAction(
  dev: Pick<ErpExperimental, 'outcome'>,
  tasks: readonly ErpExperimentalTask[],
  typeNames?: Map<string, string> | null,
  today: string = '',
): string | null {
  if (dev.outcome) return null;
  const open = (tasks ?? []).filter((t) => !CLOSED.has(t.status));
  if (open.length === 0) {
    return tasks.length === 0
      ? 'добавить задачи разработки'
      : 'зафиксировать исход разработки';
  }
  const blocker = currentBlocker(tasks, typeNames, today);
  if (!blocker) return null;
  const name = taskLabel(blocker, typeNames);
  if (blocker.status === 'blocked') {
    return `снять блокировку: ${blocker.blocked_reason || name}`;
  }
  if (isDelegated(blocker) && blocker.status === 'waiting') return `дождаться цеха: ${name}`;
  if (blocker.status === 'in_progress') return `завершить ${name.toLowerCase()}`;
  if (isTaskReady(blocker, tasks)) return `начать ${name.toLowerCase()}`;
  return `дождаться: ${taskWaitingReason(blocker, tasks, typeNames) ?? name}`;
}

/**
 * Состояние разработки для верхних вкладок экрана (ТЗ п.11).
 *
 * Это ВЫЧИСЛЯЕМОЕ состояние, а не хранимое: заказчик просит «акцент не на том,
 * на какой фазе заказ, а на том, что происходит с разработкой прямо сейчас».
 * Два источника правды («хранимый статус» + «состояние задач») разъехались бы
 * в первую же неделю.
 *
 * Порядок веток — приоритет: «требует внимания» перебивает «в работе», потому
 * что отвечает на более срочный вопрос.
 */
export type DevState = 'ready' | 'attention' | 'fitting' | 'in_progress' | 'new';

export const DEV_STATE_LABELS: Record<DevState, string> = {
  new: 'Новые',
  in_progress: 'В работе',
  attention: 'Требуют внимания',
  fitting: 'На примерке',
  ready: 'Готовы к серии',
};

/** Типы задач, которые означают «изделие на примерке» */
const FITTING_TYPES: ReadonlySet<string> = new Set(['fitting']);

export function devState(
  dev: Pick<ErpExperimental, 'outcome' | 'due_date'>,
  tasks: readonly ErpExperimentalTask[],
  today: string = '',
): DevState {
  if (dev.outcome) return 'ready';
  const open = (tasks ?? []).filter((t) => !CLOSED.has(t.status));

  // Требует внимания: заблокировано, просрочена задача или просрочена сама
  // разработка. Это единственная группа, отвечающая «нужно вмешаться»
  const hasBlocked = open.some((t) => t.status === 'blocked');
  const hasLate = Boolean(today) && (
    open.some((t) => t.due_date && t.due_date < today)
    || (dev.due_date ? dev.due_date < today : false)
  );
  if (hasBlocked || hasLate) return 'attention';

  if (open.some((t) => FITTING_TYPES.has(t.task_type) && t.status !== 'todo')) return 'fitting';
  if (open.some((t) => t.status === 'in_progress' || isDelegated(t))) return 'in_progress';
  // Задач нет вовсе или все ещё не начаты — разработка только заведена
  return tasks.length === 0 || open.every((t) => t.status === 'todo') ? 'new' : 'in_progress';
}

/** Просрочена ли разработка по своему сроку (или сроку заказа) */
export function devOverdue(
  dev: Pick<ErpExperimental, 'outcome' | 'due_date'> & {
    order?: { due_date?: string | null } | null;
  },
  now: Date = new Date(),
): boolean {
  if (dev.outcome) return false;
  const due = dev.due_date || dev.order?.due_date || null;
  const d = daysLeft(due, now);
  return d !== null && d < 0;
}

/**
 * Исход, закрывающий разработку успешно. Отдельная функция, потому что
 * «Готово к серии» — единственный исход, после которого менеджер заводит
 * производственный заказ, и интерфейс подсказывает это именно здесь.
 */
export function isSuccessOutcome(outcome: DevOutcome | null | undefined): boolean {
  return outcome === 'ready_for_serial';
}

/* ──────────────────────────────────────────────────────────────────────────
 * Доработка образца ПО ОБЛАСТЯМ (правки заказчика 20.08)
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * Что именно нужно изменить — перечень документа дословно.
 *
 * ПОЧЕМУ ЭТО НЕ СВОБОДНЫЙ ТЕКСТ. От области зависит НАБОР повторных задач,
 * то есть реальная работа цеха. Прежняя кнопка «Примерка не принята» заводила
 * жёсткую тройку `rework → sample → fitting` независимо от причины: вышивку
 * перезапускали из-за длины рукава, а крой не перезапускали вовсе. Документ
 * требует обратного: «повторно запускаются только необходимые этапы… нанесение
 * не запускается повторно, если изменения его не касаются».
 */
export type ReworkArea = 'patterns' | 'material' | 'cutting' | 'branding' | 'sewing' | 'other';

export const REWORK_AREAS: ReworkArea[] = [
  'patterns', 'material', 'cutting', 'branding', 'sewing', 'other',
];

export const REWORK_AREA_LABELS: Record<ReworkArea, string> = {
  patterns: 'Лекала',
  material: 'Материал',
  cutting: 'Крой',
  branding: 'Нанесение',
  sewing: 'Пошив',
  other: 'Другое',
};

/** Задача нового круга: тот же вход, что у `addDevTasks` (индексы — внутри пачки) */
export interface ReworkTask {
  task_type: string;
  title: string;
  comment?: string | null;
  depends_on?: number[];
}

export interface ReworkPlan {
  tasks: ReworkTask[];
  /** Текст последствий для подтверждения — считает ТА ЖЕ функция, что и задачи */
  summary: string;
  /** Выбрано «нанесение», а повторять нечего: задачи нанесения не было */
  brandingMissing: boolean;
}

/** Типы задач нанесения, встречающиеся в разработке (для повтора того же участка) */
const BRANDING_TYPES: ReadonlySet<string> = new Set([
  'dtf', 'dtg', 'silkscreen', 'embroidery', 'sublimation',
]);

/**
 * Набор задач повторного круга под выбранные области — и текст последствий
 * к нему. Одна функция на оба, по правилу проекта: «последствия называет
 * утилита с тестами», иначе подтверждение расходится с фактом.
 *
 * ПРАВИЛО СОСТАВА. Меняются лекала или материал — кроить и шить надо заново;
 * меняется крой — шить заново. Пошив пересобирается ВСЕГДА: образец физически
 * разбирается, иначе проверять нечего. Нанесение повторяется ТОЛЬКО когда его
 * выбрали — это единственное требование документа, сформулированное запретом.
 *
 * ЗАВИСИМОСТИ повторяют производственный порядок (лекала и материал идут
 * параллельно, крой ждёт обоих, пошив ждёт крой и все нанесения), а номер
 * круга считает СЕРВЕР по типу задачи: рисовать его заранее значит показать
 * число, которого может не получиться.
 */
export function reworkPlan(
  areas: readonly ReworkArea[],
  input: {
    note?: string | null;
    /** Существующие задачи — из них берутся участки нанесения для повтора */
    tasks?: readonly Pick<ErpExperimentalTask, 'task_type'>[];
  } = {},
): ReworkPlan {
  const picked = new Set(areas);
  const note = (input.note ?? '').trim();
  const suffix = note ? `: ${note}` : '';
  const tasks: ReworkTask[] = [];
  const steps: string[] = [];
  const idx = (t: ReworkTask) => { tasks.push(t); return tasks.length - 1; };

  const patternsAt = picked.has('patterns')
    ? idx({ task_type: 'patterns', title: `Доработка лекал${suffix}`, comment: note || null })
    : -1;
  if (patternsAt >= 0) steps.push('доработка лекал');

  const materialAt = picked.has('material')
    ? idx({ task_type: 'material', title: `Замена материала${suffix}`, comment: note || null })
    : -1;
  if (materialAt >= 0) steps.push('подбор материала');

  // Крой заново — при смене лекал, материала или самого кроя
  const needCut = picked.has('patterns') || picked.has('material') || picked.has('cutting');
  const cutAt = needCut
    ? idx({
      task_type: 'cutting',
      title: 'Новый крой',
      comment: note || null,
      depends_on: [patternsAt, materialAt].filter((i) => i >= 0),
    })
    : -1;
  if (cutAt >= 0) steps.push('новый крой');

  const brandTypes = picked.has('branding')
    ? [...new Set((input.tasks ?? [])
      .map((t) => t.task_type)
      .filter((t) => BRANDING_TYPES.has(t)))]
    : [];
  const brandAt: number[] = brandTypes.map((type) => idx({
    task_type: type,
    title: 'Повторное нанесение',
    comment: note || null,
    depends_on: cutAt >= 0 ? [cutAt] : [],
  }));
  if (brandAt.length > 0) steps.push('повторное нанесение');

  const sewAt = idx({
    task_type: 'sample',
    title: 'Повторная сборка образца',
    comment: note || null,
    depends_on: [...(cutAt >= 0 ? [cutAt] : []), ...brandAt],
  });
  steps.push('новый пошив');

  idx({
    task_type: 'fitting',
    title: 'Повторная проверка образца',
    comment: note || null,
    depends_on: [sewAt],
  });
  steps.push('повторная проверка образца');

  const brandingMissing = picked.has('branding') && brandTypes.length === 0;
  const tail = picked.has('branding')
    ? (brandingMissing
      ? ' Задач нанесения в разработке нет — повторять нечего, заведите её вручную.'
      : '')
    : ' Нанесение повторно НЕ запускается: изменения его не касаются.';

  return {
    tasks,
    summary: `Появятся задачи нового круга: ${steps.join(' → ')}.${tail}`,
    brandingMissing,
  };
}

/**
 * История доработок — задачи повторных кругов, в порядке заведения.
 *
 * ПЛОСКИЙ СПИСОК, А НЕ ГРУППЫ ПО `cycle`, и это не упрощение. Круг считает
 * сервер ПО ТИПУ задачи: в одном и том же круге доработки лекала получат
 * `cycle = 1`, а повторная сборка образца — `cycle = 2`, если образец уже
 * собирали. Группа, подписанная «Круг 1», не содержала бы половины своей же
 * работы — и врала бы убедительно. Номер круга остаётся у КАЖДОЙ задачи,
 * там он верен: «примерка, круг 2» — это ровно вторая примерка.
 */
export function reworkHistory(
  tasks: readonly ErpExperimentalTask[],
): ErpExperimentalTask[] {
  return (tasks ?? [])
    .filter((t) => t.cycle > 0)
    .sort((a, b) => a.sort_order - b.sort_order);
}
