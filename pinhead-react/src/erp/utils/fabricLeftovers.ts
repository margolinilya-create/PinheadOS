/**
 * ОСТАТКИ ПОЛОТНА НА СКЛАДЕ (правка заказчика 21.09, п. 5; в метрах —
 * 27.09, п. 4).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Если рулон использован частично или целый рулон
 * не использован, оставшийся вес сохраняется как остаток ткани этого заказа…
 * Если выбран „Остаток пригоден", система включает его в экономику заказа
 * и показывает общий остаток ткани». С 27.09: «в разделе „Остатки ткани"
 * показывать метры, источник метража, ширину, плотность и исходный рулон.
 * Килограммы показывать дополнительно с отметкой „Расчёт", если остаток
 * не взвешивали».
 *
 * ПОЧЕМУ ОСТАТОК — ЭТО САМ РУЛОН, А НЕ НОВАЯ СУЩНОСТЬ. У рулона уже есть всё,
 * что нужно складу: остаток в метрах (`length_left_m`) и в кг (`qty_left`,
 * расчётный), цена партии (`price_per_unit`, `price_per_m`), материал и заказ,
 * в котором его открыли. Завести рядом «строку остатка» значило бы получить
 * второго писателя того же веса — а расходится такая пара молча и всегда.
 * Поэтому «остаток на складе» это ОТБОР: рулоны с `leftover_kind = 'usable'`
 * и ненулевым остатком.
 *
 * `scrap` СЮДА НЕ ПОПАДАЕТ: «если выбран „Малый остаток, не учитывать",
 * отдельный складской остаток не создавать». Это прямой запрет, а не
 * умолчание.
 *
 * РУЛОНЫ БЕЗ МЕТРАЖА (приняты до 27.09, п. 4) остаются в списке С ВЕСОМ:
 * «изменение метража не должно стирать исходный вес закупки», а остаток
 * в кг у них — единственное, что есть. Метры у такой строки — прочерк.
 */

import type { ErpOrderStatus } from '../types';
import { ORDER_STATUS_LABELS } from '../types';
import type { FabricLeftoverRow } from '../store/types';
import type { LengthSource } from './fabricMetres';
import { rollPricePerM, roundKg, roundM } from './fabricMetres';

/**
 * ОТКУДА СПИСОК (правка 28.09). До неё экран собирал остатки из заказов,
 * которые лежат в сторе, — а без загруженного архива там только активные,
 * и пригодный остаток закрытого заказа ИСЧЕЗАЛ со склада ровно тогда, когда
 * заказ сдан, то есть когда его чаще всего и ищут. Теперь строки отдаёт
 * сервер (`erp_fabric_leftovers()`: `leftover_kind = 'usable'`,
 * `status = 'used'`, остаток > 0 — по ВСЕМ заказам), а утилита только
 * превращает их в строки экрана. Отбор ненулевого остатка повторён здесь
 * защитно: пустая строка списка хуже её отсутствия.
 */

/** Остаток одного рулона — строка списка на складе */
export interface FabricLeftover {
  rollId: string;
  /** «Рулон №3» — то, что произносят в цеху */
  label: string;
  /** Номер рулона внутри материала — для порядка (строки «№10» < «№2») */
  seq: number | null;
  materialId: string | null;
  material: string;
  /** Цвет материала; `null` — не указан */
  color: string | null;
  /** Остаток, м; `null` — у рулона нет метража (принят до учёта в метрах) */
  lengthM: number | null;
  /** Откуда метраж: расчёт / поставщик / замер */
  lengthSource: LengthSource | null;
  /** Остаток в кг: `calc` — расчётный (метры × коэффициент), `entered` — из учёта в кг */
  kg: number | null;
  kgSource: 'calc' | 'entered' | null;
  widthCm: number | null;
  densityGsm: number | null;
  /** Цена за метр рулона; `null` — цены или коэффициента нет */
  pricePerM: number | null;
  /** Закупочная цена за кг партии (снимок рулона) */
  pricePerKg: number | null;
  /** Стоимость остатка; `null`, когда цены нет: ноль тут был бы неправдой */
  cost: number | null;
  /** Место хранения рулона на складе; `null` — не указано */
  location: string | null;
  orderId: string | null;
  orderTitle: string;
  orderStatus: string | null;
  /** Заказ закрыт (сдан или отменён) — подпись статуса рядом со ссылкой */
  orderClosed: boolean;
  /** Подпись статуса закрытого заказа; у активного — `null` */
  orderStatusLabel: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Стоимость остатка: по метрам и цене за метр, а у рулона без метража —
 * по килограммам и цене за кг. Цена — снимок рулона на момент приёмки.
 */
function rowCost(lengthLeft: number | null, pricePerM: number | null,
  kg: number, pricePerKg: number | null): number | null {
  if (lengthLeft !== null && pricePerM !== null) {
    return Math.round(lengthLeft * pricePerM * 100) / 100;
  }
  if (pricePerKg === null) return null;
  return Math.round(kg * pricePerKg * 100) / 100;
}

/** Одна строка RPC → строка экрана; `null` — остатка нет */
export function leftoverFromRow(row: FabricLeftoverRow | null | undefined): FabricLeftover | null {
  if (!row?.roll_id) return null;
  const leftRaw = num(row.length_left_m);
  const lengthLeft = leftRaw === null ? null : Math.max(leftRaw, 0);
  const kg = Math.max(num(row.qty_left) ?? 0, 0);
  if (!(lengthLeft !== null ? lengthLeft > 0.0005 : kg > 0)) return null;
  const pricePerKg = num(row.price_per_unit);
  const pricePerM = rollPricePerM({
    qty: num(row.qty) ?? 0,
    length_m: num(row.length_m),
    length_source: row.length_source ?? null,
    length_left_m: lengthLeft,
    length_left_source: null,
    kg_per_m: num(row.kg_per_m),
    price_per_m: num(row.price_per_m),
    width_cm: num(row.width_cm),
    density_gsm: num(row.density_gsm),
    price_per_unit: pricePerKg,
  } as Parameters<typeof rollPricePerM>[0]);
  const status = row.order_status ?? null;
  const closed = status !== null && status !== 'active';
  const location = (row.location ?? '').trim() || null;
  return {
    rollId: row.roll_id,
    label: row.label || 'Рулон',
    seq: num(row.seq),
    materialId: row.material_id ?? null,
    material: (row.material ?? '').trim() || 'Материал без названия',
    color: (row.color ?? '').trim() || null,
    lengthM: lengthLeft === null ? null : roundM(lengthLeft),
    lengthSource: lengthLeft === null ? null : ((row.length_source ?? 'calc') as LengthSource),
    kg: kg > 0 ? roundKg(kg) : null,
    // Метраж есть — килограммы остатка расчётные (метры × коэффициент);
    // нет — это учёт в кг, как было до правки 27.09
    kgSource: kg > 0 ? (lengthLeft !== null ? 'calc' : 'entered') : null,
    widthCm: num(row.width_cm),
    densityGsm: num(row.density_gsm),
    pricePerM,
    pricePerKg,
    cost: rowCost(lengthLeft, pricePerM, kg, pricePerKg),
    location,
    orderId: row.order_id ?? null,
    orderTitle: (row.order_title ?? '').trim() || 'Без названия',
    orderStatus: status,
    orderClosed: closed,
    orderStatusLabel: closed
      ? (ORDER_STATUS_LABELS[status as ErpOrderStatus] ?? 'Закрыт')
      : null,
  };
}

/**
 * Пригодные остатки из строк `erp_fabric_leftovers()`.
 *
 * Порядок — по материалу и номеру рулона: на складе их ищут глазами по имени
 * ткани, а внутри неё по номеру, который написан на самом рулоне. Номер
 * сравнивается числом (`seq`), а не строкой подписи: иначе «№10» встаёт
 * перед «№2».
 */
export function fabricLeftovers(
  rows: readonly FabricLeftoverRow[] | null | undefined,
): FabricLeftover[] {
  const out: FabricLeftover[] = [];
  for (const row of rows ?? []) {
    const item = leftoverFromRow(row);
    if (item) out.push(item);
  }
  return out.sort((a, b) => a.material.localeCompare(b.material, 'ru')
    || (a.seq ?? Number.MAX_SAFE_INTEGER) - (b.seq ?? Number.MAX_SAFE_INTEGER)
    || a.label.localeCompare(b.label, 'ru'));
}

export interface LeftoverTotal {
  /** Всего пригодного остатка, м — по рулонам с метражом */
  lengthM: number;
  /** Рулонов с метражом */
  rollsWithMetres: number;
  /** Рулонов без метража — остаток у них только в кг (принят до учёта в метрах) */
  rollsWithoutMetres: number;
  /** Килограммы: расчётные там, где есть метраж, и введённые у остальных */
  kg: number;
  /** Стоимость известной части; `null`, если цены нет ни у одного рулона */
  cost: number | null;
  rolls: number;
}

/**
 * Итог по остаткам. Метры складываются только у рулонов с метражом;
 * рулоны без него названы отдельно числом — иначе «12 м» читалось бы как
 * весь остаток, когда половина рулонов ведётся в килограммах. Рубли
 * складываются всегда.
 */
export function leftoverTotals(
  rows: readonly FabricLeftover[] | null | undefined,
): LeftoverTotal {
  const total: LeftoverTotal = {
    lengthM: 0, rollsWithMetres: 0, rollsWithoutMetres: 0, kg: 0, cost: null, rolls: 0,
  };
  for (const row of rows ?? []) {
    total.rolls += 1;
    if (row.lengthM !== null) {
      total.lengthM = roundM(total.lengthM + row.lengthM);
      total.rollsWithMetres += 1;
    } else {
      total.rollsWithoutMetres += 1;
    }
    if (row.kg !== null) total.kg = roundKg(total.kg + row.kg);
    if (row.cost !== null) total.cost = Math.round(((total.cost ?? 0) + row.cost) * 100) / 100;
  }
  return total;
}
