/**
 * СЛОВАРЬ СОСТОЯНИЙ РАЗДЕЛА «ПРОИЗВОДСТВО»: одно место, где статус сущности
 * превращается в слово и цвет.
 *
 * ЗАЧЕМ. Слово статуса лежало в `*_LABELS` (types.ts), а цвет — в семи
 * рукописных картах по экранам (`STAGE_CHIP_CLASS`, `PLAN_STATE_CHIP`,
 * `SUPPLY_STATE_BADGE`, карты внутри `Subcontracting`, `DevBoard`,
 * `MaterialReceiptCard`, `OrderRow`). Семь карт про один вопрос расходятся
 * молча: обе «работают», просто красят по-разному. Обход 04.09 нашёл готовое
 * расхождение — `.chipReady` и `.chipDone` объявлены ОДИНАКОВО, и на доске
 * «Готов к работе» отличался от «Готово» только текстом.
 *
 * ДВЕ ОСИ. Слово подбирается по СУЩНОСТИ («Готово» у этапа, «Пришло»
 * у материала, «Принято складом» у подряда), цвет — по СОСТОЯНИЮ. Поэтому
 * словарь двумерный: `STATUS_VARIANT[сущность][статус] → вариант чипа`,
 * а слово по-прежнему берётся из `*_LABELS` — второй копии подписей здесь нет.
 *
 * СЕМЬ СОСТОЯНИЙ, и каждое отвечает на «что с этим делать»:
 *
 * | вариант    | цвет      | смысл                                        |
 * |------------|-----------|----------------------------------------------|
 * | `neutral`  | серый     | ещё не время                                 |
 * | `ready`    | бирюзовый | можно начинать — ждёт человека               |
 * | `progress` | синий     | идёт прямо сейчас                            |
 * | `waiting`  | амбер     | ждёт ВНЕШНЕГО: материал, подрядчика, решение |
 * | `blocked`  | красный   | вмешаться                                    |
 * | `done`     | зелёный   | закрыто                                      |
 * | `skipped`  | зачёркнут | не будет                                     |
 *
 * `info` ≡ `progress` и `danger` ≡ `blocked` — исторические псевдонимы тех же
 * заливок; статусам они не выдаются, чтобы одно состояние не звалось двумя
 * именами. `violet` и `cyan` остаются декоративными (вид работы, а не её
 * состояние).
 *
 * СТОРОЖ — `statusUi.test.ts`: каждый ключ каждой `*_LABELS` обязан быть
 * в карте. Тот же приём, что `dictionaryKinds.test.ts`: новое значение
 * перечисления, заведённое в подписях и забытое здесь, роняет тест, а не
 * экран.
 */

import {
  DEV_OUTCOME_LABELS,
  DEV_TASK_STATUS_LABELS,
  FG_RECEIPT_STATUS_LABELS,
  MARKING_STATUS_LABELS,
  MATERIAL_ACCEPT_LABELS,
  MATERIAL_STATUS_LABELS,
  ORDER_STATUS_LABELS,
  PACK_SHIP_STATUS_LABELS,
  PROCUREMENT_STATUS_LABELS,
  SHIPPED_STATUS_LABELS,
  STAGE_STATUS_LABELS,
  SUBCONTRACT_PHASE_LABELS,
  SUBCONTRACT_RECEIPT_STATUS_LABELS,
  SUBCONTRACT_SEND_STATUS_LABELS,
  SUBCONTRACT_STATUS_LABELS,
} from '../types';

/** Вид чипа: то, что понимает примитив `Badge` */
export type BadgeVariant =
  | 'neutral' | 'ready' | 'progress' | 'waiting' | 'blocked' | 'done' | 'skipped'
  /* декоративные — не состояние работы, а её вид */
  | 'violet' | 'cyan'
  /* псевдонимы заливок, оставленные ради старых вызовов */
  | 'info' | 'danger';

/** Сущности, у которых есть состояние. Ключ = имя в `STATUS_VARIANT` */
export type StatusEntity = keyof typeof STATUS_VARIANT;

export const STATUS_VARIANT = {
  /** Этап маршрута — самая частая шкала раздела */
  stage: {
    waiting: 'waiting',
    ready: 'ready',
    in_progress: 'progress',
    done: 'done',
    skipped: 'skipped',
    blocked: 'blocked',
  },
  /**
   * Заказ. «Сдан с опозданием» — единственный красный: это вопрос к работе,
   * а не отметка архива. Досрочная и вовремя сданная сдача одинаково зелёные —
   * «раньше срока» отдельным цветом читалось бы как отклонение.
   */
  order: {
    active: 'progress',
    done_on_time: 'done',
    done_early: 'done',
    done_late: 'blocked',
    cancelled: 'skipped',
  },
  /** Отгрузка заказа: частичная — амбер, потому что тираж ещё числится за нами */
  shipped: {
    not_shipped: 'neutral',
    partial: 'waiting',
    shipped: 'done',
  },
  /**
   * Материал. «Пришло» зелёное, но зелёное ≠ «годен»: годность даёт ПРИЁМКА
   * склада (`materialAccept` ниже), и гейт производства смотрит именно её.
   */
  material: {
    pending: 'neutral',
    ordered: 'progress',
    in_transit: 'progress',
    received: 'done',
    partial: 'waiting',
    not_needed: 'skipped',
    reserved: 'ready',
  },
  /** Итог приёмки склада: всё, кроме полной и частичной, — вмешаться */
  materialAccept: {
    accepted_full: 'done',
    accepted_partial: 'waiting',
    shortage: 'blocked',
    mismatch: 'blocked',
    rejected: 'blocked',
  },
  /** Задача разработки */
  devTask: {
    todo: 'neutral',
    in_progress: 'progress',
    waiting: 'waiting',
    blocked: 'blocked',
    done: 'done',
    cancelled: 'skipped',
  },
  /**
   * Исход разработки. «Требуется доработка» — амбер, а не красный: доработка
   * это запланированный круг, а не авария.
   */
  devOutcome: {
    ready_for_serial: 'done',
    needs_rework: 'waiting',
    moved_to_production: 'done',
    cancelled: 'skipped',
    other: 'neutral',
  },
  /** Приёмка готовой продукции складом */
  fgReceipt: {
    awaiting: 'waiting',
    accepted: 'done',
  },
  /** Передача подрядчику */
  subcontractSend: {
    awaiting: 'waiting',
    sent: 'done',
  },
  /** Приёмка от подрядчика */
  subcontractReceipt: {
    awaiting_receipt: 'waiting',
    accepted: 'done',
  },
  /** Маркировка */
  marking: {
    new: 'neutral',
    in_progress: 'progress',
    issued: 'done',
  },
  /** Упаковка и отгрузка: «готово к отгрузке» — ждёт человека, отсюда `ready` */
  packShip: {
    packing: 'progress',
    ready_to_ship: 'ready',
    shipped: 'done',
  },
  /** Задача закупки */
  procurement: {
    new: 'neutral',
    in_progress: 'progress',
    ordered: 'progress',
    done: 'done',
    cancelled: 'skipped',
  },
  /**
   * Фаза подряда — действующая шкала (`erp_subcontracting.phase`).
   * «Вернулось» амбер: партия у нас, но ещё не разобрана складом.
   */
  subcontractPhase: {
    planned: 'neutral',
    materials_ready: 'ready',
    sent: 'progress',
    at_contractor: 'progress',
    ready_at_contractor: 'ready',
    returned: 'waiting',
    rework: 'blocked',
    accepted: 'done',
    closed: 'done',
  },
  /**
   * `erp_subcontracting.status` — legacy-шкала, помеченная `@deprecated`:
   * её пишет зеркало из фазы. В карте она ради строк, заведённых до перехода;
   * новых значений сюда не добавлять — они идут в `subcontractPhase`.
   */
  subcontract: {
    planned: 'neutral',
    awaiting_materials: 'waiting',
    awaiting_payment: 'waiting',
    sent: 'progress',
    started: 'progress',
    in_progress: 'progress',
    ready_to_ship: 'ready',
    shipped_by_contractor: 'progress',
    returned: 'waiting',
    received_at_pinhead: 'done',
    delayed: 'blocked',
    cancelled: 'skipped',
  },
  /**
   * Дорожка доски ЭКС: состояние вычисляется из задач, в базе такого
   * перечисления нет. «Ожидает» здесь серое, а не амбер — на доске оно значит
   * «шаг ещё не начали», а не «ждём внешнего».
   */
  devLane: {
    blocked: 'blocked',
    awaiting_materials: 'waiting',
    waiting: 'neutral',
    ready: 'ready',
    in_progress: 'progress',
    done: 'done',
  },
  /**
   * Задача дня в плане. Считается из чисел (`utils/planCard`), в базе такого
   * перечисления нет — поэтому сторож подписей её не проверяет, а карта нужна:
   * доска плана красит те же состояния.
   */
  plan: {
    planned: 'neutral',
    in_progress: 'progress',
    done: 'done',
    partial: 'waiting',
    overdue: 'blocked',
    awaiting_materials: 'waiting',
  },
} as const satisfies Record<string, Record<string, BadgeVariant>>;

/**
 * Подписи сущности — те же `*_LABELS`, что и раньше. Карта нужна сторожу
 * (сверить ключи) и `statusUi()` (отдать слово вместе с цветом).
 *
 * `plan` здесь нет: его состояние вычисляется, а не хранится, и подписи живут
 * рядом с расчётом (`utils/planCard.PLAN_STATE_LABELS`). Заводить ему запись
 * значило бы тянуть расчёт в словарь ради симметрии.
 */
export const STATUS_LABELS: Partial<Record<StatusEntity, Record<string, string>>> = {
  stage: STAGE_STATUS_LABELS,
  order: ORDER_STATUS_LABELS,
  shipped: SHIPPED_STATUS_LABELS,
  material: MATERIAL_STATUS_LABELS,
  materialAccept: MATERIAL_ACCEPT_LABELS,
  devTask: DEV_TASK_STATUS_LABELS,
  devOutcome: DEV_OUTCOME_LABELS,
  fgReceipt: FG_RECEIPT_STATUS_LABELS,
  subcontractSend: SUBCONTRACT_SEND_STATUS_LABELS,
  subcontractReceipt: SUBCONTRACT_RECEIPT_STATUS_LABELS,
  marking: MARKING_STATUS_LABELS,
  packShip: PACK_SHIP_STATUS_LABELS,
  procurement: PROCUREMENT_STATUS_LABELS,
  subcontractPhase: SUBCONTRACT_PHASE_LABELS,
  subcontract: SUBCONTRACT_STATUS_LABELS,
};

/**
 * Вариант → класс `.chip*` из `erp.module.css`. Таблица живёт здесь, а не
 * в `Badge`: половина раздела собирает имя класса строкой
 * (`styles[CHIP[status]]`) и до примитива не доходит.
 */
export const VARIANT_CHIP_CLASS: Record<BadgeVariant, string> = {
  neutral: 'chipNeutral',
  ready: 'chipReady',
  progress: 'chipProgress',
  waiting: 'chipWaiting',
  blocked: 'chipBlocked',
  done: 'chipDone',
  skipped: 'chipSkipped',
  violet: 'chipViolet',
  cyan: 'chipCyan',
  info: 'chipInfo',
  danger: 'chipDanger',
};

/** Имя класса чипа для статуса сущности — для `styles[…]` в разметке */
export function statusChipClass(
  entity: StatusEntity,
  status: string | null | undefined,
): string {
  return VARIANT_CHIP_CLASS[statusUi(entity, status).variant];
}

export interface StatusUi {
  /** Слово из `*_LABELS`; неизвестный статус возвращается как есть */
  label: string;
  variant: BadgeVariant;
}

/**
 * Слово и цвет для статуса сущности.
 *
 * НЕИЗВЕСТНЫЙ СТАТУС НЕ РОНЯЕТ ЭКРАН, а показывается серым со своим кодом:
 * строки заводились годами, и значение, оставшееся от прошлой миграции, должно
 * быть видно человеку, а не превращать карточку в пустое место. Расхождение
 * ловит сторож на сборке, а не планшет в цехе.
 */
export function statusUi(
  entity: StatusEntity,
  status: string | null | undefined,
): StatusUi {
  const variants = STATUS_VARIANT[entity] as Record<string, BadgeVariant>;
  const labels = STATUS_LABELS[entity] ?? {};
  if (!status) return { label: '—', variant: 'neutral' };
  return {
    label: labels[status] ?? status,
    variant: variants[status] ?? 'neutral',
  };
}
