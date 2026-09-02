/**
 * Общие UI-хелперы этапов: цвет чипа по статусу и готовность заказа к отгрузке.
 * Единый источник для OrdersScreen / OrderCard / ProductionBoard и др.
 * Прогресс считается в штуках — см. utils/progress.ts (правка 7).
 */

import type { ErpItemStage, ErpMaterial, StageStatus } from '../types';
import { isMaterialPending } from './routes';

/** Статус этапа → класс чипа из erp.module.css */
export const STAGE_CHIP_CLASS: Record<StageStatus, string> = {
  waiting: 'chipWaiting',
  ready: 'chipReady',
  in_progress: 'chipProgress',
  done: 'chipDone',
  skipped: 'chipSkipped',
  blocked: 'chipBlocked',
};

/** Минимум заказа, по которому судим о готовности к отгрузке */
export interface OrderShipReadiness {
  status: string;
  items: ShipReadinessItem[];
  materials?: ErpMaterial[];
  /**
   * Разработки образцов заказа (правки 02.09, п. 2). Приезжают эмбедом
   * в обеих выборках заказа — см. `store/orderHelpers`.
   *
   * ОТСУТСТВИЕ КЛЮЧА ЧИТАЕТСЯ КАК «РАЗРАБОТОК НЕТ», и это осознанный fail-open,
   * тот же, что у гейта ТЗ: заказ, приехавший старым бандлом или собранный
   * в фикстуре без этого поля, обязан отгружаться как раньше. Иначе одна
   * забытая фикстура сделала бы неотгружаемым весь склад.
   */
  developments?: { outcome?: string | null }[];
}

/** Позиция глазами гейта отгрузки: этапы + признаки «производится вне цехов» */
export interface ShipReadinessItem {
  stages: Pick<ErpItemStage, 'status'>[];
  production_type?: string | null;
  material_source?: string | null;
}

/**
 * Позиция, у которой производственного маршрута нет ПО ПРАВИЛУ, а не по ошибке.
 *
 * Оснований три, и они разные:
 *
 * · `outsource` — `BASE_CHAIN.outsource` состоит из одного `supply`,
 *   и `buildItemRoute` вырезает его, когда материал даёт подрядчик. Всю работу
 *   ведёт подрядчик, она живёт в `erp_subcontracting`, а не в этапах.
 * · `no_product` (только нанесение) — метод нанесения может не иметь своего
 *   цеха (`other` — пришив внутри швейки).
 * · `samples` (правки 02.09, п. 1) — работу ведёт ЭКСПЕРИМЕНТАЛЬНЫЙ ЦЕХ, и она
 *   живёт в `erp_experimental`: доска разработки и её задачи. В маршруте
 *   у образца остаётся одна закупка, а при отметке «Закупка не требуется» —
 *   не остаётся вообще ничего.
 *
 * ПОЧЕМУ `samples` ЗДЕСЬ ОБЯЗАТЕЛЕН. Раньше `isOrderReadyToShip` отвечал `false`
 * на любой заказ без этапов, а склад отгружает только через него — такой заказ
 * невозможно было закрыть вообще никогда, и кладовщик получал отказ без
 * объяснимой причины. Ради этого функция и появилась. Правка 02.09 завела бы
 * ровно такой тупик заново: образец без закупки получает пустой маршрут,
 * а `shipBlockReason` отправил бы кладовщика к диспетчеру «чинить маршрут»,
 * которого не должно быть.
 *
 * Это не «отпускает» образец: пустой маршрут перестаёт запирать заказ,
 * а незавершённая разработка держит его отдельной проверкой ниже.
 */
function hasNoRouteByDesign(item: ShipReadinessItem): boolean {
  return item.production_type === 'outsource'
    || item.production_type === 'no_product'
    || item.production_type === 'samples';
}

/**
 * Незавершённые разработки заказа: исход ещё не проставлен.
 *
 * ИСХОД, А НЕ `handed_to_warehouse_at`. Разработка, закрытая не «готово
 * к серии» (забракована, ушла в доработку, передана в основной цех), на склад
 * не передаётся вовсе — гейт по факту передачи запер бы такой заказ навсегда.
 * Ровно та же граница стоит на сервере (`erp_order_has_open_dev`), и это
 * не совпадение: два выражения одного правила разошлись бы, а расхождение тут
 * означает «кнопка есть, действие падает».
 */
export function openDevelopments(order: OrderShipReadiness): { outcome?: string | null }[] {
  return (order.developments ?? []).filter((d) => !d.outcome);
}

/**
 * Материалы, из-за которых заказ нельзя отгружать.
 *
 * Правило то же, что и у гейта этапа (`isMaterialPending`): упаковка, бирки и
 * «сиротские» материалы (цех вне маршрута) не блокируют ни один этап, но
 * отгружать без них нельзя. Пришедший закупочный материал годен только после
 * приёмки складом — раньше отгрузка считала годным любой `received`, поэтому
 * заказ с недостачей/пересортом/отказом склада доходил до «готов к отгрузке».
 */
export function shipBlockingMaterials(order: OrderShipReadiness): ErpMaterial[] {
  return (order.materials ?? []).filter(isMaterialPending);
}

/**
 * Стадия «Готов к отгрузке»: заказ активен, есть хотя бы один этап, ВСЕ этапы
 * завершены (done/skipped) И все материалы приняты.
 */
export function isOrderReadyToShip(order: OrderShipReadiness): boolean {
  if (order.status !== 'active') return false;
  if (order.items.length === 0) return false;
  const stages = order.items.flatMap((it) => it.stages);
  // Пустой маршрут допустим, только если ВСЕ позиции производятся вне цехов.
  // Иначе этапов нет по ошибке (маршрут не материализовался) — отгружать нельзя.
  if (stages.length === 0 && !order.items.every(hasNoRouteByDesign)) return false;
  if (!stages.every((s) => s.status === 'done' || s.status === 'skipped')) return false;
  // Разработка образца ещё идёт — готовой продукции у заказа нет (правки 02.09)
  if (openDevelopments(order).length > 0) return false;
  return shipBlockingMaterials(order).length === 0;
}

/**
 * Человекочитаемая причина, почему заказ ещё нельзя отгрузить (null — можно).
 * Показывается в карточке заказа и в задаче склада «Упаковка/отгрузка», чтобы
 * кладовщик видел не просто отсутствие кнопки, а конкретную причину.
 */
export function shipBlockReason(order: OrderShipReadiness): string | null {
  if (order.status !== 'active') return null;
  if (order.items.length === 0) return 'В заказе нет позиций';
  const stages = order.items.flatMap((it) => it.stages);
  if (stages.length === 0 && !order.items.every(hasNoRouteByDesign)) {
    // Причина должна подсказывать действие: пустой маршрут у производственной
    // позиции — это сбой материализации при создании, чинится диспетчером,
    // а не кладовщиком.
    return 'У позиций нет этапов маршрута — обратитесь к диспетчеру';
  }

  const open = stages.filter((s) => s.status !== 'done' && s.status !== 'skipped');
  if (open.length > 0) {
    return `Не завершены этапы: ${open.length}`;
  }

  /**
   * Разработка образца называется ПОСЛЕ этапов: пока цех не сдал работу,
   * человеку нужно знать про цех, а не про технолога. И причина обязана
   * подсказывать действие — кнопка живёт в другом разделе, и без прямого
   * указания кладовщик пойдёт искать её на складе.
   */
  const devs = openDevelopments(order);
  if (devs.length > 0) {
    return devs.length > 1
      ? `Не завершены разработки образцов: ${devs.length} — закройте их кнопкой «Завершить разработку» в экспериментальном цехе`
      : 'Разработка образца не завершена — закройте её кнопкой «Завершить разработку» в экспериментальном цехе';
  }

  const blocking = shipBlockingMaterials(order);
  if (blocking.length > 0) {
    const names = blocking.map((m) => m.name).join(', ');
    const awaitingAcceptance = blocking.every((m) => m.status === 'received');
    return awaitingAcceptance
      ? `Склад не принял материалы: ${names}`
      : `Не получены материалы: ${names}`;
  }
  return null;
}

/**
 * Просрочен ли ЗАКАЗ (решение заказчика 03.08.2026).
 *
 * Не просто «срок клиента в прошлом»: заказ, у которого всё сделано и который
 * ждёт только логистики, производству больше не адресован — он не «горит»,
 * а лежит на складе. Считать его просроченным значит держать в списке
 * «что горит» работы, которой нет: на 03.08.2026 так набиралось 47 позиций
 * из 76, и метрика перестала на что-либо отвечать.
 *
 * `daysLeft` приходит параметром, а не считается здесь: у вызывающих он уже
 * есть, а модуль не должен зависеть от «сегодня».
 */
export function isOrderOverdue(
  order: OrderShipReadiness,
  daysLeftValue: number | null,
): boolean {
  if (daysLeftValue === null || daysLeftValue >= 0) return false;
  return !isOrderReadyToShip(order);
}

/** На сколько дней просрочен заказ; 0 — не просрочен (в т.ч. если готов к отгрузке) */
export function orderOverdueDays(
  order: OrderShipReadiness,
  daysLeftValue: number | null,
): number {
  return isOrderOverdue(order, daysLeftValue) ? -(daysLeftValue as number) : 0;
}
