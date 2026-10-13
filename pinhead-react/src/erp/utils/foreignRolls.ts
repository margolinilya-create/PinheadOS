/**
 * РУЛОНЫ ДРУГИХ ЗАКАЗОВ В ФОРМЕ ЗАКРОЯ (правка 28.09) — пригодные остатки
 * со склада и уже взятые этим заказом. Вынесено из `cutRolls.ts` (ратчет
 * размера); `cutRolls` реэкспортирует.
 */
import type { ErpMaterial, ErpMaterialRoll } from '../types';
import type { RollOption } from './cutRolls';

/** Строка `erp_fabric_leftovers` / `erp_order_foreign_rolls` — рулон чужого заказа */
export interface ForeignRollRow {
  roll_id: string; label: string; seq: number | null;
  material_id: string; material: string | null; unit: string | null;
  order_id: string; order_title: string | null;
  width_cm: number | null; density_gsm: number | null;
  length_m: number | null; length_left_m: number | null;
  length_source: 'calc' | 'supplier' | 'measured' | null;
  qty: number | null; qty_left: number | null; kg_per_m: number | null;
  price_per_unit: number | null; price_per_m: number | null;
  location?: string | null; status: string; created_at: string;
  leftover_kind?: 'usable' | 'scrap' | null;
}

/**
 * Рулоны других заказов как варианты формы закроя (правка 28.09): пригодные
 * остатки со склада и уже взятые этим заказом. Свой заказ отсекается —
 * его рулоны и так в `materials`. Рулон и материал собираются из строки
 * сервера ровно настолько, насколько их читают формулы метража.
 */
export function foreignRollOptions(
  rows: readonly ForeignRollRow[] | null | undefined,
  orderId: string | null | undefined,
): RollOption[] {
  const seen = new Set<string>();
  const out: RollOption[] = [];
  for (const row of rows ?? []) {
    if (!row || row.order_id === orderId || seen.has(row.roll_id)) continue;
    seen.add(row.roll_id);
    const material = {
      id: row.material_id, order_id: row.order_id, kind: 'fabric', name: row.material ?? '—',
      unit: row.unit, price_per_unit: row.price_per_unit,
      width_cm: row.width_cm, density_gsm: row.density_gsm, rolls: [],
    } as unknown as ErpMaterial;
    const roll = {
      id: row.roll_id, material_id: row.material_id, receipt_id: null, seq: row.seq ?? 0,
      label: row.label, qty: row.qty, qty_left: row.qty_left,
      leftover_kind: row.leftover_kind ?? (row.status === 'used' ? 'usable' : null),
      price_per_unit: row.price_per_unit, unit: row.unit,
      status: row.status as ErpMaterialRoll['status'], created_at: row.created_at,
      width_cm: row.width_cm, density_gsm: row.density_gsm, length_calc_m: null,
      length_m: row.length_m, length_source: row.length_source,
      kg_per_m: row.kg_per_m, kg_per_m_source: null,
      length_left_m: row.length_left_m, length_left_source: row.length_source,
      price_per_m: row.price_per_m, location: row.location ?? null,
    } as ErpMaterialRoll;
    const title = row.order_title ?? 'другой заказ';
    out.push({
      roll, material, fromOrder: title,
      label: `${row.label} · ${row.material ?? '—'} · остаток заказа «${title}»`,
    });
  }
  return out;
}
