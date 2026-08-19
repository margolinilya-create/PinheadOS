/**
 * «Где заказ сейчас» одной строкой (правка заказчика, сессия 33: менеджер
 * должен видеть стадию своей сделки).
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ УТИЛИТА, А НЕ НАДПИСЬ В КОМПОНЕНТЕ. Ответ на вопрос «что
 * с моим заказом» нужен в трёх местах сразу: строка списка заказов, карточка
 * на планшете и колонка «Производство» в списке ТЗ. Три реализации одного
 * ответа разошлись бы в первую же правку — причём молча: все три «работают»,
 * просто говорят разное, и менеджер с цехом читают про один заказ два ответа.
 *
 * ПОЧЕМУ НЕ СТАТУС ЗАКАЗА. `erp_orders.status` это `active`/`done`/`cancelled` —
 * он отвечает на вопрос «закрыт ли заказ», а менеджера интересует «в каком
 * цехе работа и сколько сделано». Стадия считается ИЗ ЭТАПОВ, то есть из того
 * же источника, по которому живёт производство.
 *
 * Порядок веток — это порядок важности ответа для человека:
 * отгружен → готов к отгрузке → остановлен → в работе → ждёт очереди.
 * «Остановлен» стоит выше «в работе» намеренно: заказ, у которого часть
 * маршрута идёт, а часть заблокирована, требует решения, и прятать блокировку
 * за словом «в работе» значит показать благополучие вместо проблемы.
 */

import { ORDER_STATUS_LABELS } from '../types';
import type { ErpItemStage, ErpMaterial, ErpOrderStatus } from '../types';
import { isOrderReadyToShip } from './stageUi';
import { orderProgress } from './progress';
import { isInternal } from './outsourcing';

export type OrderStageTone = 'done' | 'ready' | 'blocked' | 'progress' | 'waiting' | 'none';

/** Тон → класс чипа из `erp.module.css`, тем же приёмом, что `STAGE_CHIP_CLASS` */
export const ORDER_STAGE_CHIP: Record<OrderStageTone, string> = {
  done: 'chipDone',
  ready: 'chipReady',
  blocked: 'chipBlocked',
  progress: 'chipProgress',
  waiting: 'chipWaiting',
  none: 'chipNeutral',
};

export interface OrderStageSummary {
  /** Короткая фраза для ячейки: «В работе: Швейка» */
  label: string;
  /** Тон для чипа — цвет здесь дополняет текст, а не заменяет его */
  tone: OrderStageTone;
  /** Прогресс в штуках; `null` — считать не из чего (маршрута нет) */
  pct: number | null;
}

/**
 * Минимум для расчёта: заказ из списочной выборки подходит целиком. Форма
 * подобрана так, чтобы структурно годиться и `isOrderReadyToShip`, и
 * `orderProgress` — приведение типом означало бы, что расхождение полей
 * обнаружится не тайпчеком, а пустой ячейкой у менеджера.
 */
export interface StageOrderLike {
  status: string;
  shipped_at?: string | null;
  materials?: ErpMaterial[];
  items: Array<{
    qty: number;
    stages: ErpItemStage[];
    production_type?: string | null;
    material_source?: string | null;
  }>;
}

/** Название цеха по id; неизвестный цех остаётся без подписи, а не «undefined» */
export type DeptNameFn = (departmentId: string) => string | null;

const OPEN = new Set(['waiting', 'ready', 'in_progress', 'blocked']);

/** Уникальные названия цехов по этапам, в порядке маршрута */
function deptNames(stages: ErpItemStage[], deptName: DeptNameFn): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const st of [...stages].sort((a, b) => a.sort_order - b.sort_order)) {
    const name = deptName(st.department_id);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function orderStageSummary(
  order: StageOrderLike,
  deptName: DeptNameFn,
): OrderStageSummary {
  /**
   * Позиции нормализуются, а не берутся как есть: типом это поле обязательное,
   * но половина читателей — `.jsx` без тайпчека, а заказ, приехавший realtime,
   * вложенных позиций может не нести вовсе. Падение здесь означало бы белый
   * экран всего списка заказов из-за одной строки.
   */
  const safe = { ...order, items: (order.items ?? []).map((it) => ({ ...it, stages: it.stages ?? [] })) };
  const stages = safe.items.flatMap((it) => it.stages);
  const progress = orderProgress(safe);
  // Ноль в знаменателе — это «неизвестно», а не «готово» (правило проекта)
  const pct = progress.total > 0 ? progress.pct : null;

  if (order.status !== 'active') {
    /**
     * Закрытый заказ описывает СВОЙ ИСХОД, а не цех: «Сдан с опозданием»
     * и «Отменён» — разные новости для менеджера, и общее «Закрыт» стёрло бы
     * разницу. Подписи берутся из `ORDER_STATUS_LABELS`, чтобы список заказов
     * и эта ячейка не научились называть одно состояние по-разному.
     */
    const label = ORDER_STATUS_LABELS[order.status as ErpOrderStatus] ?? 'Закрыт';
    return { label, tone: 'done', pct };
  }
  if (isOrderReadyToShip(safe)) {
    return { label: 'Готов к отгрузке', tone: 'ready', pct };
  }

  const open = stages.filter((st) => OPEN.has(st.status));
  if (open.length === 0) {
    return { label: 'Маршрут не задан', tone: 'none', pct };
  }

  const blocked = open.filter((st) => st.status === 'blocked');
  if (blocked.length > 0) {
    return { label: `Остановлен: ${deptNames(blocked, deptName).join(', ')}`, tone: 'blocked', pct };
  }

  const running = open.filter((st) => st.status === 'in_progress');
  if (running.length > 0) {
    /**
     * Подрядный этап называется подрядчиком, а не цехом: `department_id`
     * у него означает «чей это участок ответственности», и подпись «В работе:
     * Швейка» на работе, которая сейчас у подрядчика, отправила бы менеджера
     * спрашивать не туда.
     */
    const own = running.filter(isInternal);
    const label = own.length === running.length
      ? `В работе: ${deptNames(running, deptName).join(', ')}`
      : own.length === 0
        ? 'В работе у подрядчика'
        : `В работе: ${deptNames(own, deptName).join(', ')} · подряд`;
    return { label, tone: 'progress', pct };
  }

  // Ничего не начато — называем ближайший этап маршрута
  const next = [...open].sort((a, b) => a.sort_order - b.sort_order)[0];
  const name = deptName(next.department_id);
  return { label: name ? `Ждёт: ${name}` : 'Ждёт очереди', tone: 'waiting', pct };
}
