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

import type { ErpMaterial, ErpMaterialRoll } from '../types';
import type { LengthSource } from './fabricMetres';
import { rollPricePerM, roundKg, roundM } from './fabricMetres';

/** Остаток одного рулона — строка списка на складе */
export interface FabricLeftover {
  rollId: string;
  /** «Рулон №3» — то, что произносят в цеху */
  label: string;
  material: string;
  color: string | null;
  /** Остаток, м; `null` — у рулона нет метража (принят до учёта в метрах) */
  lengthM: number | null;
  /** Откуда метраж остатка: расчёт / поставщик / замер */
  lengthSource: LengthSource | null;
  /** Остаток в кг: `calc` — расчётный (метры × коэффициент), `entered` — из учёта в кг */
  kg: number | null;
  kgSource: 'calc' | 'entered' | null;
  widthCm: number | null;
  densityGsm: number | null;
  /** Цена за метр рулона; `null` — цены или коэффициента нет */
  pricePerM: number | null;
  /** Закупочная цена за кг партии */
  pricePerKg: number | null;
  /** Стоимость остатка; `null`, когда цены нет: ноль тут был бы неправдой */
  cost: number | null;
  orderId: string | null;
  orderTitle: string;
}

/** Минимальная форма заказа — чтобы не тянуть весь тип в утилиту */
interface LeftoverOrder {
  id: string;
  title?: string | null;
  materials?: ErpMaterial[] | null;
}

/**
 * Стоимость остатка: по метрам и цене за метр, а у рулона без метража —
 * по килограммам и цене за кг. Цена — снимок рулона на момент приёмки.
 */
function rollCost(roll: ErpMaterialRoll, material: ErpMaterial): number | null {
  const lengthLeft = roll.length_left_m;
  const pricePerM = rollPricePerM(roll, material);
  if (lengthLeft !== null && lengthLeft !== undefined && pricePerM !== null) {
    return Math.round(Number(lengthLeft) * pricePerM * 100) / 100;
  }
  const price = roll.price_per_unit ?? material.price_per_unit ?? null;
  if (price === null || price === undefined) return null;
  const qty = Number(roll.qty_left) || 0;
  return Math.round(qty * Number(price) * 100) / 100;
}

/**
 * Цвет НЕ ПОВТОРЯЕТСЯ, если он уже назван в имени материала.
 *
 * Имя ткани на бою сплошь и рядом уже содержит цвет («Футер 3-нитка,
 * чёрный»), а колонка `color` хранит его же отдельно. Экран печатал оба
 * и выдавал «Футер 3-нитка, чёрный · чёрный» — поймано глазами на стенде.
 *
 * Отбрасывать колонку нельзя: у половины материалов имя цвета не содержит,
 * и тогда со склада не понять, какой именно рулон искать.
 */
function colorSuffix(name: string, color: string | null | undefined): string | null {
  const c = (color || '').trim();
  if (!c) return null;
  return name.toLowerCase().includes(c.toLowerCase()) ? null : c;
}

/**
 * Пригодные остатки по всем переданным заказам.
 *
 * Порядок — по материалу и номеру рулона: на складе их ищут глазами по имени
 * ткани, а внутри неё по номеру, который написан на самом рулоне.
 */
export function fabricLeftovers(
  orders: readonly LeftoverOrder[] | null | undefined,
): FabricLeftover[] {
  const out: FabricLeftover[] = [];
  for (const order of orders ?? []) {
    for (const material of order?.materials ?? []) {
      for (const roll of material?.rolls ?? []) {
        if (roll?.leftover_kind !== 'usable') continue;
        const lengthLeft = roll.length_left_m === null || roll.length_left_m === undefined
          ? null : Math.max(Number(roll.length_left_m), 0);
        const kg = Number(roll.qty_left) || 0;
        if (!(lengthLeft !== null ? lengthLeft > 0.0005 : kg > 0)) continue;
        const name = material.fact_name || material.name;
        out.push({
          rollId: roll.id,
          label: roll.label,
          material: name,
          color: colorSuffix(name, material.fact_color || material.color),
          lengthM: lengthLeft === null ? null : roundM(lengthLeft),
          lengthSource: lengthLeft === null
            ? null : ((roll.length_left_source ?? roll.length_source ?? 'calc') as LengthSource),
          kg: kg > 0 ? roundKg(kg) : null,
          // Метраж есть — килограммы остатка расчётные (метры × коэффициент);
          // нет — это учёт в кг, как было до правки
          kgSource: kg > 0 ? (lengthLeft !== null ? 'calc' : 'entered') : null,
          widthCm: roll.width_cm ?? material.width_cm ?? null,
          densityGsm: roll.density_gsm ?? material.density_gsm ?? null,
          pricePerM: rollPricePerM(roll, material),
          pricePerKg: roll.price_per_unit ?? material.price_per_unit ?? null,
          cost: rollCost(roll, material),
          orderId: order.id ?? null,
          orderTitle: order.title || 'Без названия',
        });
      }
    }
  }
  return out.sort((a, b) => a.material.localeCompare(b.material, 'ru')
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
