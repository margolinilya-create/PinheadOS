import type { BrandingMethod, BrandingOn, ErpItemStage, ProductionType } from '../types';
import { buildItemRoute } from './routes';
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
   * Поля ПОДРЯДНОГО этапа (правки заказчика 20.08): «если при построении
   * маршрута менеджер выбирает этап "Подряд", внутри этапа открываются
   * дополнительные поля».
   *
   * Живут они не на этапе, а на его спутнике `erp_subcontracting` — карточке
   * подрядчика при этапе. Здесь они собираются вместе с маршрутом, потому что
   * заполняются одним движением: выбрал «Подрядчик» — назвал, кому, что, когда
   * и сколько. Разносить это по двум экранам значит гарантировать, что половина
   * останется пустой.
   *
   * Строки — как в форме: пустая строка означает «не заполнено», и в базу
   * уезжает NULL. Числа тоже строками: поле ввода отдаёт строку, а `0` и «не
   * указано» здесь разные вещи.
   */
  qty: string;
  /** Плановая дата ПЕРЕДАЧИ подрядчику */
  sendPlan: string;
  /** Плановая дата ВОЗВРАТА (в схеме — `planned_date`) */
  returnPlan: string;
  /** Ответственный со стороны Pinhead */
  responsible: string;
  /** Что передаём подрядчику: «сшитые худи», «полотно», «кепки» */
  handover: string;
  comment: string;
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
    qty: '',
    sendPlan: '',
    returnPlan: '',
    responsible: '',
    handover: '',
    comment: '',
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

/**
 * Позиция формы создания — ровно те поля, из которых считается маршрут.
 *
 * Техники нанесения принимаются В ДВУХ ВИДАХ намеренно: в самой форме это
 * блоки «Нанесение №N» под флагом `has_branding`, а в payload заказа —
 * готовый список `branding_methods`. Одна функция обязана понимать оба,
 * иначе она вернёт разный маршрут по разные стороны одного сабмита: в форме
 * с нанесениями, в сторе без них — и заказ уедет мимо участков печати.
 */
export interface FormItemLike {
  production_type?: string;
  branding_on?: string;
  material_source?: string;
  has_branding?: boolean;
  prints?: { method?: string }[];
  branding_methods?: string[];
  route?: RouteGroup[];
}

/** Техники нанесения позиции, из какого бы вида она ни пришла */
function methodsOf(it: FormItemLike): BrandingMethod[] {
  const raw = it.branding_methods
    ?? (it.has_branding ? (it.prints ?? []).map((p) => p.method) : []);
  return raw
    .filter((m): m is string => Boolean(m))
    .filter((m, i, all) => all.indexOf(m) === i) as BrandingMethod[];
}

/**
 * Маршрут позиции ФОРМЫ СОЗДАНИЯ: правка человека, если она есть, иначе расчёт.
 *
 * ЦЕЛИКОМ, ВКЛЮЧАЯ СБОРКУ АРГУМЕНТОВ РАСЧЁТА, и это главное. Читателей уже
 * трое — превью ТЗ в форме, сам конструктор и сборка payload в `createOrder`, —
 * и разойтись они могут не только правилом «правка или расчёт», но и тем, что
 * подставлено в `buildItemRoute`. Второе тише: `materialSource`, взятый на одной
 * стороне без проверки типа производства, вырезает из маршрута закупку — заказ
 * создаётся не по тому маршруту, по которому считался гейт ТЗ, и обе стороны
 * при этом «работают».
 *
 * Пустой массив трактуется как «не трогали»: маршрут без единого этапа —
 * это не решение человека, а состояние, из которого он не вышел.
 */
export function formItemRoute(
  it: FormItemLike,
  /**
   * Контекст ЗАКАЗА, а не позиции: «закупка не требуется» отмечается один раз
   * на весь заказ. Необязателен — но передать его обязаны ВСЕ трое читателей,
   * иначе заказ создастся не по тому маршруту, по которому считался гейт ТЗ.
   * Ровно так уже расходились из-за `materialSource`.
   */
  order: { needsPurchase?: boolean } = {},
): RouteGroup[] {
  if (it.route && it.route.length > 0) return it.route;
  return draftFromRoute(buildItemRoute({
    needsPurchase: order.needsPurchase,
    /**
     * Приведение типов, а не проверка: в форме эти поля — свободные строки
     * (их выбирают плитками и списками, но хранятся они как есть), а
     * `buildItemRoute` объявлен на перечислениях. Значение вне перечисления
     * маршрут не роняет — `buildRoute` разбирает его `switch`-ем с ветками
     * по умолчанию, — поэтому санитайзер здесь был бы вторым местом, где
     * решают, что считать допустимым типом производства.
     */
    productionType: it.production_type as ProductionType,
    brandingMethods: methodsOf(it),
    brandingOn: (it.branding_on ?? 'cut') as BrandingOn,
    materialSource: it.production_type === 'outsource' ? (it.material_source || 'pinhead') : null,
  }));
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

/**
 * Карточка подрядчика при этапе — ровно те поля, которые правит конструктор.
 * Принимаем структурный тип, а не `ErpSubcontractOp`: реестр грузится лениво,
 * и заставлять карточку заказа тянуть его тип ради шести строк незачем.
 */
export interface SubcontractSeed {
  qty?: number | null;
  send_plan_date?: string | null;
  planned_date?: string | null;
  responsible?: string | null;
  materials_note?: string | null;
  comment?: string | null;
}

/** Пустая строка вместо null — поле формы не должно становиться uncontrolled */
function text(v: string | number | null | undefined): string {
  return v === null || v === undefined ? '' : String(v);
}

/**
 * Черновик из СУЩЕСТВУЮЩИХ этапов позиции — для карточки заказа.
 *
 * `subByStage` необязателен: реестр подряда грузится лениво, и до его загрузки
 * конструктор обязан открываться — просто с пустыми подрядными полями, а не
 * с ошибкой. Затирания при сохранении это не даёт: `erp_route_apply` пишет
 * только присланные ключи.
 */
export function draftFromStages(
  stages: readonly StageLike[],
  deptCodeById: ReadonlyMap<string, string>,
  subByStage?: ReadonlyMap<string, SubcontractSeed>,
): RouteGroup[] {
  const byOrder = new Map<number, RouteGroup>();
  for (const s of [...stages].sort((a, b) => a.sort_order - b.sort_order)) {
    // Пропущенный этап в конструкторе не показываем: он уже выведен из маршрута
    if (s.status === 'skipped') continue;
    const group = byOrder.get(s.sort_order) ?? [];
    const sub = subByStage?.get(s.id);
    group.push({
      stageId: s.id,
      departmentCode: deptCodeById.get(s.department_id) ?? '',
      executor: s.executor === 'contractor' ? 'contractor' : 'internal',
      contractor: s.contractor ?? '',
      operation: s.operation ?? '',
      qty: text(sub?.qty),
      sendPlan: text(sub?.send_plan_date),
      returnPlan: text(sub?.planned_date),
      responsible: text(sub?.responsible),
      handover: text(sub?.materials_note),
      comment: text(sub?.comment),
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
  /** Координаты шага в черновике: группа и место внутри неё */
  gi: number;
  si: number;
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

  for (let gi = 0; gi < draft.length; gi += 1) {
    const group = draft[gi];
    const mine: number[] = [];
    for (let si = 0; si < group.length; si += 1) {
      const step = group[si];
      mine.push(out.length);
      /**
       * Координаты шага в черновике едут вместе с ним: по ним форма создания
       * адресует файлы подрядного шага (`stage:<позиция>:<группа>:<шаг>`).
       * Считать их отдельным обходом значило бы завести второй порядок этапов
       * рядом с этим — и однажды они разойдутся.
       */
      out.push({ step, sortOrder: sort, dependsOn: [...prevIndices], gi, si });
    }
    if (mine.length > 0) {
      prevIndices = mine;
      sort += 10;
    }
  }
  return out;
}

/**
 * Шаг черновика → поля этапа и его подрядного спутника для сервера.
 *
 * ОДНА функция на обоих писателей: `RouteEditor` (RPC `erp_route_apply`) и
 * `createOrder` (секция `items[].stages` в `erp_create_order`). Правило проекта
 * записано после того, как спутника подряда завели два места и разошлись бы
 * в первую правку: сервер их уже держит одним выражением, клиент обязан тоже.
 *
 * Пустая строка превращается в `null`, а не в пустое значение: «не заполнено»
 * и «заполнено пустым» на экране неразличимы, а в базе разные.
 */
export function stepPayload(step: RouteStep): {
  executor: 'internal' | 'contractor';
  contractor: string | null;
  operation: string | null;
  qty: number | null;
  send_plan_date: string | null;
  planned_date: string | null;
  responsible: string | null;
  materials_note: string | null;
  comment: string | null;
} {
  const contractor = step.executor === 'contractor';
  const str = (v: string) => (v.trim() ? v.trim() : null);
  const qty = Number(step.qty);
  return {
    executor: step.executor,
    contractor: contractor ? str(step.contractor) : null,
    operation: str(step.operation),
    // Подрядные поля у нашего этапа не хранятся вовсе: спутника у него нет,
    // и присланное значение молча пропало бы — хуже, чем не отправленное
    qty: contractor && step.qty.trim() && Number.isFinite(qty) && qty > 0 ? qty : null,
    send_plan_date: contractor ? str(step.sendPlan) : null,
    planned_date: contractor ? str(step.returnPlan) : null,
    responsible: contractor ? str(step.responsible) : null,
    materials_note: contractor ? str(step.handover) : null,
    comment: contractor ? str(step.comment) : null,
  };
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
      /**
       * Операция у подряда ОБЯЗАТЕЛЬНА (правки 20.08). Документ строит на ней
       * весь раздел: «название конкретной подрядной операции хранится внутри
       * карточки подрядного этапа и используется для поиска и фильтрации»,
       * и отдельных вкладок под варку и сублимацию не заводится именно потому,
       * что различает их это поле. Без него строка раздела подписывается
       * именем ЦЕХА — то есть «Цех ДТФ» там, где человек ищет «Сублимацию».
       */
      if (step.executor === 'contractor' && !step.operation.trim()) {
        issues.push({ group: gi, text: 'У подрядного этапа не указана операция' });
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
