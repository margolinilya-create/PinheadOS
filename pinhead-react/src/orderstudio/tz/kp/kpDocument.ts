/**
 * КП заказа (веха 5в, Э6) — чистая модель документа: позиции с ценой, нанесения
 * строками, итог со скидкой и ставками подготовки, ориентировочный срок
 * нанесения по технике (`METHOD_LEAD_DAYS`). В КП цены есть (в ТЗ — нет).
 * Модель без React, сети и PDF; рисует её `kpPdf`.
 */
import type { SalesOrder, SalesPrint } from '../../model/types';
import type { OrderPrice } from '../../pricing/priceOrder';
import { METHOD_LABELS, leadDaysOf } from '../../model/printMethods';
import { gridQty } from '../../model/factory';
import { itemTitle } from '../../model/itemOps';

export interface KpLine {
  n: number;
  zone: string;
  method: string;
  size: string;
  /** Цена нанесения за штуку; `null` — не посчитана */
  unit: number | null;
}

export interface KpItem {
  key: string;
  title: string;
  qty: number;
  unit: number;
  total: number;
  manual: boolean;
  lines: KpLine[];
  leadDays: number | null;
}

export interface KpDoc {
  number: string;
  date: string;
  client: string;
  title: string;
  items: KpItem[];
  subtotal: number;
  prep: number;
  discount: number;
  total: number;
  leadDays: number | null;
  /** Не все позиции посчитаны — КП с пометкой */
  incomplete: boolean;
}

/** «2026-10-26» → «26.10.2026»; иное — как есть */
const ruDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
};

const size = (p: SalesPrint) => (p.width_mm && p.height_mm ? `${Math.round(p.width_mm)} × ${Math.round(p.height_mm)} мм` : 'размер уточняется');

export function kpDocument(order: SalesOrder, price: OrderPrice, today: string): KpDoc {
  const byKey = new Map(price.items.map((p) => [p.key, p]));
  const items = order.items.map((it): KpItem => {
    const p = byKey.get(it.key);
    const unitOf = new Map((p?.prints ?? []).map((x) => [x.key, x.unit]));
    return {
      key: it.key,
      title: itemTitle(it),
      qty: gridQty(it.size_grid),
      unit: p?.unit ?? 0,
      total: p?.total ?? 0,
      manual: !!p?.manual,
      lines: it.prints.map((pr, i) => ({
        n: i + 1,
        zone: pr.zone || 'зона уточняется',
        method: METHOD_LABELS[pr.method],
        size: size(pr),
        unit: unitOf.get(pr.key) ?? null,
      })),
      leadDays: leadDaysOf(it.prints.map((pr) => pr.method)),
    };
  });
  return {
    number: order.number || 'черновик',
    date: ruDate(today),
    client: order.customer.trim(),
    title: order.title.trim(),
    items,
    subtotal: price.subtotal,
    prep: price.prep_total,
    discount: price.discount_amount,
    total: price.total,
    leadDays: leadDaysOf(order.items.flatMap((it) => it.prints.map((pr) => pr.method))),
    incomplete: price.incomplete,
  };
}

/** «1 234 ₽» — пробел разрядов неразрывный (как на экране) */
export const kpRub = (v: number | null) => (v === null ? '—' : `${Math.round(v).toLocaleString('ru-RU')} ₽`);

/** Имя файла КП: `PH-1234-KP.pdf` (ASCII) */
export function kpFileName(number: string): string {
  return `${number.replace(/[^A-Za-z0-9-]+/g, '') || 'PH'}-KP.pdf`;
}
