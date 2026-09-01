import type { BrandingMethod, ErpExperimental, ErpExperimentalTask, ErpMaterial } from '../types';
import { isTaskReady, taskLabel } from './experimentalTasks';
import { BRANDING_DEPT, isMaterialPending, materialsForItem } from './routes';

/**
 * Доска экспериментального цеха ПО ЭТАПАМ (правки заказчика 20.08).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Главный экран экспериментального цеха должен быть
 * построен по этапам, по тому же принципу, как сейчас выглядит общий
 * производственный борд. Колонки: Построение лекал · Крой · Нанесения ·
 * Пошив · Финальный этап. Разработка перемещается между этапами по мере
 * выполнения работ».
 *
 * КАРТОЧКА НА ДОСКЕ — РАЗРАБОТКА, а не задача. Это следует из самого документа:
 * он перечисляет в карточке «текущую задачу» (значит, карточка не задача)
 * и говорит «разработка перемещается между этапами».
 *
 * ── КОЛОНКУ СТАВИТ ЧЕЛОВЕК (правка заказчика 24.08, п. 4.2) ─────────────────
 *
 * «Ответственный за проработку технолог сам вручную перетаскивает карточку
 * между колонками. Автоматическое движение по основным этапам не нужно».
 *
 * ЭТО ОБРАЩЕНИЕ ПРЕЖНЕГО РЕШЕНИЯ, и оно законно. Хранимая `phase` была удалена
 * 12.08, а в проекте записан запрет возвращать её под другим именем: два
 * источника правды разъезжаются. Довод был верен ровно потому, что движение
 * считалось АВТОМАТИЧЕСКИМ — хранимое и вычисленное отвечали на один вопрос
 * и могли ответить по-разному.
 *
 * Теперь вопрос другой. `board_stage` — НАМЕРЕНИЕ ТЕХНОЛОГА («я считаю, что
 * разработка на этом шаге»), а расчёт по задачам отвечает на вопрос «что
 * с работой»: он перестаёт определять колонку и продолжает питать дорожки
 * внутри неё и подписи узлов пути. Второго ответа на один вопрос не возникает.
 *
 * Поэтому и «пропуск нанесений» из документа не требует особого механизма:
 * технолог тащит карточку из «Кроя» в «Пошив», и это и есть решение.
 */

/**
 * Шаги доски, в порядке прохождения.
 *
 * ── «ОЖИДАЕТ МАТЕРИАЛЫ» — ШАГ, А НЕ ДОРОЖКА (правка заказчика 01.09, п. 1) ──
 *
 * «Если по заказу есть закупка и материал ещё не получен, система должна
 * разрешить перенести карточку только в „Ожидает материалы". Сразу в Крой
 * перенести нельзя».
 *
 * Дорожка `awaiting_materials` внутри колонки существует с волны материального
 * гейта и отвечает на вопрос «что с работой». Здесь спрашивают другое: КУДА
 * технолог вправе перенести карточку. До 01.09 ответ был «никуда» — выход
 * с лекал при незавершённой закупке блокировался целиком, и готовые лекала
 * стояли в одной колонке с недоделанными.
 *
 * КЛЮЧ `materials`, А НЕ `awaiting_materials`: последнее уже занято дорожкой,
 * и одноимённые колонка с дорожкой читались бы как одно и то же в двух разных
 * перечислениях — а отвечают они на разные вопросы.
 *
 * ШАГ НЕОБЯЗАТЕЛЬНЫЙ: заказ без закупки (или с уже принятым материалом) идёт
 * «Лекала → Крой» напрямую, документ разрешает это прямым текстом. Какие шаги
 * применимы к конкретной разработке, считает `devStagePath` в `devBoardMove`.
 */
export type DevStage =
  'patterns' | 'materials' | 'cutting' | 'branding' | 'sewing' | 'final';

export const DEV_STAGE_ORDER: DevStage[] = [
  'patterns', 'materials', 'cutting', 'branding', 'sewing', 'final',
];

export const DEV_STAGE_LABELS: Record<DevStage, string> = {
  patterns: 'Построение лекал',
  materials: 'Ожидает материалы',
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
/**
 * Типы задач, из которых состоит шаг «Нанесения» (п. 4.3).
 *
 * Перечень — ЕДИНСТВЕННЫЙ на клиенте и дословно повторён серверной функцией
 * `erp_dev_branding_task_types()`: по нему считается автопереход в «Пошив»,
 * и разойдись две половины, карточка либо застряла бы в «Нанесениях» навсегда
 * (сервер не считает тип нанесением), либо уехала в «Пошив» с незакрытой
 * работой. Сверяет `devBranding.test.ts`.
 *
 * `sublimation` в перечне есть, хотя документ называет только четыре вида:
 * выбор при входе предлагает четыре, а автопереход обязан учитывать ВСЕ
 * нанесения — иначе задача, заведённая руками через «Добавить задачу»,
 * повиснет незамеченной.
 */
export const DEV_BRANDING_TASK_TYPES = [
  'silkscreen', 'dtf', 'embroidery', 'dtg', 'sublimation',
] as const;

/**
 * НАНЕСЕНИЯ ОБРАЗЦА БЕРУТСЯ ИЗ ЗАКАЗА (правка заказчика 30.08, п. 2).
 *
 * Раньше при входе в «Нанесения» спрашивали виды заново
 * (`DEV_BRANDING_CHOICES` + `DevBrandingPicker`), хотя менеджер уже указал их
 * при создании заказа — в позиции, вместе с зоной, размерами и пантоном.
 * Второй ввод того же решения означал ровно то, о чём документ и пишет:
 * «исходные данные заказа теряются и маршрут можно сформировать повторно
 * некорректно».
 *
 * ПОРЯДОК — `seq` позиции, то есть порядок блоков «Нанесение №N» в форме
 * заказа. Он же задаёт `sort_order` задач, и он же — «тот же порядок,
 * который задан в заказе» из документа.
 *
 * Карта «метод → участок» переиспользуется из `utils/routes.BRANDING_DEPT` —
 * той же, по которой строится производственный маршрут. Вторая карта здесь
 * означала бы, что образец и серия однажды поедут разными цехами.
 * `heat_transfer` она сводит к `dtf`, а `other` — к `null`: у «прочих» своего
 * участка нет, их делают внутри швейки, и заводить под них задачу нанесения
 * нечем.
 *
 * Пустой массив — законный ответ: у позиции нет нанесений, и карточке
 * на этом шаге делать нечего (см. обработку в `Experimental`).
 */
export function devBrandingFromPrints(
  prints: readonly { method?: string | null; seq?: number | null }[] | null | undefined,
): string[] {
  const ordered = [...(prints ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const out: string[] = [];
  for (const p of ordered) {
    const code = p.method ? BRANDING_DEPT[p.method as BrandingMethod] : null;
    // дедупликация с сохранением порядка: два нанесения одним методом —
    // одна задача цеху, как и в производственном маршруте
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

/**
 * Вид нанесения → код участка, в чью общую очередь уходит работа
 * («после выбора работа появляется в соответствующей общей очереди нужного
 * цеха», п. 4.3).
 *
 * Соответствие объявлено ЯВНО, хотя коды сегодня совпадают один в один:
 * молчаливое совпадение имён — не правило, а совпадение, и первое же
 * переименование участка в админке отправило бы задачу в никуда, причём
 * без единой ошибки.
 *
 * `sublimation` сюда не входит: своего участка у неё нет, и отправляют её
 * обычной формой «Передать в цех», где участок выбирают руками.
 */
export const DEV_BRANDING_DEPT_CODE: Record<string, string> = {
  silkscreen: 'silkscreen',
  dtf: 'dtf',
  embroidery: 'embroidery',
  dtg: 'dtg',
};

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

/**
 * Подпись действия «завершить» ПО ИМЕНИ ЭТАПА (правка 23.08, п. 7):
 * «Завершить лекала», «Завершить крой», «Завершить нанесения»,
 * «Завершить пошив». Живёт рядом с `DEV_STAGE_LABELS`, а не в компоненте:
 * вторая таблица названий разошлась бы с первой в первую же правку.
 */
export const DEV_STAGE_COMPLETE_LABELS: Record<DevStage, string> = {
  patterns: 'Завершить лекала',
  // Задач у ожидания материалов не бывает, и `devStageAction` не предлагает
  // здесь ничего: шаг заканчивается переносом карточки, а не действием.
  // Подпись всё равно объявлена — `Record<DevStage, …>` не терпит пропуска,
  // и это ровно та проверка, ради которой тип записан полным.
  materials: 'Материалы получены',
  cutting: 'Завершить крой',
  branding: 'Завершить нанесения',
  sewing: 'Завершить пошив',
  final: 'Завершить этап',
};

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
  dev: Pick<ErpExperimental, 'item_id' | 'outcome'> & {
    sample_approved_at?: string | null;
    /** Колонка, поставленная человеком, — ею считается «шаг уже пройден» */
    board_stage?: DevStage | null;
  };
  tasks: readonly ErpExperimentalTask[];
  /** Материалы ЗАКАЗА разработки — гейт кроя смотрит на них */
  materials?: readonly ErpMaterial[] | null;
  /** У заказа есть незакрытый этап участка «Закупка» (правка 01.09, п. 1) */
  supplyOpen?: boolean;
  /**
   * В ПОЗИЦИИ ЗАКАЗА указаны нанесения (правка 01.09, п. 2).
   *
   * До 01.09 применимость «Нанесений» считалась по ЗАДАЧАМ, а задачи заводятся
   * только при входе в колонку: до входа шаг числился пропущенным, и запрет
   * «из Кроя нельзя сразу в Пошив, если в заказе есть нанесения» опереть было
   * не на что. Признак берётся оттуда же, откуда виды нанесений образца, —
   * из `prints` позиции (`devBrandingFromPrints`).
   */
  hasBranding?: boolean;
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
 *
 * УСЛОВИЙ ДВА (правка заказчика 01.09, п. 1): «система должна разрешать это
 * только после того, как ЗАКУПКА ЗАВЕРШЕНА и МАТЕРИАЛ ПОЛУЧЕН». Это не одно
 * и то же, и разойтись они могут в обе стороны: у заказа бывает открытый этап
 * закупки при нуле строк материалов (закупщик ещё не завёл их — на проде таких
 * заказов девять), и бывает закрытая закупка при материале, который ждёт
 * приёмки складом. Признак «этап закупки открыт» приходит параметром
 * (`supplyOpen`) по той же причине, по какой сюда не тянется `isStageReady`:
 * считать его умеет `utils/supply.openSupplyStages`, и второй копии этого
 * правила здесь заводить нельзя. Закупка, которая не требуется вовсе, этапа
 * не имеет по построению — `supplyOpen` там `false` сам собой.
 */
export function cuttingGate(input: {
  patternsDone: boolean;
  itemId?: string | null;
  materials?: readonly ErpMaterial[] | null;
  /** У заказа есть незакрытый этап участка «Закупка» */
  supplyOpen?: boolean;
}): { open: boolean; wait: CuttingWait; missing: ErpMaterial[] } {
  const mine = materialsForItem(
    (input.materials ?? []) as ErpMaterial[], input.itemId ?? null);
  const missing = mine.filter(isMaterialPending);
  const noMaterials = missing.length > 0 || input.supplyOpen === true;
  const wait: CuttingWait = !input.patternsDone && noMaterials
    ? 'both'
    : !input.patternsDone
      ? 'patterns'
      : noMaterials
        ? 'materials'
        : null;
  return { open: wait === null, wait, missing };
}

/**
 * Подпись гейта кроя. Лекала называем ПЕРВЫМИ: этим ЭКС управляет сам.
 *
 * `supplyOpen` нужен здесь ради ЧЕСТНОСТИ ОТКАЗА. Заказ с открытой закупкой
 * и ещё не заведёнными строками материалов держит крой, но перечислять нечего,
 * и без этого признака человек читал бы «Ожидает материалы» ни о чём — то есть
 * не понимал бы, кого ждать и кому звонить.
 */
export function cuttingWaitLabel(
  wait: CuttingWait,
  missing: readonly ErpMaterial[] = [],
  supplyOpen = false,
): string | null {
  if (wait === null) return null;
  const names = missing.map((m) => m.name).filter(Boolean).join(', ');
  if (wait === 'patterns') return 'Ожидает лекала';
  const mat = names
    ? `Ожидает материалы: ${names}`
    : (supplyOpen ? 'Ожидает закупку: она ещё не завершена' : 'Ожидает материалы');
  return wait === 'materials' ? mat : `Ожидает лекала и ${mat.toLowerCase()}`;
}

/** Применим ли шаг к этой разработке */
function stageApplies(
  stage: DevStage,
  byStage: Map<DevStage, ErpExperimentalTask[]>,
  ctx: { hasBranding: boolean; materialsHold: boolean; standsHere: boolean },
): boolean {
  /**
   * «Нанесения» применимы, если задача нанесения ЕСТЬ ИЛИ они указаны
   * в позиции заказа. У образца без печати эта колонка не должна вечно
   * светиться ожиданием: документ добавляет нанесения по потребности
   * («если образцу нужна вышивка»). А вот у образца, которому печать
   * заказана, шаг обязателен ещё ДО того, как заведена первая задача, —
   * иначе «нельзя из Кроя сразу в Пошив» не на что опереть (правка 01.09,
   * п. 2).
   */
  if (stage === 'branding') {
    return ctx.hasBranding || (byStage.get('branding') ?? []).length > 0;
  }
  /**
   * «Ожидает материалы» — шаг стоянки: он применим, пока материалы держат
   * либо пока карточка на нём стоит. Заказ, где ждать нечего, идёт мимо,
   * и шаг читается «не требовался», а не «пропущен».
   */
  if (stage === 'materials') return ctx.materialsHold || ctx.standsHere;
  return true;
}

/**
 * Состояния всех шагов доски.
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

  /**
   * ШАГ, КОТОРЫЙ ЧЕЛОВЕК УЖЕ ПРОШЁЛ РУКАМИ (правка заказчика 30.08, п. 3).
   *
   * Обязательных задач этапов больше не создаётся, и у «Построения лекал»
   * задач обычно НЕТ вовсе. Документ требует: переход «Лекала → Крой»
   * должен «отметить этап завершённым и перевести карточку в „Крой"» —
   * а состояние шага считается из задач, которых нет. Без этого признака
   * исполнялась бы ровно половина требования: карточка переезжает, а маршрут
   * до конца разработки показывает лекала незакрытыми, и гейт кроя вечно
   * отвечает «Ожидает лекала».
   *
   * Источник правды по-прежнему один: колонку ставит человек
   * (`board_stage`), а расчёт отвечает на «что с работой».
   */
  const manualIdx = DEV_STAGE_ORDER.indexOf(input.dev.board_stage as DevStage);
  const passedByHand = (stage: DevStage): boolean => manualIdx >= 0
    && DEV_STAGE_ORDER.indexOf(stage) < manualIdx;

  const patternsDone = passedByHand('patterns')
    || ((byStage.get('patterns') ?? []).length > 0
      && (byStage.get('patterns') ?? []).every((t) => CLOSED.has(t.status)));

  /** Есть ли работа на шагах ПОСЛЕ указанного — признак «шаг перепрыгнули» */
  const workLater = (stage: DevStage): boolean => {
    const from = DEV_STAGE_ORDER.indexOf(stage) + 1;
    return DEV_STAGE_ORDER.slice(from).some(
      (s) => (byStage.get(s) ?? []).some((t) => t.status !== 'todo'),
    );
  };

  /**
   * Материальный гейт считается ОДИН РАЗ на всю разработку: его читают два
   * шага — «Ожидает материалы» (как причину стоянки) и «Крой» (как запрет
   * начинать). Два вызова разошлись бы ровно в тот день, когда у одного
   * из них забыли бы аргумент.
   */
  const materialGate = cuttingGate({
    patternsDone: true,
    itemId: input.dev.item_id,
    materials: input.materials,
    supplyOpen: input.supplyOpen,
  });
  const stageCtx = {
    hasBranding: input.hasBranding === true,
    materialsHold: !materialGate.open,
    standsHere: input.dev.board_stage === 'materials',
  };

  return DEV_STAGE_ORDER.map((stage) => {
    const own = byStage.get(stage) ?? [];
    const gate = stage === 'cutting'
      ? cuttingGate({
        patternsDone,
        itemId: input.dev.item_id,
        materials: input.materials,
        supplyOpen: input.supplyOpen,
      })
      : null;

    /**
     * ШАГ «ОЖИДАЕТ МАТЕРИАЛЫ» — СВОЯ ВЕТКА, И СТОИТ ОНА ВЫШЕ ОБЩИХ (правка
     * 01.09, п. 1). Задач у него не бывает никогда, поэтому общий разбор
     * увёл бы его в `workLater` — «шаг перепрыгнули», — хотя перепрыгивать
     * там нечего: это стоянка, а не работа.
     */
    if (stage === 'materials') {
      if (!stageApplies(stage, byStage, stageCtx)) {
        return { stage, lane: 'skipped' as DevLane, tasks: own, waitingReason: null };
      }
      if (passedByHand(stage)) {
        return { stage, lane: 'done' as DevLane, tasks: own, waitingReason: null };
      }
      return materialGate.open
        // Материалы приехали — стоянка кончилась, карточку пора двигать в «Крой»
        ? { stage, lane: 'ready' as DevLane, tasks: own, waitingReason: null }
        : {
          stage,
          lane: 'awaiting_materials' as DevLane,
          tasks: own,
          waitingReason: cuttingWaitLabel(
            'materials', materialGate.missing, input.supplyOpen === true),
        };
    }

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
      // Нанесений у образца нет вовсе — шаг не пропускали, его не было в плане
      if (!stageApplies(stage, byStage, stageCtx)) {
        return { stage, lane: 'skipped' as DevLane, tasks: own, waitingReason: null };
      }
      /**
       * Человек уже перенёс карточку дальше — этап пройден его решением,
       * и слово «Пропущено» здесь было бы неправдой: у лекал записано
       * техническое название, то есть работа сделана и зафиксирована.
       */
      if (passedByHand(stage)) {
        return { stage, lane: 'done' as DevLane, tasks: own, waitingReason: null };
      }
      // Легаси: у разработки нет задач этого типа вовсе, а дальше работа идёт
      if (workLater(stage)) {
        return { stage, lane: 'skipped' as DevLane, tasks: own, waitingReason: null };
      }
    }
    if (gate && !gate.open) {
      return {
        stage,
        lane: (gate.wait === 'patterns' ? 'waiting' : 'awaiting_materials') as DevLane,
        tasks: own,
        waitingReason: cuttingWaitLabel(
          gate.wait, gate.missing, input.supplyOpen === true),
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
 * ЗАДАЧИ ВНЕ КЛЮЧЕВЫХ ЭТАПОВ (правка 22.08, пп. 4.5–4.7).
 *
 * Документ разделяет два вида работы, и это ключевое различие всего раздела:
 * ключевые этапы ДВИГАЮТ разработку по канбану, а дополнительные задачи
 * («доработать рукав +2 см», «подобрать другую ткань», «проверить молнию»)
 * — внутренний список технолога, который структуру доски не меняет вовсе.
 *
 * Сейчас в карточке они лежат ОДНИМ списком, и потому читаются как одна
 * сущность: «канбан и список задач конкурируют друг с другом» — дословная
 * формулировка претензии. Отбор здесь один на карточку: `devStageOfTask`
 * уже знает, какие типы задач шагами являются, и вторая таблица соответствий
 * рядом разошлась бы с первой.
 */
export function extraTasks<T extends { task_type: string }>(
  tasks: readonly T[] | null | undefined,
): T[] {
  return (tasks ?? []).filter((t) => devStageOfTask(t.task_type) === null);
}

/** Что можно сделать с ключевым этапом прямо сейчас */
export type DevStageActionKey = 'start' | 'complete' | null;

export interface DevStageAction {
  key: DevStageActionKey;
  label: string;
  /** Почему действия нет — показывается вместо кнопки */
  reason: string | null;
}

/**
 * ДЕЙСТВИЕ КЛЮЧЕВОГО ЭТАПА (правка 22.08, пп. 4.3 и 4.12).
 *
 * «Пользователь открывает текущий этап и выполняет действие типа Начать
 * работу… После выполнения обязательных условий этап завершается и разработка
 * становится доступна на следующем ключевом этапе».
 *
 * ВТОРОЙ МЕХАНИКИ ЗДЕСЬ НЕТ, и это прямое требование документа. Функция
 * ничего не решает сама: она читает УЖЕ ПОСЧИТАННОЕ состояние шага
 * (`devStageStates` — те же гейты, зависимости и статусы, что на доске)
 * и называет, какое из двух действий над задачами шага доступно. Само
 * действие — обычная смена статуса задач, тем же `updateDevTask`, каким
 * технолог двигает их поштучно.
 *
 * Отсюда же берётся «сопоставить канбан и внутренний прогресс» (п. 4.15):
 * внутри карточки и на доске состояние считает ОДНА функция.
 */
export function devStageAction(state: DevStageState): DevStageAction {
  if (state.lane === 'done') return { key: null, label: '', reason: 'Этап завершён' };
  if (state.lane === 'skipped') {
    /**
     * «Не требуется» ≠ «Пропущен» (п. 7). Необязательный этап нанесений,
     * которого у этой разработки нет вовсе, не пропускали — его не было
     * в плане, и после кроя карточка уйдёт сразу в пошив. Слово «пропущен»
     * читалось бы как «работу не сделали».
     */
    return {
      key: null,
      label: '',
      reason: state.stage === 'branding' && state.tasks.length === 0
        ? 'Не требуется — будет пропущен автоматически'
        : 'Этап пропущен',
    };
  }
  if (state.tasks.length === 0) {
    return {
      key: null,
      label: '',
      // Пустой этап завершать нечем: сначала должна появиться работа
      reason: 'Задач этапа нет — заведите работу этого этапа',
    };
  }
  if (state.lane === 'waiting' || state.lane === 'awaiting_materials' || state.lane === 'blocked') {
    return { key: null, label: '', reason: state.waitingReason ?? 'Ожидает' };
  }
  /**
   * `in_progress` — часть работы взята. Завершить этап можно, только когда
   * закрыты ВСЕ обязательные задачи шага: «когда обе задачи завершены,
   * основной этап считается завершённым» (п. 4.8). Само это условие
   * проверяет вызывающий по списку `state.tasks` — здесь мы называем
   * действие, а не выполняем.
   */
  if (state.lane === 'in_progress') {
    return { key: 'complete', label: DEV_STAGE_COMPLETE_LABELS[state.stage], reason: null };
  }
  return { key: 'start', label: 'Начать работу', reason: null };
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
  dev: {
    outcome?: string | null;
    sample_approved_at?: string | null;
    board_stage?: string | null;
  },
): DevStage {
  /**
   * ЗАКРЫТАЯ РАЗРАБОТКА — ВСЕГДА «ФИНАЛЬНЫЙ ЭТАП», и это сильнее ручного
   * переноса: «после завершения разработка уходит из активного канбана
   * в завершённые» (п. 4.5). Перетащить закрытую разработку назад значило бы
   * объявить её незакрытой одним движением пальца.
   */
  if (dev.outcome) return 'final';
  /**
   * РУЧНОЙ ПЕРЕНОС ПЕРЕБИВАЕТ РАСЧЁТ (п. 4.2: «технолог сам вручную
   * перетаскивает карточку… автоматическое движение по основным этапам
   * не нужно»). Расчёт остаётся ответом на другой вопрос — «что с работой»:
   * он питает дорожки внутри колонки и подписи узлов пути.
   *
   * Отсюда же «пропуск нанесений» без единой строки особого кода: технолог
   * тащит карточку из «Кроя» в «Пошив», и это и есть решение.
   */
  if (isDevStage(dev.board_stage)) return dev.board_stage;
  // Не двигали руками — прежний расчёт, дословно. Заведённые раньше
  // разработки в момент выкладки не прыгают: `board_stage` у них пуст
  if (dev.sample_approved_at) return 'final';
  const open = states.find((s) => s.lane !== 'done' && s.lane !== 'skipped');
  return open?.stage ?? 'final';
}

/** Значение из базы — шаг доски? Зеркало CHECK `erp_experimental_board_stage_check` */
export function isDevStage(value: unknown): value is DevStage {
  return typeof value === 'string' && (DEV_STAGE_ORDER as string[]).includes(value);
}

/**
 * PROGRESS-STEPPER МАРШРУТА РАЗРАБОТКИ (правка 23.08, п. 7).
 *
 * «В верхней части полноэкранной карточки показать понятный progress-stepper:
 * Лекала → Крой → Нанесения → Пошив → Финальный этап. У каждого этапа
 * визуально показывать состояние: завершён / в работе / ожидает / пропущен.
 * Маршрут должен быть понятен с первого экрана без необходимости искать
 * действие внизу карточки».
 *
 * Узлы считаются ИЗ ТЕХ ЖЕ `devStageStates`, что рисуют доску: «пользователь
 * должен одинаково понимать текущий этап на канбане и внутри карточки».
 * Второй таблицы состояний здесь нет и быть не должно.
 */
export interface DevStepNode {
  key: DevStage;
  label: string;
  sub: string;
  state: 'done' | 'active' | 'blocked' | 'skipped' | undefined;
  lineDone: boolean;
  title: string;
}

export function devRouteSteps(
  states: readonly DevStageState[],
  currentStage: DevStage,
): DevStepNode[] {
  return states.map((st, i) => {
    /**
     * «НЕ ТРЕБУЕТСЯ» ≠ «ПРОПУЩЕНО». Необязательный шаг, которого у этой
     * разработки не было в плане вовсе, не пропускали: слово «пропущено»
     * читалось бы как «работу не сделали». Таких шага два — нанесения
     * у образца без печати и стоянка «Ожидает материалы» у заказа, где
     * ждать нечего. Перечислены поимённо: у обычного шага без задач
     * (легаси-разработка, работа ушла вперёд) «Пропущено» — правда.
     */
    const skippedOptional = st.lane === 'skipped'
      && (st.stage === 'branding' || st.stage === 'materials')
      && st.tasks.length === 0;
    const isCurrent = st.stage === currentStage;
    /**
     * «В работе» — это ТЕКУЩИЙ шаг, а не только `in_progress` задач: шаг,
     * до которого дошла разработка, но работу в котором ещё не начали,
     * с точки зрения маршрута всё равно текущий. Иначе stepper показывал бы
     * «ожидает» у всех пяти шагов сразу — и не отвечал бы, где разработка.
     */
    const state: DevStepNode['state'] = st.lane === 'done'
      ? 'done'
      : st.lane === 'blocked'
        ? 'blocked'
        : st.lane === 'skipped'
          ? 'skipped'
          : isCurrent ? 'active' : undefined;
    const sub = st.lane === 'done'
      ? 'Завершено'
      : st.lane === 'blocked'
        ? (st.waitingReason ?? 'С проблемой')
        : skippedOptional
          ? 'Не требуется'
          : st.lane === 'skipped'
            ? 'Пропущено'
            : isCurrent
              ? (st.lane === 'in_progress' ? 'В работе' : (st.waitingReason ?? 'Можно начинать'))
              : 'Ожидает';
    return {
      key: st.stage,
      label: DEV_STAGE_LABELS[st.stage],
      sub,
      state,
      // Соединитель закрашен, когда ПРЕДЫДУЩИЙ шаг пройден или не требовался
      lineDone: i > 0 && (states[i - 1].lane === 'done' || states[i - 1].lane === 'skipped'),
      title: `${DEV_STAGE_LABELS[st.stage]}: ${sub}`,
    };
  });
}
