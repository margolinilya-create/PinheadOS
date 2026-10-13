/**
 * «СЕЙЧАС» — где заказ и почему он стоит, одной строкой.
 *
 * ЗАЧЕМ. Список заказов отвечал на этот вопрос колонкой «Статус», где у десяти
 * строк из одиннадцати написано «В работе»: это состояние ЗАКАЗА, а не работы.
 * Менеджеру, чтобы понять, почему заказ не двигается, приходилось открывать
 * карточку, идти на вкладку «Позиции», прокручивать мимо готовности, размерной
 * сетки и нанесений до таблицы этапов — пять-шесть кликов НА КАЖДЫЙ заказ,
 * и так по всем своим каждое утро.
 *
 * ОТКУДА БЕРЁТСЯ ОТВЕТ. Из `buildQueueEntries` — того же расчёта, которым
 * живут очередь цеха, канбан и фильтры. Своя реализация «почему стоит» стала бы
 * вторым ответом на тот же вопрос, и однажды они разошлись бы: в списке одно,
 * в цехе другое. Здесь только ВЫБОР строки, которую показать, и её подпись.
 *
 * ПОРЯДОК ВЫБОРА отвечает на «что мешает сильнее всего», а не «что первое
 * по маршруту»: проблема цеха важнее ожидания материалов, ожидание материалов
 * важнее идущей работы. Заказ, у которого одна позиция шьётся, а вторая стоит
 * без ткани, обязан показать вторую — иначе строка «в работе» скроет затор.
 */

import type { BadgeVariant } from './statusUi';
import { buildQueueEntries } from './queueEntries';
import { isOrderReadyToShip, shipBlockReason } from './stageUi';
import type { ErpDepartment } from '../types';

/** Строка «Сейчас» для одного заказа */
export interface OrderNow {
  /** Где идёт работа: название участка (или «—», если этапов нет) */
  where: string;
  /** Что с ней: «в работе 80/200», «готов к запуску», «ждёт материалы» */
  what: string;
  /** Почему стоит; `null` — не стоит */
  why: string | null;
  /** Стоит ли заказ прямо сейчас — им же фильтруется список */
  stopped: boolean;
  variant: BadgeVariant;
}

/** Насколько группа мешает: чем больше, тем раньше её показываем */
const WEIGHT: Record<string, number> = {
  blocked: 5,
  awaiting_materials: 4,
  waiting: 3,
  in_progress: 2,
  ready: 1,
};

/** Группы, при которых заказ считается стоящим */
const STOPPED = new Set(['blocked', 'awaiting_materials', 'waiting']);

const READY_TO_SHIP: OrderNow = {
  where: 'Склад',
  what: 'готов к отгрузке',
  why: null,
  stopped: false,
  variant: 'ready',
};

const NO_ROUTE: OrderNow = {
  where: '—',
  what: 'маршрута нет',
  why: 'Этапы не заведены — обратитесь к диспетчеру',
  stopped: true,
  variant: 'blocked',
};

const VARIANT: Record<string, BadgeVariant> = {
  blocked: 'blocked',
  awaiting_materials: 'waiting',
  waiting: 'waiting',
  in_progress: 'progress',
  ready: 'ready',
};

function whatOf(group: string, stage: { qty_done?: number | null }, qty: number): string {
  if (group === 'in_progress') {
    const done = stage.qty_done ?? 0;
    return qty > 0 ? `в работе ${done}/${qty}` : 'в работе';
  }
  if (group === 'ready') return 'готов к запуску';
  if (group === 'awaiting_materials') return 'ждёт материалы';
  if (group === 'blocked') return 'проблема';
  return 'ожидает';
}

/**
 * «Сейчас» для каждого заказа: `Map` по `order.id`.
 *
 * Считается ПАЧКОЙ, а не по одному заказу: `buildQueueEntries` и так обходит
 * все этапы всех заказов, и вызов её на каждую строку списка означал бы этот
 * обход столько раз, сколько строк на странице.
 */
export function buildOrderNow(
  orders: Parameters<typeof buildQueueEntries>[0],
  departments: ErpDepartment[],
  { bypasses = [] as unknown[] } = {},
): Map<string, OrderNow> {
  const best = new Map<string, { weight: number; now: OrderNow }>();

  const entries = buildQueueEntries(orders, departments, {
    // Архивные заказы тоже в списке — у них «Сейчас» пусто, и это правда
    includeInactive: true,
    /* `queueEntries` — на JS, и его дефолт `bypasses = []` выводится как
       `never[]`. Приведение здесь, а не смена сигнатуры чужого модуля. */
    bypasses: bypasses as never[],
  });

  for (const entry of entries) {
    const { order, item, stage, group, reason } = entry;
    if (group === 'done') continue;
    const weight = WEIGHT[group] ?? 0;
    if (weight === 0) continue;
    const prev = best.get(order.id);
    if (prev && prev.weight >= weight) continue;
    const dept = departments.find((d) => d.id === stage.department_id);
    best.set(order.id, {
      weight,
      now: {
        where: dept?.name || '—',
        what: whatOf(group, stage, item.qty ?? 0),
        why: STOPPED.has(group) ? reason ?? null : null,
        stopped: STOPPED.has(group),
        variant: VARIANT[group] ?? 'neutral',
      },
    });
  }

  const out = new Map<string, OrderNow>();
  for (const order of orders) {
    const found = best.get(order.id);
    if (found) { out.set(order.id, found.now); continue; }
    /**
     * Открытых этапов нет — и это ТРИ разных ответа, а не два.
     *
     * Первая редакция знала два («готов к отгрузке» либо «этапов нет») и врала
     * на самом частом из них: заказ с закрытыми этапами, который склад ещё
     * не может отгрузить (материалы не приняты, разработка образца открыта),
     * получал подпись «этапов нет» при четырёх закрытых этапах. Найдено
     * на живом экране, а не рассуждением.
     *
     * Причину называет `shipBlockReason` — та же функция, что объясняет
     * отсутствие кнопки «Отгрузить» кладовщику. Второй формулировки того же
     * ответа в разделе быть не должно.
     */
    if (isOrderReadyToShip(order)) { out.set(order.id, READY_TO_SHIP); continue; }
    const hasStages = (order.items ?? []).some(
      (it: { stages?: unknown[] }) => (it.stages ?? []).length > 0,
    );
    if (!hasStages) { out.set(order.id, NO_ROUTE); continue; }
    out.set(order.id, {
      where: 'Склад',
      what: 'производство закончено',
      why: shipBlockReason(order),
      stopped: true,
      variant: 'waiting',
    });
  }
  return out;
}
