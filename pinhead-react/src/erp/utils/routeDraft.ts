import type { ErpItemStage } from '../types';
import type { RouteStage } from './routes';

/**
 * Черновик маршрута — движок конструктора этапов (правки заказчика 16.08).
 *
 * ЧТО ПРОСИЛ ЗАКАЗЧИК: «маршрут не должен быть жёстко зафиксирован системой.
 * Необходимо позволить добавлять этап, удалять этап, менять порядок, выбирать
 * наш / подрядный исполнитель, добавлять несколько подрядных этапов, возвращать
 * изделие после подрядчика обратно в наши цеха».
 *
 * ГЛАВНОЕ РЕШЕНИЕ — КАК ПРИМИРИТЬ ДОКУМЕНТ С МОДЕЛЬЮ. Документ описывает
 * маршрут ЛИНЕЙНО: «Закупка → Наш крой → Подрядная печать → Наш пошив».
 * Модель же — ГРАФ: `depends_on` у этапа, и ветки нанесения идут ПАРАЛЛЕЛЬНО
 * (ДТФ и вышивка одновременно, швейка ждёт обеих). Ломать граф нельзя — на нём
 * стоят готовность этапа, возврат брака и весь расчёт очереди.
 *
 * Поэтому конструктор работает не над этапами, а над ГРУППАМИ: строка списка —
 * это шаг маршрута, внутри которого один этап (обычный случай) или несколько
 * параллельных. Это не компромисс, а точное описание того, что `buildRoute`
 * уже делает: ветки нанесения получают ОДИНАКОВЫЙ `sortOrder`, то есть образуют
 * группу. `depends_on` пересчитывается механически — каждый шаг зависит от всех
 * этапов предыдущей группы.
 *
 * ИНВАРИАНТ, КОТОРЫЙ ОБЯЗАН ДЕРЖАТЬСЯ: черновик, собранный из расчётного
 * маршрута и не тронутый человеком, при линеаризации даёт РОВНО ТОТ ЖЕ набор
 * `(departmentCode, dependsOnCodes, sortOrder)`, что `buildItemRoute`. Без него
 * открытие конструктора без единой правки молча переписывало бы маршрут.
 * Сторожит `routeDraft.test.ts`.
 *
 * `sort_order` остаётся `int` и перенумеровывается ЦЕЛИКОМ шагом 10. Numeric-шкала
 * (как у `queue_position`) здесь не годится принципиально: параллельные этапы
 * имеют ОДИНАКОВЫЙ порядок, и «середины между 30 и 30» не существует —
 * то есть главный случай она не решает. Маршрут это 4–8 строк, перенумеровать
 * их одной транзакцией дешевле второй шкалы.
 */

export interface RouteStep {
  /** Существующий этап; null — этап, которого ещё нет в базе */
  stageId: string | null;
  /** Цех-владелец. Обязателен всегда, в том числе у подрядного этапа */
  departmentCode: string;
  executor: 'internal' | 'contractor';
  contractor: string;
  /** Имя операции, когда оно расходится с именем цеха (сублимация и т.п.) */
  operation: string;
  /**
   * В этапе уже работали: переставить и удалить нельзя, только «Пропустить».
   * Считается из факта, а не из статуса: этап, взятый в работу и возвращённый
   * в очередь, тоже нельзя выбрасывать — его работа уже где-то учтена.
   */
  locked: boolean;
}

/** Шаг маршрута: один этап или несколько параллельных (ветки нанесения) */
export type RouteGroup = RouteStep[];

export function emptyStep(departmentCode: string): RouteStep {
  return {
    stageId: null,
    departmentCode,
    executor: 'internal',
    contractor: '',
    operation: '',
    locked: false,
  };
}

/**
 * Черновик из РАСЧЁТНОГО маршрута (`buildItemRoute`) — предложение по умолчанию.
 * Заказчик решил: автоматический расчёт остаётся и предлагает маршрут, человек
 * его правит. Группируем по `sortOrder`, потому что именно им `buildRoute`
 * помечает параллельные ветки.
 */
export function draftFromRoute(route: readonly RouteStage[]): RouteGroup[] {
  const byOrder = new Map<number, RouteGroup>();
  for (const r of route) {
    const group = byOrder.get(r.sortOrder) ?? [];
    group.push(emptyStep(r.departmentCode));
    byOrder.set(r.sortOrder, group);
  }
  return [...byOrder.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group);
}

interface StageLike extends Pick<
  ErpItemStage, 'id' | 'sort_order' | 'status' | 'qty_done' | 'qty_rework' | 'started_at'
> {
  department_id: string;
  executor?: string;
  contractor?: string | null;
  operation?: string | null;
}

/**
 * Этап уже нельзя выбросить из маршрута: в нём есть факт или он начат.
 * Ровно это же условие стоит в RLS-политике удаления — гейт интерфейса
 * и страж обязаны совпадать значением, иначе получится «кнопка есть,
 * действие падает» либо, что хуже, стёртая работа.
 */
export function isStepLocked(stage: StageLike): boolean {
  return (stage.qty_done ?? 0) > 0
    || (stage.qty_rework ?? 0) > 0
    || Boolean(stage.started_at)
    || !['waiting', 'ready'].includes(stage.status);
}

/** Черновик из СУЩЕСТВУЮЩИХ этапов позиции — для карточки заказа */
export function draftFromStages(
  stages: readonly StageLike[],
  deptCodeById: ReadonlyMap<string, string>,
): RouteGroup[] {
  const byOrder = new Map<number, RouteGroup>();
  for (const s of [...stages].sort((a, b) => a.sort_order - b.sort_order)) {
    // Пропущенный этап в конструкторе не показываем: он уже выведен из маршрута
    if (s.status === 'skipped') continue;
    const group = byOrder.get(s.sort_order) ?? [];
    group.push({
      stageId: s.id,
      departmentCode: deptCodeById.get(s.department_id) ?? '',
      executor: s.executor === 'contractor' ? 'contractor' : 'internal',
      contractor: s.contractor ?? '',
      operation: s.operation ?? '',
      locked: isStepLocked(s),
    });
    byOrder.set(s.sort_order, group);
  }
  return [...byOrder.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, group]) => group);
}

// --- Правки черновика ---------------------------------------------------------

/** Переставить группу. Группу с начатой работой не двигаем */
export function moveGroup(draft: RouteGroup[], index: number, delta: number): RouteGroup[] {
  const target = index + delta;
  if (index < 0 || index >= draft.length) return draft;
  if (target < 0 || target >= draft.length) return draft;
  if (draft[index].some((s) => s.locked) || draft[target].some((s) => s.locked)) return draft;
  const next = [...draft];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** Вставить новый шаг маршрута ПОСЛЕ указанной позиции (-1 — в начало) */
export function insertGroup(
  draft: RouteGroup[],
  afterIndex: number,
  step: RouteStep,
): RouteGroup[] {
  const next = [...draft];
  next.splice(afterIndex + 1, 0, [step]);
  return next;
}

/** Добавить этап ПАРАЛЛЕЛЬНО существующему шагу (вторая ветка нанесения) */
export function addParallel(
  draft: RouteGroup[],
  index: number,
  step: RouteStep,
): RouteGroup[] {
  if (index < 0 || index >= draft.length) return draft;
  return draft.map((g, i) => (i === index ? [...g, step] : g));
}

/** Убрать этап. Пустая группа исчезает целиком */
export function removeStep(draft: RouteGroup[], gi: number, si: number): RouteGroup[] {
  if (gi < 0 || gi >= draft.length) return draft;
  if (draft[gi][si]?.locked) return draft;
  return draft
    .map((g, i) => (i === gi ? g.filter((_, j) => j !== si) : g))
    .filter((g) => g.length > 0);
}

export function patchStep(
  draft: RouteGroup[],
  gi: number,
  si: number,
  patch: Partial<RouteStep>,
): RouteGroup[] {
  return draft.map((g, i) => (
    i === gi ? g.map((s, j) => (j === si ? { ...s, ...patch } : s)) : g));
}

// --- Линеаризация -------------------------------------------------------------

export interface LinearStep {
  step: RouteStep;
  sortOrder: number;
  /** Индексы этапов-предшественников В ЭТОМ ЖЕ массиве */
  dependsOn: number[];
}

/**
 * Черновик → плоский список этапов с `sort_order` и `depends_on`.
 *
 * Зависимости считаются механически: каждый этап зависит от ВСЕХ этапов
 * предыдущей группы. Это ровно тот граф, который сегодня строит `buildRoute`
 * (швейка после нанесения ждёт все ветки нанесения).
 *
 * `depends_on` отдаётся ИНДЕКСАМИ, а не идентификаторами: у новых этапов их
 * ещё нет, и сервер раскладывает индексы в uuid сам — тот же приём, что
 * в `erp_create_order` и `erp_experimental_add_tasks`.
 */
export function linearize(draft: readonly RouteGroup[]): LinearStep[] {
  const out: LinearStep[] = [];
  let prevIndices: number[] = [];
  let sort = 10;

  for (const group of draft) {
    const mine: number[] = [];
    for (const step of group) {
      mine.push(out.length);
      out.push({ step, sortOrder: sort, dependsOn: [...prevIndices] });
    }
    if (mine.length > 0) {
      prevIndices = mine;
      sort += 10;
    }
  }
  return out;
}

// --- Валидация ----------------------------------------------------------------

export interface RouteIssue {
  /** Индекс группы; null — проблема всего маршрута */
  group: number | null;
  text: string;
}

export function routeIssues(draft: readonly RouteGroup[]): RouteIssue[] {
  const issues: RouteIssue[] = [];
  if (draft.length === 0) {
    issues.push({ group: null, text: 'В маршруте нет ни одного этапа' });
  }
  draft.forEach((group, gi) => {
    group.forEach((step) => {
      if (!step.departmentCode) {
        issues.push({ group: gi, text: 'У этапа не выбран участок' });
      }
      /**
       * Подрядчик обязателен: без имени подрядный этап не отличить от нашего
       * ни в разделе «Подряд», ни в таблице «где заказ сейчас» — а это главный
       * вопрос, ради которого раздел и существует.
       */
      if (step.executor === 'contractor' && !step.contractor.trim()) {
        issues.push({ group: gi, text: 'У подрядного этапа не указан подрядчик' });
      }
    });
    // Один и тот же участок дважды в одном шаге — почти всегда промах руки
    const codes = group.filter((s) => s.executor === 'internal').map((s) => s.departmentCode);
    if (new Set(codes).size !== codes.length) {
      issues.push({ group: gi, text: 'Один участок добавлен в шаг дважды' });
    }
  });
  return issues;
}

/**
 * Что удалить при сохранении: этапы, которые были в позиции, но из черновика
 * исчезли. Пропущенные (`skipped`) в черновик не попадают ВОВСЕ, поэтому их
 * надо исключить явно — иначе сохранение маршрута стирало бы историю пропуска.
 */
export function removedStageIds(
  stages: readonly StageLike[],
  draft: readonly RouteGroup[],
): string[] {
  const kept = new Set(draft.flat().map((s) => s.stageId).filter(Boolean));
  return stages
    .filter((s) => s.status !== 'skipped' && !kept.has(s.id))
    .map((s) => s.id);
}
