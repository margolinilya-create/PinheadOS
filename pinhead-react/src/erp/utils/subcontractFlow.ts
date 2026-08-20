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
}

export interface SubcontractView {
  /** Хранимая фаза — то, что лежит в базе */
  stored: SubcontractPhase;
  /** Что показывать человеку (первые две фазы считаются) */
  display: SubcontractPhase;
  /** Сколько штук готово к передаче прямо сейчас */
  readyQty: number;
  /** Не вернулось от подрядчика (передано − вернулось) */
  lost: number;
  /** Вернулось, но не принято складом */
  defect: number;
}

/**
 * Сколько единиц доступно к передаче: выход предыдущего этапа минус уже
 * переданное. Считается тем же `stageInputQty`, что и «принято в работу»
 * у обычного цеха — у подряда нет причин считать вход иначе.
 */
export function readyToSendQty(
  stage: Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null },
  allStages: (Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null })[],
  itemQty: number,
  sub: SubLike | null | undefined,
): number {
  const input = stageInputQty(stage, allStages, itemQty);
  const sent = Number(sub?.qty_sent ?? 0);
  return Math.max(0, input - sent);
}

export function subcontractView(
  sub: SubLike | null | undefined,
  stage: Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null },
  allStages: (Pick<ErpItemStage, 'id' | 'status' | 'depends_on'> & { qty_done?: number | null })[],
  itemQty: number,
): SubcontractView {
  const stored = sub ? subcontractPhase(sub) : 'planned';
  const readyQty = readyToSendQty(stage, allStages, itemQty, sub);
  const { lost, defect } = subcontractShortfall(sub ?? undefined);
  /**
   * Считаем только ДО первой передачи. Дальше хранимая фаза авторитетна:
   * у операции, вернувшейся от подрядчика, «готово к передаче» на остаток
   * тиража — это отдельный разговор, и подменять им «ожидает приёмки»
   * значило бы прятать то, чего ждёт склад.
   */
  const display: SubcontractPhase = stored === 'planned' && readyQty > 0
    ? 'materials_ready'
    : stored;
  return { stored, display, readyQty, lost, defect };
}

/** Действие над подрядной операцией — кнопка в разделе «Подряд» */
export type SubcontractAction = 'send' | 'ready' | 'return' | 'rework';

export interface ActionSpec {
  key: SubcontractAction;
  label: string;
  /** Фаза, в которую переходим */
  phase: SubcontractPhase;
  /** Вид записи журнала; null — количеств не трогаем */
  move: 'send' | 'return' | null;
  /** Подпись поля количества в форме */
  qtyLabel: string | null;
}

export const SUBCONTRACT_ACTIONS: Record<SubcontractAction, ActionSpec> = {
  send: {
    key: 'send',
    label: 'Передать подрядчику',
    /**
     * Сразу `at_contractor`, а не `sent`. Прежняя фаза «Передано подрядчику»
     * означала ровно то же самое и осталась от модели, где передачу
     * фиксировали отдельно от начала работ. Документ такого состояния
     * не знает: у него «У подрядчика».
     */
    phase: 'at_contractor',
    move: 'send',
    qtyLabel: 'Сколько передано',
  },
  ready: {
    key: 'ready',
    label: 'Готово у подрядчика',
    phase: 'ready_at_contractor',
    move: null,
    qtyLabel: null,
  },
  return: {
    key: 'return',
    label: 'Вернулось',
    phase: 'returned',
    move: 'return',
    qtyLabel: 'Сколько вернулось',
  },
  rework: {
    key: 'rework',
    label: 'На переделку',
    /**
     * Переделка НЕ пишет журнал: изделия уже посчитаны как вернувшиеся,
     * и повторная запись `send` удвоила бы «передано». Сколько именно
     * ушло в переделку, видно из расхождения «вернулось − принято».
     */
    phase: 'rework',
    move: null,
    qtyLabel: null,
  },
};

/**
 * Какие действия доступны из текущего состояния.
 *
 * Приёмки здесь НЕТ намеренно: её делает СКЛАД, задачей «Приёмка подряда»,
 * и она же приращает `qty_done` этапа. Кнопка «принято» в этом разделе была бы
 * вторым путём к тому же переходу — мимо складского гейта и мимо фиксации
 * брака и недостачи.
 */
export function availableActions(view: SubcontractView): ActionSpec[] {
  const out: ActionSpec[] = [];
  const { display, readyQty } = view;
  if (display === 'planned' || display === 'materials_ready') {
    if (readyQty > 0) out.push(SUBCONTRACT_ACTIONS.send);
    return out;
  }
  if (display === 'sent' || display === 'at_contractor') {
    out.push(SUBCONTRACT_ACTIONS.ready, SUBCONTRACT_ACTIONS.return);
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
    // Ждём склад. Отправить брак на переделку можно сразу — основная партия
    // при этом не блокируется, она уже у склада
    out.push(SUBCONTRACT_ACTIONS.rework);
    return out;
  }
  if (display === 'rework') {
    out.push(SUBCONTRACT_ACTIONS.return);
    return out;
  }
  return out;
}
