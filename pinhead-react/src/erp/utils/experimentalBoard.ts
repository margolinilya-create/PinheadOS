import type { ErpExperimental, ErpExperimentalTask, ErpMaterial } from '../types';
import { isTaskReady, taskLabel } from './experimentalTasks';
import { isMaterialPending, materialsForItem } from './routes';

/**
 * Доска экспериментального цеха ПО ЭТАПАМ (правки заказчика 20.08).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Главный экран экспериментального цеха должен быть
 * построен по этапам, по тому же принципу, как сейчас выглядит общий
 * производственный борд. Колонки: Построение лекал · Крой · Нанесения ·
 * Пошив · Финальный этап. Разработка перемещается между этапами по мере
 * выполнения работ».
 *
 * ГЛАВНОЕ РЕШЕНИЕ: КОЛОНКА ВЫЧИСЛЯЕТСЯ, А НЕ ХРАНИТСЯ. Колонка `phase`
 * удалена 12.08 вместе с линейной моделью, и возвращать её под другим именем
 * нельзя: два источника правды («хранимый этап» + «состояние задач») разъедутся
 * в первую же неделю. Этап разработки выводится из её ЗАДАЧ — ровно тем же
 * приёмом, что `devState` выводит «что происходит сейчас».
 *
 * КАРТОЧКА НА ДОСКЕ — РАЗРАБОТКА, а не задача. Это следует из самого документа:
 * он перечисляет в карточке «текущую задачу» (значит, карточка не задача)
 * и говорит «разработка перемещается между этапами». Поэтому drag-n-drop
 * на этой доске НЕТ: перетаскивание требует записываемой колонки, а разработка
 * переезжает потому, что закрылась задача, — не наоборот.
 */

/** Пять шагов документа, в порядке прохождения */
export type DevStage = 'patterns' | 'cutting' | 'branding' | 'sewing' | 'final';

export const DEV_STAGE_ORDER: DevStage[] = [
  'patterns', 'cutting', 'branding', 'sewing', 'final',
];

export const DEV_STAGE_LABELS: Record<DevStage, string> = {
  patterns: 'Построение лекал',
  cutting: 'Крой',
  branding: 'Нанесения',
  sewing: 'Пошив',
  final: 'Финальный этап',
};

/**
 * Тип задачи → шаг доски.
 *
 * `fitting` и `rework` шагами НЕ являются, и это прямо разрешено документом:
 * «отдельную постоянную колонку под примерку делать не обязательно — это может
 * быть статус или действие внутри карточки». Примерка относится к образцу,
 * собранному на шаге «Пошив», и своей колонки не требует.
 *
 * `material` и `hardware` — параллельная работа, она разработку по этапам
 * не двигает. Именно поэтому лекала и не ждут материал: у них разные дорожки.
 */
const STAGE_OF_TASK: Record<string, DevStage> = {
  patterns: 'patterns',
  cutting: 'cutting',
  dtf: 'branding',
  dtg: 'branding',
  silkscreen: 'branding',
  embroidery: 'branding',
  sublimation: 'branding',
  sample: 'sewing',
  sewing_sample: 'sewing',
  techcard: 'final',
  photo: 'final',
};

/**
 * Шаг задачи; `null` — задача вне шагов (примерка, доработка, материалы,
 * подряд, «другое»). Справочник типов свободный, и НЕИЗВЕСТНЫЙ код обязан
 * читаться как «вне шагов», а не ронять доску: технолог вправе завести
 * «Сублимация на молнии», и такая задача просто не двигает этапы.
 */
export function devStageOfTask(taskType: string | null | undefined): DevStage | null {
  return STAGE_OF_TASK[(taskType ?? '').trim()] ?? null;
}

/** Дорожка внутри колонки — те же группы, что на общем производственном борде */
export type DevLane =
  'waiting' | 'awaiting_materials' | 'ready' | 'in_progress' | 'blocked' | 'done' | 'skipped';

export const DEV_LANE_TITLES: Record<DevLane, string> = {
  waiting: 'Ожидает',
  awaiting_materials: 'Ожидает материалы',
  ready: 'Готово к работе',
  in_progress: 'В работе',
  blocked: 'С проблемой',
  done: 'Завершено',
  skipped: 'Пропущено',
};

const CLOSED = new Set(['done', 'cancelled']);

/** Гейт кроя: что именно держит этап */
export type CuttingWait = 'patterns' | 'materials' | 'both' | null;

export interface DevStageState {
  stage: DevStage;
  lane: DevLane;
  /** Задачи этого шага (в порядке `sort_order`) */
  tasks: ErpExperimentalTask[];
  /** Человекочитаемая причина ожидания; null — не ждёт */
  waitingReason: string | null;
}

export interface DevBoardInput {
  dev: Pick<ErpExperimental, 'item_id' | 'outcome'> & { sample_approved_at?: string | null };
  tasks: readonly ErpExperimentalTask[];
  /** Материалы ЗАКАЗА разработки — гейт кроя смотрит на них */
  materials?: readonly ErpMaterial[] | null;
}

/**
 * Гейт кроя: «начать можно только когда лекала готовы И необходимые материалы
 * физически приняты складом».
 *
 * ПОЧЕМУ НЕ `isStageReady`. Правило проекта: её сигнатура тянет цех, гейт
 * закупки и гейт ТЗ, которых у задач разработки нет вовсе. Переиспользуются
 * ГРАНУЛЯРНЫЕ функции материального гейта (`materialsForItem`,
 * `isMaterialPending`) — то есть одно и то же правило «материал годен», а не
 * его копия. Годным материал считается там же, где и в производстве: пришёл
 * и принят складом, зарезервирован со склада или не требуется.
 */
export function cuttingGate(input: {
  patternsDone: boolean;
  itemId?: string | null;
  materials?: readonly ErpMaterial[] | null;
}): { open: boolean; wait: CuttingWait; missing: ErpMaterial[] } {
  const mine = materialsForItem(
    (input.materials ?? []) as ErpMaterial[], input.itemId ?? null);
  const missing = mine.filter(isMaterialPending);
  const noMaterials = missing.length > 0;
  const wait: CuttingWait = !input.patternsDone && noMaterials
    ? 'both'
    : !input.patternsDone
      ? 'patterns'
      : noMaterials
        ? 'materials'
        : null;
  return { open: wait === null, wait, missing };
}

/** Подпись гейта кроя. Лекала называем ПЕРВЫМИ: этим ЭКС управляет сам */
export function cuttingWaitLabel(
  wait: CuttingWait,
  missing: readonly ErpMaterial[] = [],
): string | null {
  if (wait === null) return null;
  const names = missing.map((m) => m.name).filter(Boolean).join(', ');
  if (wait === 'patterns') return 'Ожидает лекала';
  const mat = names ? `Ожидает материалы: ${names}` : 'Ожидает материалы';
  return wait === 'materials' ? mat : `Ожидает лекала и ${mat.toLowerCase()}`;
}

/** Применим ли шаг к этой разработке */
function stageApplies(stage: DevStage, byStage: Map<DevStage, ErpExperimentalTask[]>): boolean {
  /**
   * «Нанесения» применимы, только если задача нанесения ЕСТЬ. У образца без
   * печати эта колонка не должна вечно светиться ожиданием: документ добавляет
   * нанесения по потребности («если образцу нужна вышивка»).
   */
  if (stage === 'branding') return (byStage.get('branding') ?? []).length > 0;
  return true;
}

/**
 * Состояния всех пяти шагов.
 *
 * ЛОВУШКА, РАДИ КОТОРОЙ ЭТО НАПИСАНО ТАК. Наивное «колонка — первый шаг
 * с незакрытой задачей» ломается дважды: разработка с готовыми лекалами
 * и ещё не заведённым кроем улетела бы в «Финальный этап», а разработка,
 * заведённая до 20.08 (у неё нет задач типа `cutting` вовсе), навсегда
 * застряла бы в «Крое». Поэтому пустой применимый шаг, ПОСЛЕ которого уже
 * есть работа, считается пропущенным, а пустой шаг без работы дальше
 * получает состояние по своему гейту — и приглашение завести задачу.
 */
export function devStageStates(input: DevBoardInput): DevStageState[] {
  const tasks = [...(input.tasks ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  const byStage = new Map<DevStage, ErpExperimentalTask[]>();
  for (const t of tasks) {
    const st = devStageOfTask(t.task_type);
    if (!st) continue;
    byStage.set(st, [...(byStage.get(st) ?? []), t]);
  }

  const patternsDone = (byStage.get('patterns') ?? []).length > 0
    && (byStage.get('patterns') ?? []).every((t) => CLOSED.has(t.status));

  /** Есть ли работа на шагах ПОСЛЕ указанного — признак «шаг перепрыгнули» */
  const workLater = (stage: DevStage): boolean => {
    const from = DEV_STAGE_ORDER.indexOf(stage) + 1;
    return DEV_STAGE_ORDER.slice(from).some(
      (s) => (byStage.get(s) ?? []).some((t) => t.status !== 'todo'),
    );
  };

  return DEV_STAGE_ORDER.map((stage) => {
    const own = byStage.get(stage) ?? [];
    const gate = stage === 'cutting'
      ? cuttingGate({
        patternsDone,
        itemId: input.dev.item_id,
        materials: input.materials,
      })
      : null;

    // Порядок веток — приоритет: сначала то, что требует решения
    const blocked = own.find((t) => t.status === 'blocked');
    if (blocked) {
      return {
        stage, lane: 'blocked' as DevLane, tasks: own,
        waitingReason: blocked.blocked_reason || 'Заблокировано',
      };
    }
    if (own.some((t) => t.status === 'in_progress')) {
      return { stage, lane: 'in_progress' as DevLane, tasks: own, waitingReason: null };
    }
    if (own.length > 0 && own.every((t) => CLOSED.has(t.status))) {
      return { stage, lane: 'done' as DevLane, tasks: own, waitingReason: null };
    }
    if (own.length === 0) {
      if (!stageApplies(stage, byStage) || workLater(stage)) {
        return { stage, lane: 'skipped' as DevLane, tasks: own, waitingReason: null };
      }
    }
    if (gate && !gate.open) {
      return {
        stage,
        lane: (gate.wait === 'patterns' ? 'waiting' : 'awaiting_materials') as DevLane,
        tasks: own,
        waitingReason: cuttingWaitLabel(gate.wait, gate.missing),
      };
    }
    /**
     * Задача, переданная в цех, ждёт ЦЕХ, а не зависимости: её статус ведёт
     * триггер, и предлагать «начать» здесь нельзя.
     */
    const delegated = own.find((t) => t.stage_id && t.status === 'waiting');
    if (delegated) {
      return {
        stage, lane: 'waiting' as DevLane, tasks: own,
        waitingReason: 'Передано в цех',
      };
    }
    const notReady = own.find((t) => !CLOSED.has(t.status) && !isTaskReady(t, tasks));
    if (notReady) {
      const dep = tasks.find((x) => (notReady.depends_on ?? []).includes(x.id)
        && !CLOSED.has(x.status));
      return {
        stage, lane: 'waiting' as DevLane, tasks: own,
        waitingReason: dep ? `Ждёт: ${taskLabel(dep)}` : 'Ожидает',
      };
    }
    return { stage, lane: 'ready' as DevLane, tasks: own, waitingReason: null };
  });
}

/**
 * Внутренние очереди ЭКС: задачи одного шага по всем разработкам.
 *
 * «Лекала, крой и пошив работают как собственные очереди экспериментального
 * цеха» — то есть это НЕ этапы производства и в очередь серийного участка
 * не попадают по построению: они живут в `erp_experimental_tasks`, у которых
 * цеха нет вовсе, пока их туда не передали.
 *
 * Открытые идут первыми, внутри — по сроку: очередь отвечает на вопрос
 * «что брать следующим», а закрытое остаётся видимым как история.
 */
export function devStageQueue<T extends { dev: unknown; tasks: readonly ErpExperimentalTask[] }>(
  rows: readonly T[],
  stage: DevStage,
): { row: T; task: ErpExperimentalTask }[] {
  const out: { row: T; task: ErpExperimentalTask }[] = [];
  for (const row of rows) {
    for (const task of row.tasks ?? []) {
      if (devStageOfTask(task.task_type) === stage) out.push({ row, task });
    }
  }
  return out.sort((a, b) => {
    const closedA = CLOSED.has(a.task.status) ? 1 : 0;
    const closedB = CLOSED.has(b.task.status) ? 1 : 0;
    if (closedA !== closedB) return closedA - closedB;
    return (a.task.due_date ?? '9999').localeCompare(b.task.due_date ?? '9999');
  });
}

/**
 * Отфильтрованное представление ОБЩЕГО производственного задания.
 *
 * «Шелкография, DTF, вышивка и DTG являются отфильтрованными представлениями
 * общих производственных задач… задачи нанесений не дублируются». Поэтому
 * здесь именно ОТБОР записей `buildQueueEntries`, а не свой механизм: одна
 * и та же строка `erp_item_stages` показывается и в общем цехе, и здесь,
 * и статус у неё один на всех.
 */
export function experimentalEntries<T extends { stage: { origin?: string | null } }>(
  entries: readonly T[],
): T[] {
  return (entries ?? []).filter((e) => e.stage?.origin === 'experimental');
}

/**
 * Колонка разработки — первый шаг, который ещё не закрыт и не пропущен.
 *
 * Утверждённый образец перебивает всё: документ говорит прямо — «после
 * утверждения образца разработка переходит в колонку "Финальный этап"», —
 * и дозаведённая кем-то задача нанесения не должна утаскивать её назад.
 */
export function devBoardColumn(
  states: readonly DevStageState[],
  dev: { outcome?: string | null; sample_approved_at?: string | null },
): DevStage {
  if (dev.outcome || dev.sample_approved_at) return 'final';
  const open = states.find((s) => s.lane !== 'done' && s.lane !== 'skipped');
  return open?.stage ?? 'final';
}
