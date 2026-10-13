import { describe, expect, it } from 'vitest';
import type { ErpExperimentalTask, ErpMaterial } from '../types';
import {
  DEV_STAGE_ORDER,
  cuttingGate,
  cuttingWaitLabel,
  devBoardColumn,
  devStageOfTask,
  devStageAction,
  devRouteSteps,
  devStageQueue,
  devStageStates,
  experimentalEntries,
  extraTasks,
} from './experimentalBoard';

/**
 * Проверочный сценарий документа 20.08 идёт здесь дословно: новая футболка,
 * нужны новые лекала, новая ткань и вышивка. Задача на лекала появляется
 * сразу; закупка ткани идёт ПАРАЛЛЕЛЬНО; крой ждёт и лекала, и материал.
 */

const task = (over: Partial<ErpExperimentalTask> = {}): ErpExperimentalTask => ({
  id: 't1', experimental_id: 'e1', task_type: 'patterns', title: null,
  responsible: null, due_date: null, status: 'todo', blocked_reason: null,
  depends_on: [], cycle: 0, sort_order: 10, qty: null, comment: null, result: null,
  department_id: null, stage_id: null, done_on: null,
  created_at: '', updated_at: '', ...over,
});

const material = (over: Partial<ErpMaterial> = {}): ErpMaterial => ({
  id: 'm1', order_id: 'o1', item_id: null, kind: 'fabric', name: 'Кулирка',
  source: 'purchase', supplier: null, role: null, color: null, article: null,
  qty: null, status: 'pending', eta_date: null, received_at: null, notes: null,
  qty_expected: null, qty_received: null, fact_name: null, fact_color: null,
  fact_article: null, accept_status: null, accepted_at: null, accepted_by: null,
  accept_comment: null, created_at: '', updated_at: '', ...over,
});

const dev = (over = {}) => ({ item_id: 'i1', outcome: null, ...over });
const laneOf = (states: ReturnType<typeof devStageStates>, stage: string) =>
  states.find((s) => s.stage === stage)!.lane;

describe('тип задачи → шаг доски', () => {
  it('нанесения всех участков попадают в одну колонку', () => {
    for (const t of ['dtf', 'dtg', 'silkscreen', 'embroidery', 'sublimation']) {
      expect(devStageOfTask(t)).toBe('branding');
    }
  });

  it('примерка и доработка шагами НЕ являются', () => {
    // Документ разрешает прямо: «отдельную постоянную колонку под примерку
    // делать не обязательно — это может быть статус или действие в карточке»
    expect(devStageOfTask('fitting')).toBeNull();
    expect(devStageOfTask('rework')).toBeNull();
  });

  it('материалы и фурнитура идут параллельно и этапы не двигают', () => {
    // Именно поэтому лекала не ждут материал: у них разные дорожки
    expect(devStageOfTask('material')).toBeNull();
    expect(devStageOfTask('hardware')).toBeNull();
  });

  it('неизвестный тип не роняет доску', () => {
    // Справочник свободный: технолог вправе завести «Сублимация на молнии»
    expect(devStageOfTask('лазерная резка')).toBeNull();
    expect(devStageOfTask(null)).toBeNull();
  });
});

describe('гейт кроя: лекала И материал', () => {
  it('нет ни лекал, ни материала', () => {
    const g = cuttingGate({ patternsDone: false, itemId: 'i1', materials: [material()] });
    expect(g.open).toBe(false);
    expect(g.wait).toBe('both');
  });

  it('лекала есть, материала нет', () => {
    const g = cuttingGate({ patternsDone: true, itemId: 'i1', materials: [material()] });
    expect(g.wait).toBe('materials');
    expect(cuttingWaitLabel(g.wait, g.missing)).toBe('Ожидает материалы: Кулирка');
  });

  it('материал принят, лекал нет', () => {
    const accepted = material({ status: 'received', accept_status: 'accepted_full' });
    const g = cuttingGate({ patternsDone: false, itemId: 'i1', materials: [accepted] });
    expect(g.wait).toBe('patterns');
    expect(cuttingWaitLabel(g.wait)).toBe('Ожидает лекала');
  });

  it('оба условия выполнены — крой открыт', () => {
    const accepted = material({ status: 'received', accept_status: 'accepted_full' });
    expect(cuttingGate({ patternsDone: true, itemId: 'i1', materials: [accepted] }).open)
      .toBe(true);
  });

  it('пришедший, но НЕ принятый материал крой не открывает', () => {
    // То же правило, что в производстве: `received` без `accept_status`
    // гейт не снимает — недостача и пересорт держат закрой
    const g = cuttingGate({
      patternsDone: true, itemId: 'i1',
      materials: [material({ status: 'received' })],
    });
    expect(g.wait).toBe('materials');
  });

  it('материал чужой позиции крой не держит', () => {
    const g = cuttingGate({
      patternsDone: true, itemId: 'i1',
      materials: [material({ item_id: 'i2' })],
    });
    expect(g.open).toBe(true);
  });

  /**
   * Условий в документе 01.09 ДВА: «закупка завершена И материал получен».
   * Разойтись они могут в обе стороны — у заказа бывает открытый этап закупки
   * при нуле строк материалов, и закрытая закупка при непринятом материале.
   */
  it('открытый этап закупки держит крой сам по себе', () => {
    const g = cuttingGate({
      patternsDone: true, itemId: 'i1', materials: [], supplyOpen: true,
    });
    expect(g.open).toBe(false);
    expect(g.wait).toBe('materials');
    // Перечислять нечего — отказ обязан назвать закупку, иначе он ни о чём
    expect(cuttingWaitLabel(g.wait, g.missing, true))
      .toBe('Ожидает закупку: она ещё не завершена');
  });

  it('закупка закрыта и материал принят — крой открыт', () => {
    const g = cuttingGate({
      patternsDone: true,
      itemId: 'i1',
      materials: [material({ status: 'received', accept_status: 'accepted_full' })],
      supplyOpen: false,
    });
    expect(g.open).toBe(true);
  });
});

/**
 * ДОРОЖКА «НЕ ТРЕБУЕТСЯ» (`not_applicable`) — правка 03.09.
 *
 * Названия проверок ниже говорили «не требуется, а не пропущено» с 23.08,
 * а утверждали `lane === 'skipped'`, подпись которого — «Пропущено».
 * Слово, которое читал человек на доске ЭКС, расходилось с тем, что
 * проверяли эти же тесты. Теперь дорожка называет состояние сама, а список
 * имён шагов («branding или materials без задач») из `devRouteSteps` убран
 * за ненадобностью.
 */
describe('состояния шагов', () => {
  it('лекала НЕ ждут материал — это единственное исключение документа', () => {
    const states = devStageStates({
      dev: dev(),
      tasks: [task({ id: 'p', task_type: 'patterns' })],
      materials: [material()],
    });
    expect(laneOf(states, 'patterns')).toBe('ready');
    expect(laneOf(states, 'cutting')).toBe('awaiting_materials');
  });

  it('крой ждёт лекала, пока они не закрыты', () => {
    const states = devStageStates({
      dev: dev(),
      tasks: [
        task({ id: 'p', task_type: 'patterns', status: 'in_progress' }),
        task({ id: 'c', task_type: 'cutting', sort_order: 20 }),
      ],
      materials: [material({ status: 'received', accept_status: 'accepted_full' })],
    });
    expect(laneOf(states, 'cutting')).toBe('waiting');
    expect(states.find((s) => s.stage === 'cutting')!.waitingReason).toBe('Ожидает лекала');
  });

  it('блокировка перебивает всё остальное', () => {
    const states = devStageStates({
      dev: dev(),
      tasks: [task({
        id: 'p', task_type: 'patterns', status: 'blocked', blocked_reason: 'нет мерок',
      })],
    });
    expect(laneOf(states, 'patterns')).toBe('blocked');
    expect(states[0].waitingReason).toBe('нет мерок');
  });

  it('переданная в цех задача ждёт ЦЕХ, а не зависимости', () => {
    const states = devStageStates({
      dev: dev(),
      tasks: [task({
        id: 'b', task_type: 'embroidery', status: 'waiting', stage_id: 's1', sort_order: 30,
      })],
    });
    expect(laneOf(states, 'branding')).toBe('waiting');
    expect(states.find((s) => s.stage === 'branding')!.waitingReason).toBe('Передано в цех');
  });

  it('колонка «Нанесения» не светится у образца без печати', () => {
    const states = devStageStates({ dev: dev(), tasks: [task({ id: 'p' })] });
    expect(laneOf(states, 'branding')).toBe('not_applicable');
  });

  it('шаг, который перепрыгнули, помечен пропущенным', () => {
    /**
     * Разработка, заведённая до 20.08: задач типа `cutting` у неё нет вовсе,
     * а работа идёт на пошиве. Без этого правила она застряла бы в «Крое»
     * навсегда — и доска врала бы про весь старый набор.
     */
    const states = devStageStates({
      dev: dev(),
      tasks: [
        task({ id: 'p', task_type: 'patterns', status: 'done' }),
        task({ id: 's', task_type: 'sample', status: 'in_progress', sort_order: 40 }),
      ],
    });
    expect(laneOf(states, 'cutting')).toBe('skipped');
    expect(devBoardColumn(states, dev())).toBe('sewing');
  });

  /**
   * П. 3 документа 30.08: переход «Лекала → Крой» обязан «отметить этап
   * завершённым и перевести карточку в „Крой"». Обязательных задач этапов
   * больше не создаётся, поэтому без признака «человек прошёл шаг руками»
   * исполнялась бы ровно половина: карточка переезжает, а лекала до конца
   * разработки числятся незакрытыми.
   */
  it('шаг, пройденный человеком вручную, ЗАВЕРШЁН, а не пропущен', () => {
    const states = devStageStates({
      dev: dev({ board_stage: 'cutting' }),
      tasks: [],
      materials: [material({ status: 'received', accept_status: 'accepted_full' })],
    });
    expect(laneOf(states, 'patterns')).toBe('done');
    // И гейт кроя больше не отвечает «Ожидает лекала» — иначе крой
    // не начался бы никогда
    expect(laneOf(states, 'cutting')).toBe('ready');
  });

  it('нанесений у образца нет — шаг всё равно «не требуется», а не завершён', () => {
    const states = devStageStates({
      dev: dev({ board_stage: 'sewing' }),
      tasks: [],
    });
    expect(laneOf(states, 'branding')).toBe('not_applicable');
  });
});

describe('колонка разработки', () => {
  it('пустая разработка стоит на первом шаге, а не исчезает', () => {
    const states = devStageStates({ dev: dev(), tasks: [] });
    expect(devBoardColumn(states, dev())).toBe('patterns');
  });

  it('утверждённый образец переводит в финальный этап', () => {
    // Документ: «после утверждения образца разработка переходит в колонку
    // "Финальный этап"» — и дозаведённая задача нанесения её не утащит назад
    const d = dev({ sample_approved_at: '2026-08-20T10:00:00Z' });
    const states = devStageStates({ dev: d, tasks: [task({ id: 'b', task_type: 'dtf' })] });
    expect(devBoardColumn(states, d)).toBe('final');
  });

  it('закрытая разработка — финальный этап', () => {
    const d = dev({ outcome: 'ready_for_serial' });
    expect(devBoardColumn(devStageStates({ dev: d, tasks: [] }), d)).toBe('final');
  });

  it('порядок колонок — из документа', () => {
    // «Ожидает материалы» между лекалами и кроем — правка 01.09, п. 1
    expect(DEV_STAGE_ORDER).toEqual(
      ['patterns', 'materials', 'cutting', 'branding', 'sewing', 'final']);
  });
});

/**
 * ШАГ «ОЖИДАЕТ МАТЕРИАЛЫ» (правка заказчика 01.09, п. 1).
 *
 * «Если по заказу есть закупка и материал ещё не получен, система должна
 * разрешить перенести карточку только в „Ожидает материалы"… Если материал уже
 * получен, доступен со склада или закупка вообще не требуется, карточку можно
 * сразу переносить в Крой».
 */
describe('шаг «Ожидает материалы»', () => {
  const accepted = material({ status: 'received', accept_status: 'accepted_full' });

  it('материал держат — шаг ждёт и называет причину', () => {
    const states = devStageStates({ dev: dev(), tasks: [], materials: [material()] });
    expect(laneOf(states, 'materials')).toBe('awaiting_materials');
    expect(states.find((s) => s.stage === 'materials')!.waitingReason)
      .toContain('Ожидает материалы');
  });

  it('закупка заказа не закрыта — держит и она, даже без строк материалов', () => {
    // На проде есть активные заказы с открытым этапом закупки и НУЛЁМ строк
    // материалов: условий в документе два, и они расходятся в обе стороны
    const states = devStageStates({
      dev: dev(), tasks: [], materials: [], supplyOpen: true,
    });
    expect(laneOf(states, 'materials')).toBe('awaiting_materials');
    expect(states.find((s) => s.stage === 'materials')!.waitingReason)
      .toBe('Ожидает закупку: она ещё не завершена');
  });

  it('материал приехал — стоянка кончилась, карточку пора двигать', () => {
    const states = devStageStates({
      dev: dev({ board_stage: 'materials' }), tasks: [], materials: [accepted],
    });
    expect(laneOf(states, 'materials')).toBe('ready');
  });

  it('ждать нечего — шаг НЕ ТРЕБОВАЛСЯ, а не пропущен', () => {
    // Заказ без закупки идёт «Лекала → Крой» напрямую: документ разрешает
    // это прямым текстом, и слово «пропущено» тут читалось бы как «не сделали»
    const states = devStageStates({
      dev: dev(), tasks: [], materials: [accepted],
    });
    expect(laneOf(states, 'materials')).toBe('not_applicable');
  });

  it('шаг, пройденный руками, завершён — даже если материал снова ждут', () => {
    const states = devStageStates({
      dev: dev({ board_stage: 'cutting' }), tasks: [], materials: [material()],
    });
    expect(laneOf(states, 'materials')).toBe('done');
  });

  it('работа на следующих шагах стоянку пропущенной НЕ делает', () => {
    // Ловушка `workLater`: задач у стоянки не бывает никогда, и общий разбор
    // объявил бы её перепрыгнутой — хотя перепрыгивать там нечего
    const states = devStageStates({
      dev: dev({ board_stage: 'materials' }),
      tasks: [task({ id: 's', task_type: 'sample', status: 'in_progress', sort_order: 40 })],
      materials: [material()],
    });
    expect(laneOf(states, 'materials')).toBe('awaiting_materials');
  });
});

/**
 * Нанесения обязательны, если они указаны в ЗАКАЗЕ (правка 01.09, п. 2).
 * До правки применимость шага считалась по задачам, а задачи заводятся только
 * при входе в колонку: до входа шаг числился пропущенным, и запрет «из Кроя
 * нельзя сразу в Пошив» опереть было не на что.
 */
describe('применимость шага «Нанесения»', () => {
  it('нанесения заказаны — шаг ждёт своей очереди, а не пропущен', () => {
    const states = devStageStates({
      dev: dev({ board_stage: 'cutting' }), tasks: [], hasBranding: true,
    });
    expect(laneOf(states, 'branding')).not.toBe('not_applicable');
  });

  it('нанесений в заказе нет — шаг по-прежнему «не требуется»', () => {
    const states = devStageStates({
      dev: dev({ board_stage: 'cutting' }), tasks: [], hasBranding: false,
    });
    expect(laneOf(states, 'branding')).toBe('not_applicable');
  });
});

/**
 * Внутренние представления раздела (документ 20.08): «Лекала, крой и пошив
 * работают как собственные очереди экспериментального цеха. Шелкография, DTF,
 * вышивка и DTG являются отфильтрованными представлениями общих задач».
 */
describe('внутренние очереди ЭКС', () => {
  const row = (id: string, tasks: ErpExperimentalTask[]) => ({ dev: { id }, tasks });

  it('очередь шага собирает задачи по ВСЕМ разработкам', () => {
    const list = devStageQueue([
      row('d1', [task({ id: 'a', task_type: 'patterns' })]),
      row('d2', [
        task({ id: 'b', task_type: 'patterns' }),
        task({ id: 'c', task_type: 'sample' }),
      ]),
    ], 'patterns');
    expect(list.map((x) => x.task.id)).toEqual(['a', 'b']);
  });

  it('открытые впереди закрытых, внутри — по сроку', () => {
    const list = devStageQueue([
      row('d1', [
        task({ id: 'done', status: 'done', due_date: '2026-08-01' }),
        task({ id: 'late', due_date: '2026-08-05' }),
        task({ id: 'soon', due_date: '2026-08-02' }),
        task({ id: 'nodate' }),
      ]),
    ], 'patterns');
    // Закрытая уходит вниз, даже если её срок самый ранний: очередь отвечает
    // на вопрос «что брать следующим»
    expect(list.map((x) => x.task.id)).toEqual(['soon', 'late', 'nodate', 'done']);
  });

  it('нанесения — ОТБОР общих заданий, а не свой механизм', () => {
    const entries = [
      { stage: { id: 's1', origin: 'experimental' } },
      { stage: { id: 's2', origin: 'production' } },
      // Этап из урезанной выборки: колонки может не быть вовсе, и это
      // читается как «серия», а не как «образец»
      { stage: { id: 's3' } },
    ];
    expect(experimentalEntries(entries).map((e) => e.stage.id)).toEqual(['s1']);
  });
});

/**
 * ДОПОЛНИТЕЛЬНЫЕ ЗАДАЧИ НЕ ЯВЛЯЮТСЯ ЭТАПАМИ КАНБАНА (правка 22.08, п. 4.6).
 *
 * «Если внутри разработки создана задача Доработать рукав, на общей доске
 * не должна появляться отдельная колонка Доработать рукав». Отбор один
 * на карточку и на доску — та же таблица соответствий `devStageOfTask`.
 */
describe('дополнительные задачи', () => {
  it('вне шагов остаются доработка, примерка, материалы и незнакомые типы', () => {
    const list = [
      task({ id: 'p', task_type: 'patterns' }),
      task({ id: 'r', task_type: 'rework' }),
      task({ id: 'f', task_type: 'fitting' }),
      task({ id: 'm', task_type: 'material' }),
      task({ id: 'x', task_type: 'Сублимация на молнии' }),
      task({ id: 'dtg', task_type: 'dtg' }),
    ];
    expect(extraTasks(list).map((t) => t.id)).toEqual(['r', 'f', 'm', 'x']);
  });

  it('пустой ввод не роняет — карточка зовёт это до загрузки', () => {
    expect(extraTasks(null)).toEqual([]);
  });
});

/**
 * ДЕЙСТВИЕ КЛЮЧЕВОГО ЭТАПА (пп. 4.3, 4.12) — НЕ ВТОРАЯ МЕХАНИКА.
 * Функция читает уже посчитанное состояние шага и только называет действие;
 * гейты, зависимости и статусы считает `devStageStates`, та же, что доска.
 */
describe('devStageAction', () => {
  const stateOf = (over: Partial<ReturnType<typeof devStageStates>[number]>) => ({
    stage: 'cutting' as const, lane: 'ready' as const, tasks: [task({ id: 'a' })],
    waitingReason: null, ...over,
  });

  it('готовый этап предлагает начать работу', () => {
    expect(devStageAction(stateOf({})).key).toBe('start');
  });

  it('этап в работе предлагает завершить', () => {
    expect(devStageAction(stateOf({ lane: 'in_progress' })).key).toBe('complete');
  });

  it('ожидание объясняется причиной, а не кнопкой', () => {
    const a = devStageAction(stateOf({ lane: 'waiting', waitingReason: 'Ожидает лекала' }));
    expect(a.key).toBeNull();
    expect(a.reason).toBe('Ожидает лекала');
  });

  it('пустой этап завершать нечем — сначала нужна работа', () => {
    const a = devStageAction(stateOf({ tasks: [] }));
    expect(a.key).toBeNull();
    expect(a.reason).toMatch(/Задач этапа нет/);
  });

  it('закрытый и пропущенный шаги действий не предлагают', () => {
    expect(devStageAction(stateOf({ lane: 'done' })).key).toBeNull();
    expect(devStageAction(stateOf({ lane: 'skipped' })).key).toBeNull();
  });
});

/**
 * PROGRESS-STEPPER МАРШРУТА (правка заказчика 23.08, п. 7).
 *
 * Документ: «У каждого этапа визуально показывать состояние: завершён /
 * в работе / ожидает / пропущен… Если нанесения не нужны, этап помечается
 * „Не требуется"/„Пропущен" и после завершения кроя карточка автоматически
 * переходит сразу в „Пошив"».
 *
 * Сторожим то, что нельзя увидеть глазами на одном экране: состояние
 * КАЖДОГО шага, а не только текущего, и отличие «не требуется» от
 * «пропущено» — первое про план, второе про несделанную работу.
 */
describe('devRouteSteps — маршрут разработки сверху карточки', () => {
  const stepsFor = (tasks: ErpExperimentalTask[]) => {
    const states = devStageStates({ dev: dev(), tasks });
    return devRouteSteps(states, devBoardColumn(states, dev()));
  };
  const byKey = (steps: ReturnType<typeof devRouteSteps>, key: string) =>
    steps.find((s) => s.key === key)!;

  it('пять шагов документа, в его порядке', () => {
    expect(stepsFor([task({ id: 'p' })]).map((s) => s.key)).toEqual(DEV_STAGE_ORDER);
  });

  it('состояние есть у КАЖДОГО шага, а не только у текущего', () => {
    const steps = stepsFor([
      task({ id: 'p', task_type: 'patterns', status: 'done' }),
      task({ id: 'c', task_type: 'cutting', status: 'in_progress' }),
      task({ id: 's', task_type: 'sample', status: 'todo' }),
    ]);
    expect(byKey(steps, 'patterns').sub).toBe('Завершено');
    expect(byKey(steps, 'cutting').sub).toBe('В работе');
    expect(byKey(steps, 'sewing').sub).toBe('Ожидает');
    // Ни один шаг не остаётся без подписи — иначе stepper молчит о половине пути
    expect(steps.every((s) => s.sub.length > 0)).toBe(true);
  });

  /**
   * «Не требуется» ≠ «Пропущено». Первое — про план (нанесений у этой
   * разработки нет вовсе), второе — про работу, которую не сделали.
   * Слово «пропущено» на необязательном этапе читалось бы как упрёк.
   */
  it('нанесения без задач помечены «Не требуется», а не «Пропущено»', () => {
    const steps = stepsFor([
      task({ id: 'p', task_type: 'patterns', status: 'done' }),
      task({ id: 'c', task_type: 'cutting', status: 'in_progress' }),
    ]);
    const branding = byKey(steps, 'branding');
    expect(branding.state).toBe('skipped');
    expect(branding.sub).toBe('Не требуется');
  });

  it('пройденный шаг закрашивает соединитель следующего', () => {
    const steps = stepsFor([
      task({ id: 'p', task_type: 'patterns', status: 'done' }),
      task({ id: 'c', task_type: 'cutting', status: 'in_progress' }),
    ]);
    expect(byKey(steps, 'cutting').lineDone).toBe(true);
    expect(byKey(steps, 'patterns').lineDone).toBe(false); // у первого шага линии нет
  });

  it('текущий шаг помечен активным, закрытый — завершённым', () => {
    const steps = stepsFor([
      task({ id: 'p', task_type: 'patterns', status: 'done' }),
      task({ id: 'c', task_type: 'cutting', status: 'todo' }),
    ]);
    expect(byKey(steps, 'patterns').state).toBe('done');
    expect(byKey(steps, 'cutting').state).toBe('active');
  });
});

describe('подпись действия — по имени этапа (п. 7)', () => {
  it('«Завершить крой», а не «Завершить этап»', () => {
    const states = devStageStates({
      dev: dev(),
      tasks: [
        task({ id: 'p', task_type: 'patterns', status: 'done' }),
        task({ id: 'c', task_type: 'cutting', status: 'in_progress' }),
      ],
    });
    const cutting = states.find((s) => s.stage === 'cutting')!;
    expect(devStageAction(cutting).label).toBe('Завершить крой');
  });

  it('у лекал и пошива — свои названия', () => {
    const label = (stage: string, tasks: ErpExperimentalTask[]) => {
      const st = devStageStates({ dev: dev(), tasks }).find((s) => s.stage === stage)!;
      return devStageAction(st).label;
    };
    expect(label('patterns', [task({ id: 'p', task_type: 'patterns', status: 'in_progress' })]))
      .toBe('Завершить лекала');
    expect(label('sewing', [
      task({ id: 'p', task_type: 'patterns', status: 'done' }),
      task({ id: 's', task_type: 'sample', status: 'in_progress' }),
    ])).toBe('Завершить пошив');
  });

  it('необязательные нанесения объясняют, что будут пропущены сами', () => {
    const states = devStageStates({
      dev: dev(),
      tasks: [
        task({ id: 'p', task_type: 'patterns', status: 'done' }),
        task({ id: 'c', task_type: 'cutting', status: 'in_progress' }),
      ],
    });
    const branding = states.find((s) => s.stage === 'branding')!;
    expect(devStageAction(branding).reason).toMatch(/Не требуется/);
  });
});
