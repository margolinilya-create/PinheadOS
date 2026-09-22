/**
 * ОСТАТКИ ПОЛОТНА НА СКЛАДЕ (правка заказчика 21.09, п. 5).
 *
 * ЧТО ПРОСИТ ДОКУМЕНТ. «Если рулон использован частично или целый рулон
 * не использован, оставшийся вес сохраняется как остаток ткани этого заказа…
 * Если выбран „Остаток пригоден", система включает его в экономику заказа
 * и показывает общий остаток ткани в кг и в рублях».
 *
 * ПОЧЕМУ ОСТАТОК — ЭТО САМ РУЛОН, А НЕ НОВАЯ СУЩНОСТЬ. У рулона уже есть всё,
 * что нужно складу: вес (`qty_left`), цена партии (`price_per_unit`), материал
 * и заказ, в котором его открыли. Завести рядом «строку остатка» значило бы
 * получить второго писателя того же веса — а расходится такая пара молча
 * и всегда. Поэтому «остаток на складе» это ОТБОР: рулоны с `leftover_kind =
 * 'usable'` и ненулевым остатком.
 *
 * `scrap` СЮДА НЕ ПОПАДАЕТ: «если выбран „Малый остаток, не учитывать",
 * отдельный складской остаток не создавать». Это прямой запрет, а не
 * умолчание.
 */

import type { ErpMaterial, ErpMaterialRoll } from '../types';

/** Остаток одного рулона — строка списка на складе */
export interface FabricLeftover {
  rollId: string;
  /** «Рулон №3» — то, что произносят в цеху */
  label: string;
  material: string;
  color: string | null;
  /** Сколько осталось */
  qty: number;
  unit: string | null;
  /** Закупочная цена партии; `null` — цена не записана */
  price: number | null;
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

function rollCost(roll: ErpMaterialRoll, material: ErpMaterial): number | null {
  const price = roll.price_per_unit ?? material.price_per_unit ?? null;
  if (price === null || price === undefined) return null;
  const qty = Number(roll.qty_left) || 0;
  return Math.round(qty * Number(price) * 100) / 100;
}

/**
 * Пригодные остатки по всем переданным заказам.
 *
 * Порядок — по материалу и номеру рулона: на складе их ищут глазами по имени
 * ткани, а внутри неё по номеру, который написан на самом рулоне.
 */
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

export function fabricLeftovers(
  orders: readonly LeftoverOrder[] | null | undefined,
): FabricLeftover[] {
  const out: FabricLeftover[] = [];
  for (const order of orders ?? []) {
    for (const material of order?.materials ?? []) {
      for (const roll of material?.rolls ?? []) {
        if (roll?.leftover_kind !== 'usable') continue;
        const qty = Number(roll.qty_left) || 0;
        if (qty <= 0) continue;
        const name = material.fact_name || material.name;
        out.push({
          rollId: roll.id,
          label: roll.label,
          material: name,
          color: colorSuffix(name, material.fact_color || material.color),
          qty,
          unit: roll.unit || material.unit || null,
          price: roll.price_per_unit ?? material.price_per_unit ?? null,
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

/** Итог по единице измерения: «61 кг и 120 м» одним числом не бывает */
export interface LeftoverTotal {
  unit: string | null;
  qty: number;
  /** Стоимость известной части; `null`, если цены нет ни у одного рулона */
  cost: number | null;
  rolls: number;
}

/**
 * Итоги по единицам.
 *
 * Килограммы с метрами не складываются — пересчёта единиц система не делает
 * (правило раздела). Рубли складываются всегда: они общие.
 */
export function leftoverTotals(
  rows: readonly FabricLeftover[] | null | undefined,
): LeftoverTotal[] {
  const byUnit = new Map<string, LeftoverTotal>();
  for (const row of rows ?? []) {
    const key = row.unit ?? '';
    const hit = byUnit.get(key) ?? { unit: row.unit, qty: 0, cost: null, rolls: 0 };
    hit.qty = Math.round((hit.qty + row.qty) * 1000) / 1000;
    hit.rolls += 1;
    if (row.cost !== null) hit.cost = Math.round(((hit.cost ?? 0) + row.cost) * 100) / 100;
    byUnit.set(key, hit);
  }
  return [...byUnit.values()].sort((a, b) => (a.unit ?? '').localeCompare(b.unit ?? '', 'ru'));
}
