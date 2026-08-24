import type { ErpItemStage, SubcontractPhase } from '../types';
import { stageInputQty } from './stageInput';
import { subcontractPhase } from './subcontractPhase';
import { subcontractShortfall } from './outsourcing';

/**
 * Движение подрядной операции: что показать и что можно сделать.
 *
 * ЧТО БЫЛО НЕ ТАК. Фазу выставлял СЕЛЕКТ в таблице: любым значением, в любом
 * порядке, без единой записи в журнал. Им можно было поставить «Завершено»,
 * не передав и не приняв ни одной штуки — а `qty_done` подрядного этапа
 * приращает ТОЛЬКО журнал перемещений (`erp_subcontract_moves_rollup`).
 * То есть раздел позволял соврать про факт: на экране «завершено»,
 * в производстве этап открыт, следующий этап не начинается, и понять,
 * почему заказ стоит, нельзя ничем.
 *
 * ТЕПЕРЬ ДВИЖЕНИЕ — ДЕЙСТВИЯ, а первые две фазы вообще НЕ ХРАНЯТСЯ.
 *
 * «Запланировано» и «Готово к передаче» — это не решения человека, а состояние
 * МАРШРУТА: пока предыдущий этап ничего не сдал, передавать нечего; как только
 * сдал — столько и готово. Документ формулирует это буквально: «швейка
 * закончила 150 шт. → в подряде появляется: Варка — Готово к передаче —
 * 150 шт.». Хранить такое второй колонкой значит завести два источника правды,
 * которые разъедутся в первую же частичную сдачу — ровно тем же приёмом
 * (вычисляемое состояние вместо хранимой фазы) переделан экс-цех.
 *
 * Хранимая фаза начинает двигаться с ПЕРЕДАЧИ, и каждый переход
 * сопровождается записью в журнал — кроме «готово у подрядчика», которое
 * количеств не меняет.
 */

/** Минимум карточки подрядчика, нужный расчёту */
export interface SubLike {
  phase?: string | null;
  status?: string | null;
  qty?: number | null;
  qty_sent?: number | null;
  qty_returned?: number | null;
  qty_accepted?: number | null;
  qty_defect?: number | null;
  qty_in_work?: number | null;
  material_source?: string | null;
  /**
   * Этап маршрута, при котором стоит операция. Пусто у легаси-строк подряда
   * «под ключ»: у них складской задачи передачи не будет никогда, и кнопка
   * запуска остаётся в разделе «Подряд» (правка 24.08, п. 3).
   */
  stage_id?: string | null;
}

export interface SubcontractView {
  /** Хранимая фаза — то, что лежит в базе */
  stored: SubcontractPhase;
  /** Что показывать человеку (первые две фазы считаются) */
  display: SubcontractPhase;
  /** Сколько штук готово к передаче прямо сейчас */
  readyQty: number;
  /**
   * Сколько единиц подрядчик делает сейчас. Хранимое `qty_in_work`, а до
   * запуска — то, что готово отдать: человек должен видеть объём работы
   * ДО того, как нажмёт кнопку.
   */
  inWorkQty: number;
  /** Материалы подрядчика — физическая передача не требуется вовсе */
  contractorMaterials: boolean;
  /** Не вернулось от подрядчика (передано − вернулось) */
  lost: number;
  /** Вернулось, но ещё не разобрано приёмкой */
  awaitingAccept: number;
  /** Брак, отмеченный ЯВНО */
  defect: number;
  /**
   * Операция принадлежит ЭТАПУ маршрута (правка 24.08, п. 3). У таких выход
   * к подрядчику идёт через складскую передачу, и кнопки «Передать в работу»
   * в разделе «Подряд» больше нет: заказ не может получить статус
   * «У подрядчика», пока склад не зафиксировал передачу.
   *
   * У легаси-операций без этапа (подряд «под ключ», заведённый старой формой)
   * задачи склада не будет НИКОГДА — триггер висит на этапах. Им кнопка
   * остаётся, иначе такая операция не запустится вовсе.
   */
  hasStage: boolean;
}

/**
 * Сколько единиц доступно к запуску у подрядчика: выход предыдущего этапа
 * минус то, что уже отдано в работу. Считается тем же `stageInputQty`,
 * что и «принято в работу» у обычного цеха — у подряда нет причин считать
 * вход иначе.
 *
 * ВЫЧИТАЕМ `qty_in_work`, А НЕ `qty_sent` (правка 22.08, п. 3.8). Раньше
 * остаток считался от ФИЗИЧЕСКИ ПЕРЕДАННОГО, и на материалах подрядчика
 * (передавать нечего, `qty_sent` всегда 0) кнопка «передать» предлагала
 * отдать весь тираж заново после каждого запуска. Работа у подрядчика есть
 * и без нашей передачи — её объём и есть `qty_in_work`.
 *
 * У операций, заведённых до правки, `qty_in_work` пуст: там остаток считается
 * от переданного, как и раньше, — иначе им предложили бы отдать тираж дважды.
 */
export function readyToSendQty(
  stage: Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null },
  allStages: (Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null })[],
  itemQty: number,
  sub: SubLike | null | undefined,
): number {
  const input = stageInputQty(stage, allStages, itemQty);
  const taken = sub?.qty_in_work == null
    ? Number(sub?.qty_sent ?? 0)
    : Number(sub.qty_in_work);
  return Math.max(0, input - taken);
}

export function subcontractView(
  sub: SubLike | null | undefined,
  stage: Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null },
  allStages: (Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null })[],
  itemQty: number,
): SubcontractView {
  const stored = sub ? subcontractPhase(sub) : 'planned';
  const readyQty = readyToSendQty(stage, allStages, itemQty, sub);
  const { lost, awaitingAccept, defect } = subcontractShortfall(sub ?? undefined);
  const contractorMaterials = sub?.material_source === 'contractor';
  /**
   * До запуска показываем ДОСТУПНЫЙ объём, после — принятый в работу.
   * Ноль в `qty_in_work` у старых операций читается как «не заводили»:
   * там объём работы равен тому, что уже передано.
   */
  const inWorkQty = Number(sub?.qty_in_work ?? 0) > 0
    ? Number(sub?.qty_in_work)
    : (Number(sub?.qty_sent ?? 0) || readyQty);
  /**
   * Считаем только ДО первой передачи. Дальше хранимая фаза авторитетна:
   * у операции, вернувшейся от подрядчика, «готово к передаче» на остаток
   * тиража — это отдельный разговор, и подменять им «ожидает приёмки»
   * значило бы прятать то, чего ждёт склад.
   */
  const display: SubcontractPhase = stored === 'planned' && readyQty > 0
    ? 'materials_ready'
    : stored;
  return {
    stored, display, readyQty, inWorkQty, contractorMaterials,
    lost, awaitingAccept, defect,
    /**
     * Признак берётся из САМОЙ ОПЕРАЦИИ, а не из наличия этапа в аргументах:
     * этап сюда передают всегда, а связь с ним хранится у операции
     * (`stage_id`), и легаси-строки её не имеют. Спутать одно с другим значило
     * бы снять кнопку у операций, которым складской задачи не будет никогда.
     */
    hasStage: Boolean(sub?.stage_id),
  };
}

/** Действие над подрядной операцией — кнопка в разделе «Подряд» */
export type SubcontractAction = 'start' | 'send' | 'ready' | 'return' | 'defect' | 'rework';

export interface ActionSpec {
  key: SubcontractAction;
  label: string;
  /** Фаза, в которую переходим */
  phase: SubcontractPhase;
  /** Вид записи журнала; null — количеств не трогаем */
  move: 'send' | 'return' | 'defect' | null;
  /** Подпись поля количества в форме */
  qtyLabel: string | null;
  /**
   * Спрашивает ли действие «сколько единиц в работе».
   *
   * Ради этого поля правка и делалась: объём работы у подрядчика и объём
   * физической передачи — РАЗНЫЕ величины, и на материалах подрядчика вторая
   * равна нулю при первой в 200 штук.
   */
  asksInWork: boolean;
}

export const SUBCONTRACT_ACTIONS: Record<SubcontractAction, ActionSpec> = {
  start: {
    key: 'start',
    label: 'Передать в работу',
    /**
     * Сразу `at_contractor`, а не `sent`. Прежняя фаза «Передано подрядчику»
     * означала ровно то же самое и осталась от модели, где передачу
     * фиксировали отдельно от начала работ. Документ такого состояния
     * не знает: у него «У подрядчика».
     */
    phase: 'at_contractor',
    /**
     * Журнальная запись `send` пишется, ТОЛЬКО если человек указал физически
     * переданное количество. Иначе действие двигает одну фазу: «физическая
     * передача наших материалов не должна быть обязательным условием запуска
     * подрядного этапа» (п. 3.8).
     */
    move: 'send',
    qtyLabel: 'Физически передано (если передаём)',
    asksInWork: true,
  },
  send: {
    key: 'send',
    label: 'Догрузить партию',
    phase: 'at_contractor',
    move: 'send',
    qtyLabel: 'Физически передано (если передаём)',
    asksInWork: true,
  },
  ready: {
    key: 'ready',
    /**
     * Шаг НЕОБЯЗАТЕЛЬНЫЙ (п. 3.5): основной путь — «У подрядчика → Готово →
     * Приёмка», и «Зафиксировать возврат» доступно, минуя эту кнопку.
     * Отметка нужна там, где готовую партию ещё не забрали: без неё
     * забытый у подрядчика тираж неотличим от того, что ещё шьётся.
     */
    label: 'Готово у подрядчика',
    phase: 'ready_at_contractor',
    move: null,
    qtyLabel: null,
    asksInWork: false,
  },
  return: {
    key: 'return',
    label: 'Зафиксировать возврат',
    phase: 'returned',
    move: 'return',
    qtyLabel: 'Сколько вернулось',
    asksInWork: false,
  },
  defect: {
    key: 'defect',
    /**
     * Явная отметка брака — то, чего не хватало (п. 3.9). До неё браком
     * считалось всё непринятое, то есть партия, ещё не дошедшая до приёмки.
     */
    label: 'Отметить брак',
    phase: 'returned',
    move: 'defect',
    qtyLabel: 'Сколько брака',
    asksInWork: false,
  },
  rework: {
    key: 'rework',
    label: 'На переделку',
    /**
     * Переделка НЕ пишет журнал: изделия уже посчитаны как вернувшиеся,
     * и повторная запись `send` удвоила бы «передано». Сколько именно
     * ушло в переделку, видно из отмеченного брака.
     */
    phase: 'rework',
    move: null,
    qtyLabel: null,
    asksInWork: false,
  },
};

/**
 * Какие действия доступны из текущего состояния.
 *
 * ПЕРВОЕ В СПИСКЕ — ГЛАВНОЕ (правка 22.08, п. 3.3): «на одном состоянии этапа
 * не должно быть нескольких одинаково заметных кнопок». Порядок здесь и есть
 * приоритет, интерфейс рисует первую кнопку основной, остальные — вторичными.
 * Держать приоритет в разметке нельзя: карточка подряда монтируется и в общем
 * списке, и в деталях этапа.
 *
 * Приёмки здесь НЕТ намеренно: её делает СКЛАД, задачей «Приёмка подряда»,
 * и она же приращает `qty_done` этапа. Кнопка «принято» в этом разделе была бы
 * вторым путём к тому же переходу — мимо складского гейта и мимо фиксации
 * брака и недостачи.
 */
export function availableActions(view: SubcontractView): ActionSpec[] {
  const out: ActionSpec[] = [];
  const { display, readyQty, hasStage } = view;
  if (display === 'planned' || display === 'materials_ready') {
    /**
     * ПЕРЕДАЧУ ФИКСИРУЕТ СКЛАД (правка 24.08, п. 3), поэтому у операции при
     * ЭТАПЕ кнопки здесь нет: «заказ не может получить статус "У подрядчика",
     * пока склад не зафиксировал фактическую передачу». Задача передачи
     * заводится автоматически, как только этап готов принять работу.
     *
     * У легаси-операций без этапа кнопка остаётся: задачи склада для них
     * не будет никогда — триггер висит на этапах, — и снятие кнопки означало бы,
     * что такую операцию не запустить вовсе.
     */
    if (readyQty > 0 && !hasStage) out.push(SUBCONTRACT_ACTIONS.start);
    return out;
  }
  if (display === 'sent' || display === 'at_contractor') {
    // Главное — возврат: документ убрал «Готово у подрядчика» из
    // обязательного пути, оставив его отметкой для забытых партий
    out.push(SUBCONTRACT_ACTIONS.return, SUBCONTRACT_ACTIONS.ready);
    // Остаток тиража можно догрузить той же операции, не дожидаясь возврата:
    // документ прямо про это — «оставшиеся 300 продолжают производство»
    if (readyQty > 0) out.push(SUBCONTRACT_ACTIONS.send);
    return out;
  }
  if (display === 'ready_at_contractor') {
    out.push(SUBCONTRACT_ACTIONS.return);
    if (readyQty > 0) out.push(SUBCONTRACT_ACTIONS.send);
    return out;
  }
  if (display === 'returned') {
    /**
     * Ждём склад — он оформляет приёмку. Отсюда можно отметить брак
     * и отправить его на переделку: основная партия при этом
     * не блокируется, она уже у склада.
     */
    out.push(SUBCONTRACT_ACTIONS.defect, SUBCONTRACT_ACTIONS.rework);
    return out;
  }
  if (display === 'rework') {
    out.push(SUBCONTRACT_ACTIONS.return);
    return out;
  }
  return out;
}
