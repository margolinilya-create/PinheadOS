import type { ErpDepartment, ErpItemStage, ErpMaterial } from '../types';

/**
 * Закупка как ЭТАП МАРШРУТА — единственный источник правды.
 *
 * ЗАЧЕМ ЭТОТ ФАЙЛ. Этап «Закупка» и раздел «Закупка» были двумя несвязанными
 * сущностями: экран строил таблицу из `order.materials` и об этапах не знал
 * вовсе, а `maybeCloseSupply` держал свою копию правила «какие этапы считать
 * открытыми». Из-за этого заказ, у которого этап закупки есть, а материалов
 * ещё нет, не показывался НИГДЕ — ни в разделе закупки (нет материалов),
 * ни в очереди, ни на канбане (`supply.is_production = false`). Закупка
 * не могла начать работу, и весь маршрут за ней стоял: на боевой базе
 * 33 таких этапа, включая пять заказов, созданных заказчиком 12.08.
 *
 * Модуль-лист без зависимостей: его импортируют и оболочка (бейдж меню),
 * и экран, и слайс материалов. Вторая копия любого правила отсюда — это
 * ровно тот способ, которым дефект и появился.
 */

/** Этапы, которые больше не ждут работы закупки */
const CLOSED: ReadonlySet<string> = new Set(['done', 'skipped']);

/** Цех закупки из справочника (кода `supply` в коде больше нигде быть не должно) */
export function findSupplyDept<T extends { code: string }>(
  departments: readonly T[] | null | undefined,
): T | null {
  return (departments ?? []).find((d) => d.code === 'supply') ?? null;
}

interface OrderLike {
  items?: { stages?: ErpItemStage[] }[];
}

/**
 * Открытые этапы закупки заказа.
 *
 * Их несколько: этап `supply` заводится на КАЖДУЮ позицию, а материалы
 * принадлежат заказу целиком (`erp_materials.order_id`). Поэтому закупка
 * ведётся по заказу, а закрывается сразу по всем его открытым этапам —
 * так уже делает автозакрытие, и ручное действие обязано совпадать с ним.
 */
export function openSupplyStages(
  order: OrderLike | null | undefined,
  supplyDeptId: string | null | undefined,
): ErpItemStage[] {
  if (!order || !supplyDeptId) return [];
  const out: ErpItemStage[] = [];
  for (const item of order.items ?? []) {
    for (const stage of item.stages ?? []) {
      if (stage.department_id === supplyDeptId && !CLOSED.has(stage.status)) out.push(stage);
    }
  }
  return out;
}

/**
 * Состояние закупки по заказу для строки списка.
 *
 * `taken` — закупку уже взяли в работу (хотя бы один этап `in_progress`).
 * `blocked` — этап заблокирован цехом, работать нельзя, пока не снимут.
 */
export type SupplyState = 'blocked' | 'taken' | 'open';

export function supplyState(stages: readonly ErpItemStage[]): SupplyState {
  if (stages.some((st) => st.status === 'blocked')) return 'blocked';
  if (stages.some((st) => st.status === 'in_progress')) return 'taken';
  return 'open';
}

/** Материал «на месте»: пришёл, зарезервирован со склада или не требуется */
export function isMaterialSettled(m: Pick<ErpMaterial, 'status'>): boolean {
  return m.status === 'received' || m.status === 'reserved' || m.status === 'not_needed';
}

export interface SupplyMaterialSummary {
  total: number;
  settled: number;
  /** Все материалы на месте И их вообще завели */
  allSettled: boolean;
  /**
   * Закупаемые позиции без планового количества. Приёмка на складе сверяет
   * факт с планом, и без него сделка дальше не идёт (правка 4.1.3).
   */
  missingPlan: ErpMaterial[];
}

export function supplyMaterialSummary(
  materials: readonly ErpMaterial[] | null | undefined,
): SupplyMaterialSummary {
  const list = materials ?? [];
  const settled = list.filter(isMaterialSettled).length;
  return {
    total: list.length,
    settled,
    allSettled: list.length > 0 && settled === list.length,
    missingPlan: list.filter(
      (m) => m.source === 'purchase' && (m.qty_expected == null || m.qty_expected <= 0)),
  };
}

/**
 * Считает заказы, ждущие закупки, — бейдж пункта меню.
 *
 * Прежде бейдж считал только `procurement_tasks` (дозакупки и замены), а они
 * заводятся ИСКЛЮЧИТЕЛЬНО из брака. Заказ, у которого закупка — первый этап
 * маршрута, счётчик не увеличивал вовсе, поэтому в раздел никто и не заходил:
 * пункт меню молчал ровно тогда, когда работа там была.
 *
 * Считаем ЗАКАЗЫ, а не этапы: заказ из трёх позиций даёт три этапа закупки,
 * но работа по нему одна, и «3» на бейдже означало бы втрое больше дел,
 * чем есть.
 */
export function ordersAwaitingSupply<T extends OrderLike & { status: string }>(
  orders: readonly T[],
  departments: readonly ErpDepartment[] | null | undefined,
): T[] {
  const supply = findSupplyDept(departments);
  if (!supply) return [];
  return orders.filter(
    (o) => o.status === 'active' && openSupplyStages(o, supply.id).length > 0);
}
